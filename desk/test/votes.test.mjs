import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Desk, VOTES_PER_IP_DAY } from '../src/logic.mjs';
import { MemStore } from '../src/memstore.mjs';

function setup() {
  const clock = { t: Date.UTC(2026, 10, 24, 12) };
  const store = new MemStore();
  let n = 0;
  const desk = new Desk({ store, fetchFn: async () => ({ ok: false }), now: () => clock.t, newId: () => `id${++n}` });
  const call = (method, path, { body = '', ip = '203.0.113.5', tick = 2100 } = {}) => {
    clock.t += tick;
    const u = new URL(path, 'http://desk.test');
    return desk.handle({ method, pathname: u.pathname, searchParams: u.searchParams, ip, body: typeof body === 'string' ? body : JSON.stringify(body) });
  };
  const vote = (id, ip) => call('POST', '/desk/vote', { body: { id }, ip });
  const votes = async () => (await call('GET', '/desk/votes')).body.votes;
  return { clock, store, vote, votes };
}

test('one vote per IP per entry per day; counts are public', async () => {
  const { vote, votes, clock } = setup();
  assert.equal((await vote('fc:erdos_1')).body.counted, true);
  assert.equal((await vote('fc:erdos_1')).body.counted, false);
  assert.equal((await vote('fc:erdos_1', '198.51.100.2')).body.votes, 2);
  await vote('ph:open-density-one');
  assert.deepEqual(await votes(), { 'fc:erdos_1': 2, 'ph:open-density-one': 1 });
  clock.t += 86_400_000;
  assert.equal((await vote('fc:erdos_1')).body.counted, true, 'a new day allows a new vote');
  assert.equal((await votes())['fc:erdos_1'], 3);
});

test('bad ids are refused, and no IP is stored', async () => {
  const { vote, store } = setup();
  for (const id of ['', 'erdos_1', 'fc:<script>', 'xx:abc', 'fc:' + 'a'.repeat(200)]) assert.equal((await vote(id)).status, 400, id);
  await vote('fc:erdos_2', '203.0.113.99');
  assert.ok(!JSON.stringify(await store.list('')).includes('203.0.113.99'));
});

test(`at most ${VOTES_PER_IP_DAY} votes per IP per day`, async () => {
  const { vote, votes } = setup();
  for (let i = 0; i < VOTES_PER_IP_DAY + 5; i++) await vote(`fc:p${i}`);
  assert.equal(Object.keys(await votes()).length, VOTES_PER_IP_DAY);
});

test('library ids with Greek letters and subscripts can be voted on', async () => {
  const { vote } = setup();
  for (const id of ['fc:moment_isEquiv₃', 'fc:reed_conjecture_Δ_6_ω_2', 'fc:HadamardConjecture.variants.«167»', 'fc:OEIS.189409.conjecture_1']) assert.equal((await vote(id)).status, 200, id);
});
