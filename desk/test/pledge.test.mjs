// Sponsor pledges: validation, privacy (no email in any public answer), rate limits, admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Desk, PLEDGE_IP_LIMIT } from '../src/logic.mjs';
import { MemStore } from '../src/memstore.mjs';

const TOKEN = 'test-admin-token-0123456789';
const HOUR = 3_600_000;

function setup({ adminToken = TOKEN } = {}) {
  const clock = { t: Date.UTC(2026, 10, 24, 12) };
  const desk = new Desk({ store: new MemStore(), fetchFn: async () => ({ ok: false, status: 404 }), now: () => clock.t, adminToken });
  const call = (method, path, { body, ip = '203.0.113.5', auth = '' } = {}) => {
    clock.t += 1000;
    const u = new URL(path, 'http://desk.test');
    return desk.handle({ method, pathname: u.pathname, searchParams: u.searchParams, ip,
      body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body), auth });
  };
  const pledge = (body, opts = {}) => call('POST', '/desk/pledge', { ...opts, body });
  const wall = async () => (await call('GET', '/desk/sponsors')).body.sponsors;
  return { clock, desk, call, pledge, wall };
}
const P = (o = {}) => ({ name: 'Example Lab', tagline: 'Agents that prove things', link: 'https://example.com/lab', amount: 50, email: 'Founder@Example.com', ...o });

test('a valid pledge appears on the public wall with no email', async () => {
  const { pledge, wall, call } = setup();
  const r = await pledge(P());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, amount: 50, total_pledged: 50, member: false });
  const w = await wall();
  assert.equal(w.length, 1);
  assert.deepEqual({ ...w[0], since: undefined }, { rank: 1, name: 'Example Lab', tagline: 'Agents that prove things', link: 'https://example.com/lab', pledged: 50, paid: 0, since: undefined });
  for (const path of ['/desk/sponsors', '/desk/status']) {
    const text = JSON.stringify((await call('GET', path)).body);
    assert.ok(!/@|founder|example\.com\b(?!\/lab)/i.test(text.replace('https://example.com/lab', '')), `${path} leaks: ${text}`);
  }
});

test('the same email (any case) adds to one entry; latest name, tagline and link win', async () => {
  const { pledge, wall } = setup();
  await pledge(P({ amount: 10 }));
  const r = await pledge(P({ amount: 25.5, email: 'founder@example.COM', name: 'Example Lab Inc', tagline: '', link: '' }));
  assert.equal(r.body.total_pledged, 35.5);
  const w = await wall();
  assert.equal(w.length, 1);
  assert.equal(w[0].name, 'Example Lab Inc');
  assert.equal(w[0].tagline, 'Agents that prove things'); // empty fields keep the earlier value
  assert.equal(w[0].pledged, 35.5);
});

test('the wall is ranked by total, then by who pledged first', async () => {
  const { pledge, wall } = setup();
  await pledge(P({ name: 'A', email: 'a@x.org', amount: 5 }), { ip: '1.1.1.1' });
  await pledge(P({ name: 'B', email: 'b@x.org', amount: 100 }), { ip: '1.1.1.2' });
  await pledge(P({ name: 'C', email: 'c@x.org', amount: 5 }), { ip: '1.1.1.3' });
  await pledge(P({ name: 'A', email: 'a@x.org', amount: 1000 }), { ip: '1.1.1.4' });
  assert.deepEqual((await wall()).map((s) => [s.rank, s.name, s.pledged]), [[1, 'A', 1005], [2, 'B', 100], [3, 'C', 5]]);
});

test('validation: every field is checked and capped', async () => {
  const { pledge, wall } = setup();
  const bad = [
    [P({ name: '' }), /name/], [P({ name: '   ' }), /name/], [P({ name: 'x'.repeat(61) }), /name/], [P({ name: 7 }), /name/],
    [P({ tagline: 'x'.repeat(81) }), /tagline/], [P({ tagline: ['a'] }), /tagline/],
    [P({ link: 'http://example.com' }), /link/], [P({ link: 'javascript:alert(1)' }), /link/],
    [P({ link: 'https://example.com/"><script>' }), /link/], [P({ link: 'https://' + 'a'.repeat(200) + '.com' }), /link/],
    [P({ email: 'not-an-email' }), /email/], [P({ email: '' }), /email/], [P({ email: 'a@b' }), /email/],
    [P({ email: 'a'.repeat(250) + '@example.com' }), /email/], [P({ email: 'a<b>@example.com' }), /email/],
    [P({ amount: 4.99 }), /amount/], [P({ amount: 10001 }), /amount/], [P({ amount: 5.555 }), /amount/],
    [P({ amount: 'lots' }), /amount/], [P({ amount: -5 }), /amount/], [P({ amount: null }), /amount/],
  ];
  for (const [body, re] of bad) {
    const r = await pledge(body, { ip: `10.0.${bad.indexOf(body)}.1` });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, re);
    assert.ok(!JSON.stringify(r.body).includes('@'), 'errors never echo the email');
  }
  assert.equal((await pledge('not json')).status, 400);
  assert.equal((await pledge('[1,2]')).status, 400);
  assert.equal((await pledge('x'.repeat(5000))).status, 413);
  assert.equal((await wall()).length, 0);
});

