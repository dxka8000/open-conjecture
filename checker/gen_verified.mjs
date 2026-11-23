// The record and file gate. Runs before Lean, on every pull request and on main.
// 1. Proposal files (new statements) and proof files follow the structure rules.
// 2. Every record is well-formed and names a statement that exists.
// 3. Writes checker/Verified.lean, which ties every verified record to its statement
//    and every refuted record to the negation of its statement.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const fail = (m) => { console.error("REJECTED: " + m); process.exit(1); };
const PROOFS = "OpenConjecture/Collatz/Proofs";
const PROPOSALS = "OpenConjecture/Collatz/Proposals";
const listLean = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

const FORBIDDEN = ["sorry", "admit", "native_decide", "axiom", "unsafe", "macro", "macro_rules", "syntax", "notation",
  "infix", "infixl", "infixr", "prefix", "postfix", "elab", "elab_rules", "declare_syntax_cat", "initialize",
  "builtin_initialize", "run_cmd", "run_elab", "run_meta", "attribute", "instance", "implemented_by", "extern", "csimp",
  "export", "local", "scoped", "private", "opaque", "partial", "deriving", "IO", "unsafeCast", "reduceBool",
  "ofReduceBool", "trustCompiler", "section", "debug", "skipKernelTC"];
const IMPORT_OK = /^import (Mathlib(\.[A-Za-z0-9_.]+)?|OpenConjecture\.Collatz\.(Basic|Lemmas)|OpenConjecture\.Collatz\.(Proofs|Proposals)\.[A-Za-z0-9_]+)$/;

