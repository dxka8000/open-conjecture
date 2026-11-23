import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Desk, parseLemmas } from '../src/logic.mjs';
import { MemStore } from '../src/memstore.mjs';

const SITE = 'https://example.test/site';
const LEMMAS_URL = 'https://example.test/Lemmas.lean';
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

const LEMMAS_TEXT = [
  'import OpenConjecture.Collatz.Basic',
  '',
  'namespace OpenConjecture.Collatz',
  '',
  'def Drop_2_0 : Prop := ∀ n : ℕ, n % 2 = 0 → 1 < n → step^[1] n < n',
  'def Drop_4_1 : Prop := ∀ n : ℕ, n % 4 = 1 → 1 < n → step^[3] n < n',
  'def Drop_16_3 : Prop := ∀ n : ℕ, n % 16 = 3 → 1 < n → step^[6] n < n',
  'def Drop_32_11 : Prop := ∀ n : ℕ, n % 32 = 11 → 1 < n → step^[8] n < n',
  'def Drop_32_23 : Prop := ∀ n : ℕ, n % 32 = 23 → 1 < n → step^[8] n < n',
  'def Bridge : Prop := (∀ n : ℕ, 1 < n → ∃ k : ℕ, step^[k] n < n) → Conjecture',
  'def Wrapped_1 : Prop :=',
  '  ∀ n : ℕ, n % 2 = 1 → 1 < n → step^[2] n < n',
  '',
  'end OpenConjecture.Collatz',
  '',
].join('\n');

const EXACT = {
  Drop_2_0: '∀ n : ℕ, n % 2 = 0 → 1 < n → step^[1] n < n',
  Drop_4_1: '∀ n : ℕ, n % 4 = 1 → 1 < n → step^[3] n < n',
  Drop_16_3: '∀ n : ℕ, n % 16 = 3 → 1 < n → step^[6] n < n',
  Drop_32_11: '∀ n : ℕ, n % 32 = 11 → 1 < n → step^[8] n < n',
  Drop_32_23: '∀ n : ℕ, n % 32 = 23 → 1 < n → step^[8] n < n',
  Bridge: '(∀ n : ℕ, 1 < n → ∃ k : ℕ, step^[k] n < n) → Conjecture',
};

const rec = (id, kind, statement, difficulty) => ({
  id,
  kind,
  statement,
  difficulty,
  title_en: `EN ${id}`,
  title_zh: `ZH ${id}`,
  status: 'open',
});

function makeFeed() {
  return {
    records: [
      rec('d-2-0', 'drop', 'Drop_2_0', 1),
      rec('d-4-1', 'drop', 'Drop_4_1', 3),
      rec('d-16-3', 'drop', 'Drop_16_3', 6),
      rec('d-32-11', 'drop', 'Drop_32_11', 8),
      rec('d-32-23', 'drop', 'Drop_32_23', 8),
      rec('m-bridge', 'milestone', 'Bridge', 40),
    ],
  };
}

// mulberry32: small seeded PRNG so picks are reproducible
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const json = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
const text = (s) => ({ ok: true, status: 200, json: async () => ({}), text: async () => s });

