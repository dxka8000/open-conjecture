import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNote } from "../../checker/notes.mjs";

const note = (login, { date = "2026-11-24", known, extra = "" } = {}) => [
  "# A note", "Record: open-density-one", `Author: @${login}`, `Date: ${date}`, "",
  "## Problem in plain words", "Almost every number reaches 1, in natural density.", "",
  "## Known results", known || "- T. Tao (2022), \"Almost all orbits of the Collatz map attain almost bounded values\", Forum Math Pi. https://arxiv.org/abs/1909.03562\n  Claim: for any f tending to infinity, min of the orbit of N is below f(N) for almost all N in logarithmic density.", "",
  "## Attack routes", "- Syracuse random variables and 3-adic equidistribution.", "",
  "## Where each route is stuck", "- Logarithmic density only; natural density needs more.", "",
  "## Candidate splits", "- A natural-density version for a fixed slowly growing f.", "",
  "## Open questions", "- Does x < n hold for the relevant counting function? " + extra, ""].join("\n");
const check = (file, text) => checkNote("open-density-one", file, text, Buffer.byteLength(text));

test("slugs with hyphens and logins with hyphens are both accepted", () => {
  assert.equal(check("alice-cycle-bound-survey.md", note("alice")).ok, true);
  assert.equal(check("bob-smith-tao-density-notes.md", note("bob-smith")).ok, true);
  assert.equal(check("Bob-Smith-x.md", note("bob-smith")).ok, true); // logins are case-insensitive
  const r = check("bob-smith-tao.md", note("bob-smith"));
  assert.equal(r.note.who, "bob-smith");
});

test("a file name that does not start with the Author login gets the file-name rule", () => {
  const r = check("bob-tao-survey.md", note("bob-smith"));
  assert.equal(r.ok, false);
  assert.match(r.why, /file name must be <your GitHub login>-<slug>\.md.*expected "bob-smith-<slug>\.md"/);
  assert.match(check("alice.md", note("alice")).why, /file name must be/);
  assert.match(check("alice-Upper.md", note("alice")).why, /file name must be/);
});

test("any https link is allowed; http and banned schemes are not", () => {
  assert.equal(check("alice-a.md", note("alice", { extra: "See https://www.math.ucla.edu/~tao/ for more." })).ok, true);
  assert.match(check("alice-a.md", note("alice", { extra: "http://example.com" })).why, /must be https/);
  assert.match(check("alice-a.md", note("alice", { extra: "[x](javascript:alert(1))" })).why, /may not appear/);
  assert.match(check("alice-a.md", note("alice", { known: "- A survey with no link at all, long enough to pass." })).why, /arXiv or DOI link/);
});

test("HTML is rejected with a rule that explains what to write instead", () => {
  assert.match(check("alice-a.md", note("alice", { extra: "x <n" })).why, /write "x < n" with spaces/);
  assert.equal(check("alice-a.md", note("alice", { extra: "x < n and 3 <= 4" })).ok, true);
});

test("optional Model and Tool lines are read and checked", () => {
  const withTags = note("alice").replace("Date: 2026-11-24", "Date: 2026-11-24\nModel: Claude Opus 5.5\nTool: Claude Code");
  const r = check("alice-a.md", withTags);
  assert.equal(r.ok, true, r.why);
  assert.equal(r.note.model, "Claude Opus 5.5");
  assert.equal(r.note.tool, "Claude Code");
  assert.match(check("alice-a.md", note("alice").replace("Date: 2026-11-24", "Date: 2026-11-24\nModel: x;rm -rf")).why, /Model/);
});

test("every citation needs a Claim line stating what the source proves; Where is optional", () => {
  const noClaim = note("alice", { known: "- T. Tao (2022), \"Almost all orbits\", Forum Math Pi. https://arxiv.org/abs/1909.03562 Strong result." });
  assert.match(check("alice-x.md", noClaim).why, /needs a "Claim:" line under it/);
  const ok = note("alice", { known: "- T. Tao (2022), \"Almost all orbits\". https://arxiv.org/abs/1909.03562\n  Claim: almost all orbits attain almost bounded values, in logarithmic density.\n  Where: Theorem 1.3.\n- J. Lagarias (2003), bibliography. https://arxiv.org/abs/math/0309224\n  - Claim: an annotated bibliography of the 3x+1 problem up to 1999." });
  assert.equal(check("alice-x.md", ok).ok, true, check("alice-x.md", ok).why);
  const oneMissing = note("alice", { known: "- T. Tao (2022). https://arxiv.org/abs/1909.03562\n  Claim: logarithmic density version of almost bounded orbits.\n- Lagarias (2003). https://arxiv.org/abs/math/0309224" });
  assert.match(check("alice-x.md", oneMissing).why, /missing for "Lagarias \(2003\)/);
  assert.match(check("alice-x.md", note("alice", { known: "- Tao (2019). https://arxiv.org/abs/1909.03562\n  Claim: yes" })).why, /at least 10 characters/);
});

test("planted errors on well-known results are rejected: wrong exponent, wrong density, wrong year", () => {
  const kl = (exp) => note("alice", { known: `- I. Krasikov, J. C. Lagarias (2003), "Bounds for the 3x+1 problem using difference inequalities", Acta Arith. 109. https://arxiv.org/abs/math/0205002\n  Claim: #{n <= x : n reaches 1} >= x^${exp} for all large x.` });
  assert.equal(check("alice-x.md", kl("0.84")).ok, true);
  assert.equal(check("alice-x.md", kl("{0.84}")).ok, true);
  assert.match(check("alice-x.md", kl("0.9")).why, /does not match the source: they prove at least x\^0\.84 .*not x\^0\.9/);
  const tao = (d) => note("alice", { known: `- T. Tao (2019), "Almost all orbits of the Collatz map attain almost bounded values". https://arxiv.org/abs/1909.03562\n  Claim: almost all orbits attain almost bounded values, in ${d} density.` });
  assert.equal(check("alice-x.md", tao("logarithmic")).ok, true);
  assert.match(check("alice-x.md", tao("natural")).why, /logarithmic density, not natural density/);
  const terras = (y) => note("alice", { known: `- R. Terras (${y}), "A stopping time problem on the positive integers", Acta Arith. 30. https://doi.org/10.4064/aa-30-3-241-252\n  Claim: finite stopping time holds on a set of natural density one.` });
  assert.equal(check("alice-x.md", terras(1976)).ok, true);
  assert.match(check("alice-x.md", terras(1978)).why, /gives the year 1978; the source is from 1976/);
});

test("the note merged before the Claim rule is grandfathered; the rule applies to new notes", async () => {
  const { readFileSync } = await import("node:fs");
  const f = "notes/open-coefficient-stopping/dxka8000-coefficientstopping.md";
  const text = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  assert.equal(checkNote("open-coefficient-stopping", "dxka8000-coefficientstopping.md", text, Buffer.byteLength(text)).ok, true);
  assert.match(checkNote("open-coefficient-stopping", "dxka8000-copy.md", text, Buffer.byteLength(text)).why, /needs a "Claim:" line/);
});
