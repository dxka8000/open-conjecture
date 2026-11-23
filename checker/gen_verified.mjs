// Validates records/ and generates checker/Verified.lean, which ties every
// "verified" record to the protected Target statement of its problem.
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
const lines = [], imports = new Set();
let i = 0;
for (const slug of readdirSync("records")) {
  const p = problems[slug] || fail(`records/${slug}: unknown problem`);
  const ns = p.lean_namespace;
  for (const f of readdirSync(join("records", slug))) {
    const where = `records/${slug}/${f}`;
    let r;
    try { r = JSON.parse(readFileSync(join("records", slug, f), "utf8")); } catch { fail(`${where}: invalid JSON`); }
    if (!Number.isSafeInteger(r.bound) || r.bound <= 0) fail(`${where}: bad bound`);
    if (r.problem !== slug || r.id !== `${slug}/${r.bound}` || f !== `${r.bound}.json`) fail(`${where}: id/problem/file name mismatch`);
    if (r.status !== "open" && r.status !== "verified") fail(`${where}: bad status`);
    const allowed = r.status === "open" ? OPEN_KEYS : DONE_KEYS;
    for (const k of Object.keys(r)) if (!allowed.includes(k)) fail(`${where}: unexpected field ${k}`);
    if (r.status === "open") continue;
    for (const k of DONE_KEYS) if (r[k] === undefined) fail(`${where}: missing field ${k}`);
    if (!new RegExp(`^OpenConjecture/${ns}/Proofs/[A-Za-z0-9_]+(/[A-Za-z0-9_]+)*\.lean$`).test(r.file)) fail(`${where}: file must be under OpenConjecture/${ns}/Proofs/`);
    if (!new RegExp(`^OpenConjecture\.${ns}\.[A-Za-z_][A-Za-z0-9_]*$`).test(r.lean_name)) fail(`${where}: bad lean_name`);
    if (!/^[A-Za-z0-9-]{1,39}$/.test(r.proved_by)) fail(`${where}: proved_by must be a GitHub login`);
    if (!/^[A-Za-z0-9 ._-]{1,40}$/.test(r.model)) fail(`${where}: bad model string`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.verified_at)) fail(`${where}: bad verified_at`);
    imports.add("import " + r.file.replace(/\.lean$/, "").replaceAll("/", "."));
    lines.push(`theorem OpenConjectureCheck.c${i} : OpenConjecture.${ns}.Target ${r.bound} := ${r.lean_name}`);
    lines.push(`#print axioms OpenConjectureCheck.c${i}`);
    i++;
  }
}
writeFileSync("checker/Verified.lean", [...imports].sort().join("\n") + "\n\n" + lines.join("\n") + "\n");
console.log(`records ok; ${i} verified result(s) to check`);
