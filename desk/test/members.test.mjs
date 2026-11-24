// Members: sign-up validation, honeypot, privacy, rate limits, admin export, sponsor attach, and the GitHub
// OAuth flow (state, CSRF, one-time use, sessions, profile edits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Desk, JOIN_IP_LIMIT } from '../src/logic.mjs';
import { MemStore } from '../src/memstore.mjs';

const TOKEN = 'members-admin-token-0123456789';
function setup({ github = true } = {}) {
  const clock = { t: Date.UTC(2026, 10, 25, 9) };
  const store = new MemStore();
  const gh = { codes: new Map([['goodcode', { login: 'Ada-L', id: 4242 }]]), calls: [] };
  const fetchFn = async (url, opts = {}) => {
    gh.calls.push([url, opts]);
    if (url === 'https://github.com/login/oauth/access_token') {
      const b = JSON.parse(opts.body);
      const u = gh.codes.get(b.code);
      return { ok: true, json: async () => (u && b.client_id === 'cid' && b.client_secret === 'csecret' ? { access_token: `tok-${b.code}` } : { error: 'bad_verification_code' }) };
    }
    if (url === 'https://api.github.com/user') {
      const code = String(opts.headers.Authorization).replace('Bearer tok-', '');
      const u = gh.codes.get(code);
      return { ok: !!u, json: async () => ({ login: u.login, id: u.id, avatar_url: `https://avatars.githubusercontent.com/u/${u.id}` }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  let n = 0;
  const desk = new Desk({ store, fetchFn, now: () => clock.t, adminToken: TOKEN, newId: () => `${(++n).toString(16).padStart(8, '0')}aa`,
    site: 'https://site.test', origin: 'https://desk.test', ...(github ? { githubClientId: 'cid', githubClientSecret: 'csecret' } : {}) });
  const call = (method, path, { body = '', ip = '203.0.113.5', auth = '' } = {}) => {
    clock.t += 1500;
    const u = new URL(path, 'http://desk.test');
    return desk.handle({ method, pathname: u.pathname, searchParams: u.searchParams, ip, auth, body: typeof body === 'string' ? body : JSON.stringify(body) });
  };
  const join = (body, opts) => call('POST', '/desk/join', { ...opts, body });
  return { clock, store, desk, gh, call, join };
}
const J = (o = {}) => ({ email: 'Ada@Example.org', name: 'Ada', roles: ['mathematician', 'sponsor'], interests: ['Number theory'], country: 'NZ', consent: true, ...o });

test('a valid sign-up is stored; the answer never echoes the email; the same email updates one member', async () => {
  const { join, store } = setup();
  const r = await join(J());
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.new, true);
  assert.match(r.body.link_token, /^[a-f0-9]{16,80}$/);
  assert.ok(!JSON.stringify(r.body).includes('@'));
  const again = await join(J({ email: 'ada@example.ORG', name: 'Ada Lovelace' }), { ip: '198.51.100.3' });
  assert.equal(again.body.new, false);
  const members = await store.list('member:');
  assert.equal(members.length, 1);
  assert.equal(members[0][1].name, 'Ada Lovelace');
});

test('validation: email, roles, caps and types', async () => {
  const { join } = setup();
  const bad = [J({ email: 'nope' }), J({ email: '' }), J({ roles: ['admin'] }), J({ roles: 'ai' === 1 ? [] : ['ai', 'x'] }), J({ name: 'x'.repeat(61) }),
    J({ country: 'x'.repeat(41) }), J({ interests: Array(9).fill('a') }), J({ interests: [''] }), J({ consent: 'yes' })];
  for (const [i, b] of bad.entries()) assert.equal((await join(b, { ip: `10.1.${i}.1` })).status, 400, JSON.stringify(b));
  assert.equal((await join('not json', { ip: '10.9.9.9' })).status, 400);
});

test('the honeypot field makes the desk pretend success and store nothing', async () => {
  const { join, store } = setup();
  const r = await join(J({ website: 'http://spam.example' }));
  assert.deepEqual(r.body, { ok: true });
  assert.equal((await store.list('member:')).length, 0);
});

test(`at most ${JOIN_IP_LIMIT} sign-ups per hour per address`, async () => {
  const { join, clock } = setup();
  for (let i = 0; i < JOIN_IP_LIMIT; i++) assert.equal((await join(J({ email: `p${i}@x.org` }))).status, 200);
  assert.equal((await join(J({ email: 'over@x.org' }))).status, 429);
  clock.t += 3_600_000;
  assert.equal((await join(J({ email: 'later@x.org' }))).status, 200);
});

test('emails never appear in public endpoints; the admin export has them, as JSON and CSV', async () => {
  const { join, call } = setup();
  await join(J());
  for (const path of ['/desk/status', '/desk/sponsors', '/desk/profiles', '/desk/votes', '/desk/auth/status']) {
    const r = await call('GET', path);
    assert.ok(!/ada@example|@example\.org/i.test(JSON.stringify(r.body || r.text || '')), path);
  }
  assert.equal((await call('GET', '/desk/admin/members')).status, 401);
  const j = await call('GET', '/desk/admin/members', { auth: `Bearer ${TOKEN}` });
  assert.equal(j.body.members[0].email, 'Ada@Example.org');
  const c = await call('GET', '/desk/admin/members?format=csv', { auth: `Bearer ${TOKEN}` });
  assert.match(c.text, /^email,name,roles/);
  assert.match(c.text, /Ada@Example\.org,Ada,mathematician sponsor/);
  assert.equal(c.headers['Content-Type'], 'text/csv; charset=utf-8');
});

test('a pledge from an email that already joined attaches to that member; sign-ups count in the stats', async () => {
  const { join, call, store } = setup();
  await join(J());
  const p = await call('POST', '/desk/pledge', { body: { name: 'Ada', amount: 20, email: 'ada@example.org' } });
  assert.equal(p.body.member, true);
  assert.equal((await store.list('member:'))[0][1].sponsor, true);
  const s = await call('GET', '/desk/admin/stats?days=1', { auth: `Bearer ${TOKEN}` });
  assert.equal(s.body.days[0].signups, 1);
});

test('without GitHub secrets the OAuth routes are hidden and the status says so', async () => {
  const { call } = setup({ github: false });
  assert.deepEqual((await call('GET', '/desk/auth/status')).body, { github: false });
  assert.equal((await call('GET', '/desk/auth/github/start')).status, 404);
  assert.equal((await call('GET', '/desk/auth/github/callback?state=x&code=y')).status, 404);
});

test('OAuth: start redirects with read:user and a state; the callback links the member and returns a session in the fragment', async () => {
  const { join, call, store, gh } = setup();
  const lt = (await join(J())).body.link_token;
  const st = await call('GET', `/desk/auth/github/start?t=${lt}`);
  assert.equal(st.status, 302);
  const loc = new URL(st.headers.Location);
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(loc.searchParams.get('scope'), 'read:user');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://desk.test/desk/auth/github/callback');
  const state = loc.searchParams.get('state');
  const cb = await call('GET', `/desk/auth/github/callback?state=${state}&code=goodcode`);
  assert.equal(cb.status, 302);
  const m = /^https:\/\/site\.test\/me\.html#s=([a-f0-9]+)$/.exec(cb.headers.Location);
  assert.ok(m, cb.headers.Location);
  const member = (await store.list('member:'))[0][1];
  assert.deepEqual({ login: member.github.login, id: member.github.id }, { login: 'Ada-L', id: 4242 });
  assert.ok(!JSON.stringify(await store.list('')).includes('tok-goodcode'), 'the GitHub access token is not stored');
  // the state is one-time
  assert.equal((await call('GET', `/desk/auth/github/callback?state=${state}&code=goodcode`)).status, 400);
  // the session reads and edits the profile; the public list shows it, without email
  const auth = `Bearer ${m[1]}`;
  assert.equal((await call('GET', '/desk/me', { auth })).body.login, 'Ada-L');
  assert.equal((await call('POST', '/desk/me/profile', { auth, body: { display_name: 'Ada Lovelace', links: { orcid: 'https://orcid.org/0000-0002-1825-0097' } } })).status, 200);
  assert.equal((await call('POST', '/desk/me/profile', { auth, body: { links: { x: 'https://evil.example/' } } })).status, 400);
  const pub = (await call('GET', '/desk/profiles')).body.profiles;
  assert.equal(pub['Ada-L'].display_name, 'Ada Lovelace');
  assert.ok(!JSON.stringify(pub).includes('@'));
  assert.equal(gh.calls.filter(([u]) => u.includes('access_token')).length, 1);
});

test('OAuth CSRF: unknown, forged, expired or reused states are refused; bad sessions get 401', async () => {
  const { call, clock } = setup();
  for (const q of ['state=&code=goodcode', 'state=deadbeefdeadbeef&code=goodcode', 'state=../../x&code=goodcode'])
    assert.equal((await call('GET', `/desk/auth/github/callback?${q}`)).status, 400, q);
  const st = new URL((await call('GET', '/desk/auth/github/start')).headers.Location).searchParams.get('state');
  clock.t += 11 * 60_000;
  assert.equal((await call('GET', `/desk/auth/github/callback?state=${st}&code=goodcode`)).status, 400, 'expired');
  const st2 = new URL((await call('GET', '/desk/auth/github/start')).headers.Location).searchParams.get('state');
  assert.equal((await call('GET', `/desk/auth/github/callback?state=${st2}&code=badcode`)).status, 502, 'GitHub refuses the code');
  assert.equal((await call('GET', `/desk/auth/github/callback?state=${st2}&code=goodcode`)).status, 400, 'the state was used up');
  assert.equal((await call('GET', '/desk/auth/github/start?t=0000000000000000')).status, 400, 'unknown link token');
  for (const auth of ['', 'Bearer nope', 'Bearer 0123456789abcdef0123'])
    assert.equal((await call('GET', '/desk/me', { auth })).status, 401, auth);
});

test('sign-in with GitHub alone (no email) creates a member and later sign-ins reuse it', async () => {
  const { call, store } = setup();
  const go = async () => {
    const st = new URL((await call('GET', '/desk/auth/github/start')).headers.Location).searchParams.get('state');
    return call('GET', `/desk/auth/github/callback?state=${st}&code=goodcode`);
  };
  assert.equal((await go()).status, 302);
  assert.equal((await go()).status, 302);
  const members = await store.list('member:');
  assert.equal(members.length, 1);
  assert.equal(members[0][1].email, '');
});
