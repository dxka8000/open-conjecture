import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Desk, parseLemmas } from '../src/logic.mjs';
import { MemStore } from '../src/memstore.mjs';

const SITE = 'https://example.test/site';
const LEMMAS_URL = 'https://example.test/Lemmas.lean';
const PULLS_URL = 'https://api.github.com/repos/proofhive/proofhive.github.io/pulls?state=open&per_page=100';
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
  'def Step_A : Prop := ∀ n : ℕ, n % 8 = 5 → 1 < n → step^[4] n < n',
  'def Prog_P : Prop := ∀ n : ℕ, 1 < n → ∃ k : ℕ, step^[k] n < n',
  'def Summit_S : Prop := Conjecture',
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

const PR = (number, title, login) => ({ number, title, user: { login } });

function setup() {
  const feed = makeFeed();
  // remote.pulls is the GitHub pulls list; pullsStatus != 200 makes the fetch fail.
  const remote = { pulls: [], pullsStatus: 200, pullsCalls: 0 };
  const fetchFn = async (url) => {
    if (url === `${SITE}/feed.json`) return json({ records: feed.records });
    if (url === `${SITE}/library-tasks.json` && remote.library) return json({ tasks: remote.library });
    if (url === LEMMAS_URL) return text(LEMMAS_TEXT);
    if (url === PULLS_URL) {
      remote.pullsCalls++;
      if (remote.pullsStatus !== 200) return { ok: false, status: remote.pullsStatus, json: async () => ({}), text: async () => '' };
      return json(remote.pulls);
    }
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
  return { desk, clock, feed, remote, call, next, release };
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

const hist = async (call, id) => (await call('GET', `/desk/task/${id}`)).body.history;
const STEP_A = '∀ n : ℕ, n % 8 = 5 → 1 < n → step^[4] n < n';

test('unknown role returns 400; build, think and redteam are accepted', async () => {
  const { next } = setup();
  for (const role of ['summit', 'review']) {
    const bad = await next('h-' + role, '&role=' + role);
    assert.equal(bad.status, 400, role);
    assert.match(bad.body.error, /role must be one of: build, think, redteam/);
  }
  for (const role of ['build', 'think', 'redteam']) {
    assert.equal((await next('h-' + role, '&role=' + role)).status, 200, role);
  }
});

test('think prefers statements handed back with missing_lemma, skips ones already split, and points at Proposals/', async () => {
  const { next, release, feed } = setup();
  feed.records.push(rec('p-1', 'program', 'Prog_P', 900), rec('st-a', 'step', 'Step_A', 4));
  for (const r of feed.records) r.notes = 2; // enough notes: think hands out split tasks
  const b = await next('bob', '&hard=1');
  const other = b.body.gap.id === 'm-bridge' ? 'p-1' : 'm-bridge';
  feed.records.find((r) => r.id === 'st-a').parent = other; // the other hard statement is already split
  await release(b.body.lease.id, 'missing_lemma');
  const t1 = await next('tina', '&role=think');
  assert.equal(t1.body.gap.id, b.body.gap.id);
  assert.equal(t1.body.gap.role, 'think');
  assert.equal(t1.body.gap.kind, 'split');
  assert.match(t1.body.gap.file, /^OpenConjecture\/Collatz\/Proposals\/Split_[A-Za-z0-9_]+\.lean$/);
  const seen = new Set();
  for (const h of ['u1', 'u2', 'u3', 'u4', 'u5']) { const r = await next(h, '&role=think'); if (r.body.gap) seen.add(r.body.gap.id); }
  assert.ok(!seen.has(other), [...seen].join(','));
});

test('redteam hands out step, milestone, program in that order, with Refute_ file and namespace', async () => {
  const { next, feed, call } = setup();
  feed.records.push(rec('st-a', 'step', 'Step_A', 4), rec('p-1', 'program', 'Prog_P', 30));
  const a = await next('alice', '&role=redteam');
  assert.equal(a.status, 200);
  const { gap, lease } = a.body;
  assert.equal(gap.id, 'st-a');
  assert.equal(gap.role, 'redteam');
  assert.equal(gap.statement, STEP_A);
  assert.equal(gap.file, 'OpenConjecture/Collatz/Proofs/Refute_Step_A.lean');
  assert.equal(gap.namespace, 'OpenConjecture.Collatz.Proofs.Refute_Step_A');
  assert.equal((await hist(call, 'st-a'))[0].type, 'took:redteam');
  for (const h of ['bob', 'carol', 'dave', 'erin']) {
    const r = await next(h, '&role=redteam');
    assert.ok(['step', 'milestone', 'program'].includes(r.body.gap.kind), r.body.gap.kind);
    assert.ok(!r.body.gap.id.startsWith('d-'));
  }
  assert.ok(lease.id);
});

test('redteam ranks by statement_seems_false releases, not missing_lemma', async () => {
  const { next, release, feed } = setup();
  feed.records.push(rec('st-a', 'step', 'Step_A', 4));
  const R = '&role=redteam';
  const a = await next('alice', R);
  assert.equal(a.body.gap.id, 'st-a');
  await release(a.body.lease.id, 'missing_lemma'); // not a refute signal
  const b = await next('bob', R); // st-a: 0 holders, no refute signal
  assert.equal(b.body.gap.id, 'st-a');
  const c = await next('carol', R); // st-a is held, so m-bridge
  assert.equal(c.body.gap.id, 'm-bridge');
  await release(c.body.lease.id, 'statement_seems_false'); // m-bridge: 1 refute signal, 0 holders
  await release(b.body.lease.id, 'submitted'); // st-a: 0 holders, 0 signals
  const d = await next('dave', R);
  assert.equal(d.body.gap.id, 'm-bridge');
});

test('beat returns 410 settled when the task is refuted, and deletes the lease', async () => {
  const { next, call, clock, feed, release: rel } = setup();
  const a = await next('alice');
  const task = feed.records.find((r) => r.id === a.body.gap.id);
  task.status = 'refuted';
  clock.t += 2 * MIN; // let the 60 s feed cache expire
  const r = await call('POST', `/desk/beat?lease=${a.body.lease.id}`, { tick: 0 });
  assert.equal(r.status, 410);
  assert.equal(r.body.settled, true);
  assert.equal((await rel(a.body.lease.id, 'submitted', { tick: 0 })).status, 404);
});

test('a re-served redteam gap keeps the Refute_ file', async () => {
  const { next, feed } = setup();
  feed.records.push(rec('st-a', 'step', 'Step_A', 4));
  const a = await next('alice', '&role=redteam');
  const b = await next('alice', '&role=redteam');
  assert.equal(b.body.gap.id, a.body.gap.id);
  assert.equal(b.body.gap.file, 'OpenConjecture/Collatz/Proofs/Refute_Step_A.lean');
});

test('with no open steps or drops on the board, a plain builder request gets an open problem', async () => {
  const { next, feed } = setup();
  for (const r of feed.records) if (r.kind === 'drop' || r.kind === 'step') r.status = 'verified';
  feed.records.push(rec('p-1', 'program', 'Prog_P', 900));
  const a = await next('alice');
  assert.equal(a.status, 200);
  assert.ok(['program', 'milestone'].includes(a.body.gap.kind), a.body.gap.kind);
});

test('think prefers records with fewer research notes, and offers a note file', async () => {
  const { next, feed } = setup();
  feed.records.push(rec('p-1', 'program', 'Prog_P', 900), rec('p-2', 'program', 'Prog_P', 900));
  for (const r of feed.records) r.notes = 3;
  feed.records.find((r) => r.id === 'p-2').notes = 0;
  const a = await next('alice', '&role=think');
  assert.equal(a.body.gap.id, 'p-2');
  assert.equal(a.body.gap.notes, 0);
  assert.equal(a.body.gap.note_file, 'notes/p-2/<your GitHub login>-<slug>.md');
  assert.equal(a.body.gap.kind, 'note');
  assert.equal(Object.keys(a.body.gap)[0], 'kind');
  assert.equal(Object.keys(a.body.gap)[1], 'note_file');
  assert.match(a.body.gap.help, /agent\.md/);
  assert.equal(a.body.gap.file, undefined, 'no split fields on a note task');
});

test('think tasks link the notes already accepted for that record, and drop anything that is not a note permalink', async () => {
  const { next, feed } = setup();
  feed.records.push(rec('p-1', 'program', 'Prog_P', 900));
  for (const r of feed.records) r.notes = 3;
  const p1 = feed.records.find((r) => r.id === 'p-1');
  p1.notes = 1;
  p1.note_links = [
    { title: 'Survey', who: 'nina', date: '2026-11-24', url: 'https://proofhive.github.io/notes/p-1/nina-survey.html' },
    { title: 'evil', who: 'x', date: '2026-11-24', url: 'javascript:alert(1)' },
    { title: 'elsewhere', who: 'x', date: '2026-11-24', url: 'https://evil.example/phish' },
  ];
  const a = await next('alice', '&role=think');
  assert.equal(a.body.gap.id, 'p-1');
  assert.deepEqual(a.body.gap.existing_notes, [{ title: 'Survey', who: 'nina', date: '2026-11-24', url: 'https://proofhive.github.io/notes/p-1/nina-survey.html' }]);
  assert.match(a.body.gap.read_first, /cite/i);
});

// ---- library problems as research-note tasks (role=think)
const LIB = () => [
  { id: 'fc:erdos_1', folder: 'lib-erdos-1-aaaaaa', title: 'Erdős Problem 1', source: 'Erdős problems', areas: ['Number theory'], statement: 'S1', lean: 'L1', notes: 0, note_links: [] },
  { id: 'fc:moment_isEquiv₃', folder: 'lib-moment-isequiv3-bbbbbb', title: 'Moments', source: 'Open quantum problems', areas: ['Quantum theory'], statement: 'S2', lean: '', notes: 0,
    note_links: [{ title: 'Survey', who: 'nina', date: '2026-11-24', url: 'https://proofhive.github.io/notes/lib-moment-isequiv3-bbbbbb/nina-survey.html' }] },
  { id: 'fc:bad', folder: 'Bad/../x', title: 'bad folder', notes: 0 },
  { id: 'fc:<script>', folder: 'lib-x-cccccc', title: 'bad id', notes: 0 },
];

test('library=1 hands out a library problem as a research-note task, most voted first', async () => {
  const { next, remote, desk } = setup();
  remote.library = LIB();
  await desk.store.put('votes', { 'fc:moment_isEquiv₃': 4, 'fc:erdos_1': 1 });
  const a = await next('alice', '&role=think&library=1');
  assert.equal(a.status, 200);
  const g = a.body.gap;
  assert.equal(g.kind, 'note');
  assert.equal(g.library, true);
  assert.equal(g.id, 'fc:moment_isEquiv₃');
  assert.equal(g.folder, 'lib-moment-isequiv3-bbbbbb');
  assert.equal(g.note_file, 'notes/lib-moment-isequiv3-bbbbbb/<your GitHub login>-<slug>.md');
  assert.equal(g.record_line, 'Record: lib-moment-isequiv3-bbbbbb');
  assert.equal(g.existing_notes.length, 1);
  assert.match(g.help, /library problem/);
  // the same agent asking again gets its lease back; another agent gets the next problem
  const again = await next('alice', '&role=think&library=1');
  assert.equal(again.body.gap.id, 'fc:moment_isEquiv₃');
  assert.equal(again.body.lease.id, a.body.lease.id);
  const b = await next('bob', '&role=think&library=1');
  assert.equal(b.body.gap.id, 'fc:erdos_1');
  // malformed entries are never handed out
  const c = await next('carol', '&role=think&library=1');
  assert.ok(['fc:moment_isEquiv₃', 'fc:erdos_1'].includes(c.body.gap.id));
});

test('by default a board statement that still needs notes comes first; library=0 never gives a library problem', async () => {
  const { next, remote, feed } = setup();
  remote.library = LIB();
  feed.records.push(rec('p-1', 'program', 'Prog_P', 900));
  const a = await next('alice', '&role=think');
  assert.equal(a.body.gap.id, 'p-1');
  assert.equal(a.body.gap.library, undefined);
  for (const r of feed.records) r.notes = 5;
  let sawLibrary = false, sawBoard = false;
  for (const h of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']) {
    const g = (await next(h, '&role=think')).body.gap;
    if (g && g.library) sawLibrary = true; else if (g) sawBoard = true;
  }
  assert.ok(sawLibrary && sawBoard, 'once the board has its notes, think tasks mix library problems and board splits');
  for (const h of ['z1', 'z2', 'z3']) assert.notEqual((await next(h, '&role=think&library=0')).body.gap?.library, true);
});

test('library=1 with no library available answers no task, not a board task', async () => {
  const { next } = setup();
  const a = await next('alice', '&role=think&library=1');
  assert.equal(a.body.gap, null);
});

// ---- campaigns: the headline campaign (Erdős) is handed out first, with its own Lean folder and records folder ----
const erdos = (id, kind, statement, difficulty, extra = {}) => ({ ...rec(id, kind, statement, difficulty), campaign: 'erdos', lean_dir: 'Erdos', campaign_order: 1,
  lean: `statement of ${statement}`, ...extra });
function withErdos(feed) {
  for (const r of feed.records) r.campaign_order = 2; // the Collatz records
  feed.records.push(
    erdos('erdos-242-even', 'milestone', 'Mile_Erdos242_Even', 200, { hard: false }),
    erdos('erdos-850-makowski', 'milestone', 'Mile_Erdos850_Makowski', 100, { hard: false }),
    erdos('erdos-376-two-primes', 'milestone', 'Mile_Erdos376_TwoPrimes', 700),
    erdos('erdos-242-one-mod-840', 'program', 'Open_Erdos242_OneMod840', 900),
  );
}

test('build: an Erdős milestone comes before the Collatz drops, with Erdős paths', async () => {
  const { next, feed } = setup();
  withErdos(feed);
  const a = await next('alice');
  assert.ok(['erdos-242-even', 'erdos-850-makowski'].includes(a.body.gap.id), a.body.gap.id);
  assert.equal(a.body.gap.campaign, 'erdos');
  assert.equal(a.body.gap.hard, false);
  assert.equal(a.body.gap.file, `OpenConjecture/Erdos/Proofs/${a.body.gap.statement_name}.lean`);
  assert.equal(a.body.gap.namespace, `OpenConjecture.Erdos.Proofs.${a.body.gap.statement_name}`);
  assert.equal(a.body.gap.imports, 'import OpenConjecture.Erdos.Lemmas');
  assert.equal(a.body.gap.record, `records/erdos/${a.body.gap.id}.json`);
  assert.equal(a.body.gap.statement, `statement of ${a.body.gap.statement_name}`);
  const b = await next('bob');
  assert.ok(['erdos-242-even', 'erdos-850-makowski'].includes(b.body.gap.id), 'the second small Erdős task goes to the next agent');
  assert.notEqual(a.body.gap.id, b.body.gap.id);
  const c = await next('carol');
  assert.equal(c.body.gap.campaign, 'collatz', 'once the Erdős small tasks are held, Collatz work is next');
  assert.equal(c.body.gap.record, `records/collatz/${c.body.gap.id}.json`);
});

test('hard=1 and think: Erdős statements first', async () => {
  const { next, feed } = setup();
  withErdos(feed);
  const h = await next('alice', '&hard=1');
  assert.equal(h.body.gap.campaign, 'erdos');
  assert.ok(['erdos-376-two-primes', 'erdos-242-one-mod-840'].includes(h.body.gap.id));
  const t = await next('bob', '&role=think&library=0');
  assert.equal(t.body.gap.campaign, 'erdos');
  assert.equal(t.body.gap.kind, 'note');
  assert.equal(t.body.gap.note_file, `notes/${t.body.gap.id}/<your GitHub login>-<slug>.md`);
});

test('campaign=collatz keeps the pick in the Collatz campaign; a bad campaign is a 400', async () => {
  const { next, feed } = setup();
  withErdos(feed);
  const a = await next('alice', '&campaign=collatz');
  assert.equal(a.body.gap.campaign, 'collatz');
  const t = await next('bob', '&role=think&campaign=collatz');
  assert.equal(t.body.gap.id, 'm-bridge', 'the only Collatz statement a thinker can take');
  const e = await next('carol', '&campaign=erdos&hard=1');
  assert.equal(e.body.gap.campaign, 'erdos');
  const bad = await next('dave', '&campaign=Bad!');
  assert.equal(bad.status, 400);
});

// Regression: the live desk once answered an Erdős milestone with Collatz paths (pre-campaign code). Whatever branch picks
// the task (the hard pool when there is no small task, a re-served lease, hard=1), the paths follow the record's campaign.
test('an Erdős task never gets Collatz paths, in any branch; /desk/status shows the desk code', async () => {
  const { next, feed, call } = setup();
  feed.records.length = 0; // only Erdős records, as on the live board where Collatz has no small tasks
  withErdos(feed);
  const check = (g) => {
    assert.equal(g.campaign, 'erdos');
    assert.match(g.file, /^OpenConjecture\/Erdos\/Proofs\//);
    assert.match(g.namespace, /^OpenConjecture\.Erdos\.Proofs\./);
    assert.equal(g.record, `records/erdos/${g.id}.json`);
    assert.ok(!JSON.stringify(g).includes('Collatz') && !JSON.stringify(g).includes('collatz'), JSON.stringify(g));
  };
  const a = await next('alice');
  check(a.body.gap);
  check((await next('alice')).body.gap); // the same lease, served again
  check((await next('bob', '&hard=1')).body.gap);
  check((await next('carol', '&role=redteam')).body.gap);
  const s = await call('GET', '/desk/status');
  assert.equal(s.body.code, 'campaigns-1');
});
