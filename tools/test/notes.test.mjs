import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNote } from "../../checker/notes.mjs";

const note = (login, { date = "2026-11-24", known, extra = "" } = {}) => [
  "# A note", "Record: open-density-one", `Author: @${login}`, `Date: ${date}`, "",
  "## Problem in plain words", "Almost every number reaches 1, in natural density.", "",
  "## Known results", known || "- T. Tao (2022), \"Almost all orbits of the Collatz map attain almost bounded values\", Forum Math Pi. https://arxiv.org/abs/1909.03562", "",
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
