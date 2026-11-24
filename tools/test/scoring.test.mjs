import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCORING as S, scoreEvents, leaderboardRows, weightOf, scoringConfig } from "../scoring.mjs";

const rec = (id, kind, extra = {}) => ({ id, kind, statement: id, status: "open", ...extra });
const board = () => [
  rec("summit", "summit"),
  rec("p", "program", { parent: "summit" }),
  rec("s1", "step", { parent: "p", split: "Split_p", proposed_by: "alice", proposed_at: "2026-11-20" }),
  rec("s2", "step", { parent: "p", split: "Split_p", proposed_by: "alice", proposed_at: "2026-11-20" }),
  rec("t1", "step", { parent: "s1", split: "Split_s1", proposed_by: "carol", proposed_at: "2026-11-23" }),
  rec("t2", "step", { parent: "s1", split: "Split_s1", proposed_by: "carol", proposed_at: "2026-11-23" }),
  rec("t3", "step", { parent: "s1", split: "Split_s1", proposed_by: "carol", proposed_at: "2026-11-23" }),
];
const pts = (rows, who) => rows.find((r) => r.who === who)?.points ?? 0;

test("weights: open problems 1, each split level times 0.6, never below 0.1", () => {
  const b = board();
  const byId = new Map(b.map((r) => [r.id, r]));
  assert.equal(weightOf(byId.get("p"), byId, S), 1);
  assert.equal(weightOf(byId.get("s1"), byId, S), 0.6);
  assert.ok(Math.abs(weightOf(byId.get("t1"), byId, S) - 0.36) < 1e-9);
  const deep = [rec("q", "program")];
  for (let i = 1; i <= 8; i++) deep.push(rec(`d${i}`, "step", { parent: i === 1 ? "q" : `d${i - 1}` }));
  const m = new Map(deep.map((r) => [r.id, r]));
  assert.equal(weightOf(m.get("d8"), m, S), 0.1);
});

test("splits score more than step proofs; bonus when a step of your split is proven", () => {
  const b = board();
  let rows = leaderboardRows(scoreEvents(b, S));
  assert.equal(pts(rows, "alice"), 50); // (30 + 10 * 2) * 1
  assert.equal(pts(rows, "carol"), 36); // (30 + 10 * 3) * 0.6
  Object.assign(b[2], { status: "verified", proved_by: "bob", verified_at: "2026-11-24" }); // s1, weight 0.6
  Object.assign(b[4], { status: "verified", proved_by: "bob", verified_at: "2026-11-24" }); // t1, weight 0.36
  rows = leaderboardRows(scoreEvents(b, S));
  assert.equal(pts(rows, "bob"), 19.2); // 20 * 0.6 + 20 * 0.36
  assert.equal(pts(rows, "alice"), 55); // + 5 bonus for s1
  assert.equal(pts(rows, "carol"), 41); // + 5 bonus for t1
  const bob = rows.find((r) => r.who === "bob");
  assert.deepEqual([bob.proofs, bob.splits, bob.refutations], [2, 0, 0]);
});

test("open problems: proof or refutation 1000; refuting a step scores like proving it, with no bonus", () => {
  const b = board();
  Object.assign(b[1], { status: "verified", proved_by: "dave", verified_at: "2026-11-24" });
  Object.assign(b[3], { status: "refuted", proved_by: "erin", verified_at: "2026-11-24" }); // s2, weight 0.6
  const rows = leaderboardRows(scoreEvents(b, S));
  assert.equal(pts(rows, "dave"), 1000);
  assert.equal(pts(rows, "erin"), 12);
  assert.equal(rows.find((r) => r.who === "erin").refutations, 1);
  assert.equal(pts(rows, "alice"), 50); // no bonus for a refuted step
  assert.equal(rows[0].who, "dave");
});

test("this week counts only events on or after the start date", () => {
  const rows = leaderboardRows(scoreEvents(board(), S), "2026-11-21");
  assert.equal(pts(rows, "alice"), 0);
  assert.equal(pts(rows, "carol"), 36);
});

test("config overrides are read from site/config.json, invalid values ignored", () => {
  const c = scoringConfig({ scoring: { split_base: 40, step_proof: -1, min_weight: "x" } });
  assert.equal(c.split_base, 40);
  assert.equal(c.step_proof, 20);
  assert.equal(c.min_weight, 0.1);
});