function commonChecks(where, src) {
  if (/["`]/.test(src)) fail(`${where}: string literals and backticks are not allowed`);
  if (/@\[/.test(src)) fail(`${where}: attributes (@[...]) are not allowed`);
  if (/(^|[^A-Za-z0-9_'.])#[A-Za-z_]/.test(src)) fail(`${where}: # commands are not allowed`);
  for (const w of FORBIDDEN) if (new RegExp(`(^|[^A-Za-z0-9_'.])${w}($|[^A-Za-z0-9_'])`).test(src)) fail(`${where}: forbidden word "${w}"`);
  for (const line of src.split("\n"))
    if (/\bset_option\b/.test(line) && !/^\s*set_option (maxHeartbeats|maxRecDepth) \d+( in)?\s*$/.test(line))
      fail(`${where}: only "set_option maxHeartbeats N" and "set_option maxRecDepth N" are allowed`);
  const code = src.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "" && !/^\s*--/.test(l));
  let i = 0;
  while (i < code.length && code[i].startsWith("import ")) { if (!IMPORT_OK.test(code[i])) fail(`${where}: import not allowed: ${code[i]}`); i++; }
  return { code, i };
}

// ---- statements: generated ones in Lemmas.lean, proposed ones in Proposals/ ----
const statements = new Set([...readFileSync("OpenConjecture/Collatz/Lemmas.lean", "utf8").matchAll(/^def ([A-Za-z0-9_]+) : Prop :=/gm)].map((m) => m[1]));
for (const f of listLean(PROPOSALS)) {
  const where = `${PROPOSALS}/${f}`;
  const m = /^(Step_[A-Za-z0-9_]+)\.lean$/.exec(f);
  if (!m) fail(`${where}: proposal files are named Step_<Name>.lean`);
  const name = m[1];
  const { code, i } = commonChecks(where, readFileSync(where, "utf8"));
  if (code[i] !== "namespace OpenConjecture.Collatz") fail(`${where}: the first line after the imports must be "namespace OpenConjecture.Collatz"`);
  if (code[code.length - 1] !== "end OpenConjecture.Collatz") fail(`${where}: the last line must be "end OpenConjecture.Collatz"`);
  if (!code[i + 1] || !code[i + 1].startsWith(`def ${name} : Prop :=`)) fail(`${where}: it must contain exactly "def ${name} : Prop := ..."`);
  for (let k = i + 2; k < code.length - 1; k++)
    if (!/^\s+\S/.test(code[k])) fail(`${where}: only the one definition is allowed (continuation lines must be indented)`);
  if (statements.has(name)) fail(`${where}: ${name} already exists`);
  statements.add(name);
}

// ---- proof files: Proofs/<Statement>.lean proves it, Proofs/Refute_<Statement>.lean refutes it ----
for (const f of listLean(PROOFS)) {
  const where = `${PROOFS}/${f}`;
  const m = /^([A-Za-z0-9_]+)\.lean$/.exec(f);
  if (!m) fail(`${where}: bad file name`);
  const name = m[1];
  const target = name.startsWith("Refute_") ? name.slice("Refute_".length) : name;
  if (!statements.has(target)) fail(`${where}: no statement named ${target}`);
  const src = readFileSync(where, "utf8");
  const { code, i } = commonChecks(where, src);
  const ns = `OpenConjecture.Collatz.Proofs.${name}`;
  if (code[i] !== `namespace ${ns}`) fail(`${where}: the first line after the imports must be "namespace ${ns}"`);
  if (code[code.length - 1] !== `end ${ns}`) fail(`${where}: the last line must be "end ${ns}"`);
  for (let k = i + 1; k < code.length - 1; k++)
    if (/^\s*(namespace|end|import)\b/.test(code[k])) fail(`${where}: extra namespace/end/import line: ${code[k].trim()}`);
  if (!/^\s*theorem main\b/m.test(src)) fail(`${where}: must define "theorem main"`);
}

// ---- records ----
const KINDS = ["drop", "milestone", "summit", "program", "step"];
const BASE = ["id", "kind", "statement", "difficulty", "title_en", "title_zh", "status"];
const EXTRA = { drop: ["modulus", "residue"], step: ["parent", "sketch", "proposed_by"], milestone: ["parent"], summit: [],
  program: ["parent", "about_en", "about_zh"] };
const DONE = ["proved_by", "model", "verified_at"];
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const records = readdirSync("records/collatz").sort().map((f) => {
  const where = `records/collatz/${f}`;
  try { return { f, where, r: JSON.parse(readFileSync(where, "utf8")) }; } catch { fail(`${where}: invalid JSON`); }
});
const ids = new Set(records.map(({ r }) => r.id));
const byId = new Map(records.map(({ r }) => [r.id, r]));
// Parent links must end at a summit, with no loops.
for (const { where, r } of records) {
  let cur = r, hops = 0;
  while (cur && cur.parent !== undefined) {
    if (++hops > 50) fail(`${where}: parent links loop or are too deep`);
    cur = byId.get(cur.parent);
  }
}
const usedStatements = new Set();
const imports = [], lines = [];
let n = 0;
for (const { f, where, r } of records) {
  if (!/^[a-z0-9-]{1,60}$/.test(String(r.id)) || f !== `${r.id}.json`) fail(`${where}: id must be lowercase letters, digits and hyphens, and the file must be <id>.json`);
  if (!KINDS.includes(r.kind)) fail(`${where}: kind must be one of ${KINDS.join(", ")}`);
  if (!statements.has(r.statement)) fail(`${where}: unknown statement ${r.statement}`);
  if (usedStatements.has(r.statement)) fail(`${where}: statement ${r.statement} already has a record`);
  usedStatements.add(r.statement);
  if (r.kind === "step" !== String(r.statement).startsWith("Step_")) fail(`${where}: step records (and only they) use Step_ statements`);
  if (!["open", "verified", "refuted"].includes(r.status)) fail(`${where}: status must be open, verified or refuted`);
  const allowed = [...BASE, ...EXTRA[r.kind], ...(r.status === "open" ? [] : DONE)];
  for (const k of Object.keys(r)) if (!allowed.includes(k)) fail(`${where}: unexpected field ${k}`);
  for (const k of allowed) if (r[k] === undefined) fail(`${where}: missing field ${k}`);
  if (!Number.isInteger(r.difficulty) || r.difficulty < 1 || r.difficulty > 1000) fail(`${where}: difficulty must be an integer from 1 to 1000`);
  for (const k of ["title_en", "title_zh"]) if (typeof r[k] !== "string" || r[k].length < 1 || r[k].length > 200) fail(`${where}: ${k} must be 1-200 characters`);
  if (r.kind === "program") {
    if (byId.get(r.parent)?.kind !== "summit") fail(`${where}: a program's parent must be a summit`);
    for (const k of ["about_en", "about_zh"]) if (typeof r[k] !== "string" || r[k].length < 1 || r[k].length > 2000) fail(`${where}: ${k} must be 1-2000 characters`);
  }
  if (r.kind === "milestone" && !["summit", "program"].includes(byId.get(r.parent)?.kind)) fail(`${where}: a milestone's parent must be a summit or a program`);
  if (r.kind === "step") {
    if (!ids.has(r.parent)) fail(`${where}: parent ${r.parent} is not an existing record id`);
    if (["drop", "summit"].includes(byId.get(r.parent)?.kind)) fail(`${where}: a step's parent must be a program, a milestone or another step`);
    if (typeof r.sketch !== "string" || r.sketch.length > 2000) fail(`${where}: sketch must be text of at most 2000 characters`);
    if (!LOGIN.test(r.proposed_by)) fail(`${where}: proposed_by must be a GitHub login`);
  }
  if (r.status === "open") continue;
  if (!LOGIN.test(r.proved_by)) fail(`${where}: proved_by must be a GitHub login`);
  if (!/^[A-Za-z0-9 ._-]{1,40}$/.test(r.model)) fail(`${where}: model may use letters, digits, spaces and ._- (max 40)`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.verified_at)) fail(`${where}: verified_at must be YYYY-MM-DD`);
  const refute = r.status === "refuted";
  const file = refute ? `Refute_${r.statement}` : r.statement;
  if (!existsSync(`${PROOFS}/${file}.lean`)) fail(`${where}: missing ${PROOFS}/${file}.lean`);
  imports.push(`import OpenConjecture.Collatz.Proofs.${file}`);
  lines.push(`theorem OpenConjectureCheck.c${n} : ${refute ? "¬ " : ""}OpenConjecture.Collatz.${r.statement} := OpenConjecture.Collatz.Proofs.${file}.main`);
  lines.push(`#print axioms OpenConjectureCheck.c${n}`);
  n++;
}
writeFileSync("checker/Verified.lean", imports.join("\n") + "\n\n" + lines.join("\n") + "\n");
console.log(`records ok; ${n} settled result(s) to check`);
