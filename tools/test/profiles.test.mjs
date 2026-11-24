import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProfile } from "../../checker/profiles.mjs";

const ok = (obj, file = "alice-b.json") => checkProfile(file, JSON.stringify(obj));

test("a full profile is accepted and normalised", () => {
  const r = ok({ display_name: "  Alice  B ", affiliation: "Uni", bio: "Hi", country: "NZ", interests: ["Collatz", " dynamics "],
    links: { x: "https://x.com/a", linkedin: "https://www.linkedin.com/in/a", github: "https://github.com/a", orcid: "https://orcid.org/0000-0002-1825-0097",
      scholar: "https://scholar.google.com/citations?user=x", homepage: "https://example.org/" } });
  assert.equal(r.ok, true, r.why);
  assert.equal(r.profile.display_name, "Alice B");
  assert.deepEqual(r.profile.interests, ["Collatz", "dynamics"]);
  assert.equal(r.profile.login, "alice-b");
});

test("links must be https and go to the right site for each field", () => {
  assert.match(ok({ links: { x: "http://x.com/a" } }).why, /must be https/);
  assert.match(ok({ links: { x: "https://evil.com/a" } }).why, /must go to x\.com or twitter\.com/);
  assert.match(ok({ links: { orcid: "https://orcid.org.evil.com/x" } }).why, /must go to orcid\.org/);
  assert.match(ok({ links: { homepage: "javascript:alert(1)" } }).why, /must be https/);
  assert.match(ok({ links: { facebook: "https://facebook.com/a" } }).why, /unknown link/);
  assert.equal(ok({ links: { homepage: "https://anything.example/~me" } }).ok, true);
});

test("fields are capped and must be plain text; unknown fields and bad names are rejected", () => {
  assert.match(ok({ bio: "x".repeat(401) }).why, /bio is at most 400/);
  assert.match(ok({ display_name: 5 }).why, /plain text/);
  assert.match(ok({ display_name: "a‮b" }).why, /plain text/);
  assert.match(ok({ interests: Array(9).fill("x") }).why, /at most 8/);
  assert.match(ok({ email: "a@b.c" }).why, /unknown field/);
  assert.match(ok({}, "../evil.json").why, /must be named/);
  assert.match(checkProfile("a.json", "[1]").why, /JSON object/);
  assert.match(checkProfile("a.json", "{nope").why, /not valid JSON/);
});