test('control and bidi characters are stripped; whitespace collapses; the total per email is capped', async () => {
  const { pledge, wall } = setup();
  const r = await pledge(P({ name: ' Evil‮\u0007  Corp\n', tagline: 'a\u0000b' }));
  assert.equal(r.status, 200);
  const w = await wall();
  assert.equal(w[0].name, 'Evil Corp');
  assert.equal(w[0].tagline, 'a b');
  for (let i = 0; i < 4; i++) await pledge(P({ amount: 10000 }), { ip: `10.9.${i}.1` });
  await pledge(P({ amount: 10000 }), { ip: '10.9.8.1' });
  // 50 + 5 * 10000 = 50050; the cap is 100000, so these pass, and a big one beyond the cap fails
  const many = [];
  for (let i = 0; i < 5; i++) many.push((await pledge(P({ amount: 10000 }), { ip: `10.8.${i}.1` })).status);
  assert.ok(many.includes(400), many.join(','));
});

test(`rate limit: at most ${PLEDGE_IP_LIMIT} pledges per hour per address`, async () => {
  const { pledge, clock } = setup();
  for (let i = 0; i < PLEDGE_IP_LIMIT; i++) assert.equal((await pledge(P({ email: `p${i}@x.org` }))).status, 200);
  const over = await pledge(P({ email: 'over@x.org' }));
  assert.equal(over.status, 429);
  assert.ok(over.body.retry_after_s > 0);
  assert.equal((await pledge(P({ email: 'other@x.org' }), { ip: '198.51.100.99' })).status, 200);
  clock.t += HOUR;
  assert.equal((await pledge(P({ email: 'later@x.org' }))).status, 200);
});

test('invalid pledges still count toward the rate limit only when they pass validation', async () => {
  const { pledge } = setup();
  for (let i = 0; i < 20; i++) await pledge(P({ amount: 1 }));
  assert.equal((await pledge(P())).status, 200);
});

test('admin: disabled without a token, 401 with a wrong one', async () => {
  const off = setup({ adminToken: '' });
  await off.pledge(P());
  assert.equal((await off.call('POST', '/desk/admin/list', { auth: 'Bearer ' })).status, 404);
  const short = setup({ adminToken: 'short' }); // tokens under 16 characters are ignored
  assert.equal((await short.call('POST', '/desk/admin/list', { auth: 'Bearer short' })).status, 404);
  const { call, pledge } = setup();
  await pledge(P());
  for (const auth of ['', 'Bearer wrong', `Bearer ${TOKEN}x`, TOKEN, `bearer ${TOKEN}`])
    assert.equal((await call('POST', '/desk/admin/list', { auth })).status, 401, auth);
});

test('admin: list shows emails, mark-paid records payment, hide removes from the wall', async () => {
  const { call, pledge, wall } = setup();
  await pledge(P());
  await pledge(P({ name: 'Spam', email: 'spam@x.org', amount: 9999 }), { ip: '1.2.3.4' });
  const auth = `Bearer ${TOKEN}`;
  const list = await call('POST', '/desk/admin/list', { auth });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.pledges.map((p) => p.email), ['Founder@Example.com', 'spam@x.org']);

  const paid = await call('POST', '/desk/admin/mark-paid', { auth, body: { email: 'founder@example.com', amount: 50 } });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.paid, 50);
  assert.equal((await call('POST', '/desk/admin/mark-paid', { auth, body: { email: 'nobody@x.org', amount: 5 } })).status, 404);
  assert.equal((await call('POST', '/desk/admin/mark-paid', { auth, body: { email: 'founder@example.com', amount: 0 } })).status, 400);

  assert.equal((await call('POST', '/desk/admin/hide', { auth, body: { email: 'spam@x.org' } })).status, 200);
  const w = await wall();
  assert.deepEqual(w.map((s) => [s.name, s.pledged, s.paid]), [['Example Lab', 50, 50]]);
  assert.equal((await call('POST', '/desk/admin/hide', { auth, body: { email: 'spam@x.org', hidden: false } })).status, 200);
  assert.equal((await wall()).length, 2);
});

test('pledge endpoints only accept the right methods', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/desk/pledge')).status, 404);
  assert.equal((await call('POST', '/desk/sponsors')).status, 404);
  assert.equal((await call('GET', '/desk/admin/list')).status, 404);
});
