// Anonymous page-view counts: counting, visitors, bot filtering, caps, rate limits, privacy and admin auth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Desk, STATS_CAP, HIT_IP_LIMIT } from '../src/logic.mjs';
import { MemStore } from '../src/memstore.mjs';

const TOKEN = 'stats-admin-token-0123456789';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const DAY = 86_400_000;

function setup() {
  const clock = { t: Date.UTC(2026, 10, 24, 12) };
  const store = new MemStore();
  let n = 0;
  const desk = new Desk({ store, fetchFn: async () => ({ ok: false, status: 404 }), now: () => clock.t, adminToken: TOKEN, newId: () => `id${++n}` });
  const call = (method, path, { body = '', ip = '203.0.113.5', ua = UA, country = 'NZ', auth = '', tick = 500 } = {}) => {
    clock.t += tick;
    const u = new URL(path, 'http://desk.test');
    return desk.handle({ method, pathname: u.pathname, searchParams: u.searchParams, ip, ua, country, auth, body: typeof body === 'string' ? body : JSON.stringify(body) });
  };
  const hit = (path, ref = '', opts = {}) => call('POST', '/desk/hit', { ...opts, body: { path, ref } });
  const stats = (days = 30, auth = `Bearer ${TOKEN}`) => call('GET', `/desk/admin/stats?days=${days}`, { auth });
  return { clock, store, desk, call, hit, stats };
}

test('page views are counted per day, path, referrer host and country, with distinct visitors', async () => {
  const { hit, stats } = setup();
  assert.equal((await hit('/', '')).status, 204);
  await hit('/', 'news.ycombinator.com');
  await hit('/lemmas.html', 'news.ycombinator.com', { ip: '198.51.100.9', country: 'US' });
  await hit('/', '', { ip: '198.51.100.9', ua: UA + ' other' }); // same IP, other browser: a second visitor
  const r = await stats(1);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.days, [{ date: '2026-11-24', views: 4, visitors: 3, signups: 0 }]);
  assert.deepEqual(r.body.paths, [{ key: '/', n: 3 }, { key: '/lemmas.html', n: 1 }]);
  assert.deepEqual(r.body.referrers, [{ key: '(direct)', n: 2 }, { key: 'news.ycombinator.com', n: 2 }]);
  assert.deepEqual(r.body.countries, [{ key: 'NZ', n: 3 }, { key: 'US', n: 1 }]);
  assert.equal(r.body.last_24h, 4);
});

test('bots and empty user agents are ignored', async () => {
  const { hit, stats } = setup();
  for (const ua of ['', 'Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'AhrefsSiteAuditCrawler', 'Baiduspider', 'HeadlessChrome/120', 'curl/8.0'])
    assert.equal((await hit('/', '', { ua })).status, 204);
  assert.equal((await stats(1)).body.days[0].views, 0);
});

test('bad paths and referrers are bucketed as other; malformed bodies still count once', async () => {
  const { hit, call, stats } = setup();
  await hit('/<script>', 'evil.com/<x>');
  await hit('not-a-path', 'UPPER.example.COM');
  await call('POST', '/desk/hit', { body: 'garbage' });
  const r = (await stats(1)).body;
  assert.equal(r.days[0].views, 3);
  assert.deepEqual(r.paths, [{ key: 'other', n: 3 }]);
  assert.ok(r.referrers.some((x) => x.key === 'upper.example.com'));
  assert.ok(r.referrers.some((x) => x.key === 'other'));
});

test(`at most ${STATS_CAP} distinct paths and referrers per day; the rest go to "other"`, async () => {
  const { hit, stats, desk } = setup();
  for (let i = 0; i < STATS_CAP + 30; i++) await hit(`/p${i}`, `r${i}.example.com`, { ip: `10.${i >> 8}.${i & 255}.1` });
  const s = await desk.store.get('stats:2026-11-24');
  assert.equal(Object.keys(s.paths).length, STATS_CAP + 1);
  assert.equal(s.paths.other, 30);
  assert.equal(s.refs.other, 30);
  assert.equal((await stats(1)).body.days[0].views, STATS_CAP + 30);
});

test(`rate limit: at most ${HIT_IP_LIMIT} counted hits per hour per address`, async () => {
  const { hit, stats, clock } = setup();
  for (let i = 0; i < HIT_IP_LIMIT + 20; i++) await hit('/', '', { tick: 2100 }); // under the general 30-per-minute limit
  assert.equal((await stats(1)).body.days[0].views, HIT_IP_LIMIT);
  assert.equal((await hit('/', '', { ip: '198.51.100.200' })).status, 204);
  assert.equal((await stats(1)).body.days[0].views, HIT_IP_LIMIT + 1, 'another address still counts');
  clock.t += 3_600_000;
  await hit('/', '', { tick: 2100 });
  assert.equal((await stats(1)).body.days[0].views, HIT_IP_LIMIT + 2, 'the limit resets after an hour');
});

test('nothing stored contains an IP, a user agent, or anything that outlives the day', async () => {
  const { hit, store, clock } = setup();
  await hit('/', 'example.org', { ip: '203.0.113.77' });
  const dump = JSON.stringify(await store.list(''));
  assert.ok(!dump.includes('203.0.113.77'), dump);
  assert.ok(!dump.includes('Chrome/130'), dump);
  assert.ok((await store.list('uv:2026-11-24')).length > 0);
  clock.t += DAY;
  await hit('/', '', { ip: '203.0.113.77' });
  assert.equal((await store.list('uv:2026-11-24')).length, 0, 'yesterday\'s visitor hashes are deleted');
  assert.equal((await store.list('salt:2026-11-24')).length, 0, 'yesterday\'s salt is deleted');
  assert.ok(await store.get('stats:2026-11-24'), 'aggregated counts are kept');
});

test('a returning visitor on a new day counts again (daily salt)', async () => {
  const { hit, stats, clock } = setup();
  await hit('/');
  await hit('/');
  clock.t += DAY;
  await hit('/');
  const days = (await stats(2)).body.days;
  assert.deepEqual(days.map((d) => d.visitors), [1, 1]);
});

test('stats need the admin token; wrong or missing tokens get 401, and no token configured means 404', async () => {
  const { stats } = setup();
  assert.equal((await stats(30, '')).status, 401);
  assert.equal((await stats(30, 'Bearer nope')).status, 401);
  assert.equal((await stats(30, TOKEN)).status, 401);
  const off = new Desk({ store: new MemStore(), fetchFn: async () => ({ ok: false }), now: () => 0, adminToken: '' });
  const r = await off.handle({ method: 'GET', pathname: '/desk/admin/stats', searchParams: new URLSearchParams(), ip: '1.1.1.1', auth: 'Bearer x' });
  assert.equal(r.status, 404);
});

test('days is clamped, and missing days come back as zeros', async () => {
  const { stats } = setup();
  const r = (await stats(9999)).body;
  assert.equal(r.days.length, 400);
  assert.ok(r.days.every((d) => d.views === 0));
});