function setup() {
  const feed = makeFeed();
  const fetchFn = async (url) => {
    if (url === `${SITE}/feed.json`) return json({ records: feed.records });
    if (url === LEMMAS_URL) return text(LEMMAS_TEXT);
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  const clock = { t: T0 };
  const desk = new Desk({
    store: new MemStore(),
    fetchFn,
    now: () => clock.t,
    random: seeded(7),
    site: SITE,
    lemmasUrl: LEMMAS_URL,
  });
  let leaseSeq = 0;
  desk.newId = () => `lease-${++leaseSeq}`;

  // Each call advances the fake clock by `tick` ms first (default 2.1 s, which clears the /next gap).
  const call = (method, path, opts = {}) => {
    const { ip = '198.51.100.7', tick = 2100 } = opts;
    clock.t += tick;
    const u = new URL(path, 'http://desk.test');
    return desk.handle({ method, pathname: u.pathname, searchParams: u.searchParams, ip });
  };
  const next = (handle, extra = '', opts) => call('GET', `/desk/next?handle=${handle}${extra}`, opts);
  const release = (lease, reason, opts) => call('POST', `/desk/release?lease=${lease}&reason=${reason}`, opts);
  return { desk, clock, feed, call, next, release };
}

test('parseLemmas extracts exact statements, including wrapped ones', () => {
  const m = parseLemmas(LEMMAS_TEXT);
  for (const [name, stmt] of Object.entries(EXACT)) assert.equal(m.get(name), stmt);
  assert.equal(m.get('Wrapped_1'), '∀ n : ℕ, n % 2 = 1 → 1 < n → step^[2] n < n');
});

test('next assigns a drop task with the exact Lean statement', async () => {
  const { next } = setup();
  const r = await next('alice');
  assert.equal(r.status, 200);
  const { gap, lease } = r.body;
  assert.equal(gap.kind, 'drop');
  assert.equal(gap.hard, false);
  assert.equal(gap.statement, EXACT[gap.statement_name]);
  assert.equal(gap.file, `OpenConjecture/Collatz/Proofs/${gap.statement_name}.lean`);
  assert.equal(gap.namespace, `OpenConjecture.Collatz.Proofs.${gap.statement_name}`);
  assert.equal(gap.record, `records/collatz/${gap.id}.json`);
  assert.deepEqual(gap.history, {});
  assert.ok(lease.id && lease.expires_at);
});

test('two handles get different tasks', async () => {
  const { next } = setup();
  const a = await next('alice');
  const b = await next('bob');
  assert.notEqual(a.body.gap.id, b.body.gap.id);
});

test('same handle without another gets its lease back', async () => {
  const { next } = setup();
  const a = await next('alice');
  const b = await next('alice');
  assert.equal(b.body.lease.id, a.body.lease.id);
  assert.equal(b.body.gap.id, a.body.gap.id);
});

test('another=1 gives a second task and stops at 5 leases', async () => {
  const { next } = setup();
  const ids = new Set();
  for (let i = 0; i < 5; i++) {
    const r = await next('alice', '&another=1');
    assert.equal(r.status, 200);
    ids.add(r.body.gap.id);
  }
  assert.equal(ids.size, 5);
  const sixth = await next('alice', '&another=1');
  assert.equal(sixth.status, 429);
  assert.match(sixth.body.error, /5 leases/);
});

test('hard tasks can be shared, and the least-held one is preferred', async () => {
  const { next, feed } = setup();
  const a = await next('alice', '&hard=1');
  const b = await next('bob', '&hard=1');
  assert.equal(a.body.gap.hard, true);
  assert.equal(a.body.gap.id, 'm-bridge');
  assert.equal(b.body.gap.id, 'm-bridge');
  assert.notEqual(a.body.lease.id, b.body.lease.id);

  // A second milestone: a third agent should go to the one with fewer holders.
  feed.records.push(rec('m-2', 'milestone', 'Bridge', 40));
  const c = await next('carol', '&hard=1');
  assert.equal(c.body.gap.id, 'm-2');
  const d = await next('dave', '&hard=1');
  // m-bridge now has 2 holders (alice, bob), m-2 has 1 (carol)
  assert.equal(d.body.gap.id, 'm-2');
});

test('beat extends the lease and caps it at created + 6 h', async () => {
  const { next, call, clock } = setup();
  const a = await next('alice');
  const id = a.body.lease.id;
  const created = clock.t;
  let last;
  for (let i = 0; i < 23; i++) {
    clock.t += 15 * MIN;
    last = await call('POST', `/desk/beat?lease=${id}`, { tick: 0 });
    assert.equal(last.status, 200);
  }
  assert.equal(last.body.expires_at, new Date(created + 6 * HOUR).toISOString());
  // one more 15 min: the cap has been reached, so the lease is over
  clock.t += 15 * MIN;
  const over = await call('POST', `/desk/beat?lease=${id}`, { tick: 0 });
  assert.equal(over.status, 410);
});

test('beat returns 410 after the lease expires', async () => {
  const { next, call, clock } = setup();
  const a = await next('alice');
  clock.t += 21 * MIN;
  const r = await call('POST', `/desk/beat?lease=${a.body.lease.id}`, { tick: 0 });
  assert.equal(r.status, 410);
});

test('beat returns 404 for an unknown lease', async () => {
  const { call } = setup();
  const r = await call('POST', '/desk/beat?lease=nope');
  assert.equal(r.status, 404);
});

test('beat returns 410 settled once the task is verified, and deletes the lease', async () => {
  const { next, call, clock, feed, release: rel } = setup();
  const a = await next('alice');
  const task = feed.records.find((r) => r.id === a.body.gap.id);
  task.status = 'verified';
  clock.t += 2 * MIN; // let the 60 s feed cache expire
  const r = await call('POST', `/desk/beat?lease=${a.body.lease.id}`, { tick: 0 });
  assert.equal(r.status, 410);
  assert.equal(r.body.settled, true);
  const after = await rel(a.body.lease.id, 'submitted', { tick: 0 });
  assert.equal(after.status, 404);
});

test('release records the reason and frees the task', async () => {
  const { next, release, call } = setup();
  const a = await next('alice');
  const task = a.body.gap.id;
  const r = await release(a.body.lease.id, 'submitted');
  assert.equal(r.status, 200);

  const t = await call('GET', `/desk/task/${task}`);
  assert.equal(t.body.holders_now, 0);
  assert.equal(t.body.history[0].type, 'released:submitted');
  assert.equal(t.body.history[0].handle, 'alice');
  assert.equal(t.body.history[1].type, 'took');

  const beat = await call('POST', `/desk/beat?lease=${a.body.lease.id}`);
  assert.equal(beat.status, 404);
});

test('release with out_of_time gives the same handle a cooldown on that task', async () => {
  const { next, release, call } = setup();
  const a = await next('alice');
  const task = a.body.gap.id;
  await release(a.body.lease.id, 'out_of_time');
  for (let i = 0; i < 4; i++) {
    const b = await next('alice');
    assert.equal(b.status, 200);
    assert.notEqual(b.body.gap.id, task);
    await release(b.body.lease.id, 'submitted');
  }
  const t = await call('GET', `/desk/task/${task}`);
  assert.equal(t.body.history[0].type, 'released:out_of_time');
  // history on the task records every release that happened to it
  assert.equal(t.body.history.filter((h) => h.type === 'took').length, 1);
});

test('bad handle returns 400', async () => {
  const { next } = setup();
  for (const h of ['', 'a'.repeat(40), 'bad_name', 'x%20y', 'a%2Fb']) {
    const r = await next(h);
    assert.equal(r.status, 400, `handle ${JSON.stringify(h)}`);
  }
});

test('bad release reason returns 400', async () => {
  const { next, release } = setup();
  const a = await next('alice');
  const r = await release(a.body.lease.id, 'bored');
  assert.equal(r.status, 400);
});

test('/next is limited to one request per 2 s per handle', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/desk/next?handle=carol', { tick: 0 })).status, 200);
  const early = await call('GET', '/desk/next?handle=carol', { tick: 0 });
  assert.equal(early.status, 429);
  assert.equal(early.body.retry_after_s, 2);
  const later = await call('GET', '/desk/next?handle=carol', { tick: 1000 });
  assert.equal(later.status, 429);
  assert.equal(later.body.retry_after_s, 1);
  assert.equal((await call('GET', '/desk/next?handle=carol', { tick: 1100 })).status, 200);
});

