// Validates records/ and generates checker/Verified.lean.
// Two rules: strict record schema, and the ladder rule: a rung may be verified
// only when every lower rung of the same problem is already verified.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const fail = (m) => { console.error("REJECTED: " + m); process.exit(1); };
const problems = {};
for (const f of readdirSync("problems")) {
  const p = JSON.parse(readFileSync(join("problems", f), "utf8"));
  problems[p.slug] = p;
}
const OPEN_KEYS = ["id", "problem", "bound", "status"];
const DONE_KEYS = [...OPEN_KEYS, "lean_name", "file", "proved_by", "model", "verified_at"];

const all = [];
for (const slug of readdirSync("records")) {
  if (!problems[slug]) fail(`records/${slug}: unknown problem`);
  for (const f of readdirSync(join("records", slug))) {
    const where = `records/${slug}/${f}`;
    let r;
    try { r = JSON.parse(readFileSync(join("records", slug, f), "utf8")); } catch { fail(`${where}: invalid JSON`); }
    if (!Number.isSafeInteger(r.bound) || r.bound <= 0) fail(`${where}: bad bound`);
    if (r.problem !== slug || r.id !== `${slug}/${r.bound}` || f !== `${r.bound}.json`) fail(`${where}: id/problem/file name mismatch`);
    if (r.status !== "open" && r.status !== "verified") fail(`${where}: bad status`);
    const allowed = r.status === "open" ? OPEN_KEYS : DONE_KEYS;
    for (const k of Object.keys(r)) if (!allowed.includes(k)) fail(`${where}: unexpected field ${k}`);
    all.push({ where, slug, r });
  }
}

const lines = [], imports = new Set();
let i = 0;
for (const { where, slug, r } of all.sort((a, b) => a.r.bound - b.r.bound)) {
  if (r.status !== "verified") continue;
  const lower = all.find((x) => x.slug === slug && x.r.bound < r.bound && x.r.status !== "verified");
  if (lower) fail(`${where}: rung ${r.bound} is locked; verify rung ${lower.r.bound} first`);
  for (const k of DONE_KEYS) if (r[k] === undefined) fail(`${where}: missing field ${k}`);
  const ns = problems[slug].lean_namespace;
  if (!new RegExp(`^OpenConjecture/${ns}/Proofs/[A-Za-z0-9_]+(/[A-Za-z0-9_]+)*\\.lean$`).test(r.file)) fail(`${where}: file must be under OpenConjecture/${ns}/Proofs/`);
  if (!new RegExp(`^OpenConjecture\\.${ns}\\.[A-Za-z_][A-Za-z0-9_]*$`).test(r.lean_name)) fail(`${where}: bad lean_name`);
  if (!/^[A-Za-z0-9-]{1,39}$/.test(r.proved_by)) fail(`${where}: proved_by must be a GitHub login`);
  if (!/^[A-Za-z0-9 ._-]{1,40}$/.test(r.model)) fail(`${where}: bad model string`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.verified_at)) fail(`${where}: bad verified_at`);
  imports.add("import " + r.file.replace(/\.lean$/, "").replaceAll("/", "."));
  lines.push(`theorem OpenConjectureCheck.c${i} : OpenConjecture.${ns}.Target ${r.bound} := ${r.lean_name}`);
  lines.push(`#print axioms OpenConjectureCheck.c${i}`);
  i++;
}
writeFileSync("checker/Verified.lean", [...imports].sort().join("\n") + "\n\n" + lines.join("\n") + "\n");
console.log(`records ok; ${i} verified result(s) to check`);