test('overall limit is 30 requests per minute per client IP', async () => {
  const { call, clock } = setup();
  for (let i = 0; i < 30; i++) {
    assert.equal((await call('GET', '/desk/status', { tick: 0, ip: '203.0.113.9' })).status, 200);
  }
  const limited = await call('GET', '/desk/status', { tick: 0, ip: '203.0.113.9' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.retry_after_s, 60);
  // another address is unaffected
  assert.equal((await call('GET', '/desk/status', { tick: 0, ip: '203.0.113.10' })).status, 200);
  clock.t += 60 * 1000 + 1;
  assert.equal((await call('GET', '/desk/status', { tick: 0, ip: '203.0.113.9' })).status, 200);
});

test('status counts agents, leases, releases and reasons', async () => {
  const { next, release, call } = setup();
  const a = await next('alice');
  const b = await next('bob');
  const a2 = await next('alice', '&another=1');
  await release(a2.body.lease.id, 'submitted');
  await release(b.body.lease.id, 'out_of_time');

  const s = await call('GET', '/desk/status');
  assert.equal(s.status, 200);
  const body = s.body;
  assert.equal(body.agents_now, 1);
  assert.equal(body.leases_active, 1);
  assert.equal(body.tasks_open, 6);
  assert.equal(body.released_last_hour, 2);
  assert.equal(body.submitted_last_hour, 1);
  assert.equal(body.by_reason_24h.submitted, 1);
  assert.equal(body.by_reason_24h.out_of_time, 1);
  assert.equal(body.by_reason_24h.other, 0);
  assert.equal(body.recent.length, 5);
  assert.equal(body.recent[0].type, 'released:out_of_time');
  assert.equal(body.recent[0].handle, 'bob');
  assert.equal(body.recent[4].type, 'took');
  assert.ok(a.body.lease.id);
});

test('when every easy task is leased, the least-held one is shared instead of refusing', async () => {
  const { next } = setup();
  const taken = new Set();
  for (let i = 0; i < 5; i++) {
    const r = await next('alice', '&another=1');
    assert.equal(r.status, 200);
    taken.add(r.body.gap.id);
  }
  const r = await next('bob');
  assert.equal(r.status, 200);
  assert.ok(r.body.gap, 'bob still gets a task');
  assert.ok(taken.has(r.body.gap.id), 'it is one of the already-leased tasks');
});

test('gap is null only when the handle can take nothing at all', async () => {
  const { next } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await next('alice', '&another=1')).status, 200);
  // alice already holds every drop task, so another one is impossible for her
  const r = await next('alice', '&another=1');
  assert.notEqual(r.status, 200);
});

test('unknown routes return 404', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/desk/nope')).status, 404);
  assert.equal((await call('GET', '/elsewhere')).status, 404);
  assert.equal((await call('POST', '/desk/status')).status, 404);
});
