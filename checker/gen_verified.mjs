// The record and proof-file gate. Runs before Lean.
// 1. Every record is well-formed and names a statement that exists in Lemmas.lean.
// 2. Every proof file follows the structure rules (one namespace, safe commands only).
// 3. Writes checker/Verified.lean, tying each verified record to its protected statement.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const fail = (m) => { console.error("REJECTED: " + m); process.exit(1); };
const lemmasSrc = readFileSync("OpenConjecture/Collatz/Lemmas.lean", "utf8");
const statements = new Set([...lemmasSrc.matchAll(/^def ([A-Za-z0-9_]+) : Prop :=/gm)].map((m) => m[1]));

const FORBIDDEN = ["sorry", "admit", "native_decide", "axiom", "unsafe", "macro", "macro_rules", "syntax", "notation",
  "infix", "infixl", "infixr", "prefix", "postfix", "elab", "elab_rules", "declare_syntax_cat", "initialize",
  "builtin_initialize", "run_cmd", "run_elab", "run_meta", "attribute", "instance", "implemented_by", "extern", "csimp",
  "export", "local", "scoped", "private", "opaque", "partial", "deriving", "IO", "unsafeCast", "reduceBool",
  "ofReduceBool", "trustCompiler", "section", "debug", "skipKernelTC"];
const IMPORT_OK = /^import (Mathlib(\.[A-Za-z0-9_.]+)?|OpenConjecture\.Collatz\.(Basic|Lemmas)|OpenConjecture\.Collatz\.Proofs\.[A-Za-z0-9_]+)$/;

function checkProofFile(name) {
  const where = `OpenConjecture/Collatz/Proofs/${name}.lean`;
  if (!statements.has(name)) fail(`${where}: no statement named ${name} in Lemmas.lean`);
  const src = readFileSync(where, "utf8");
  if (/["`]/.test(src)) fail(`${where}: string literals and backticks are not allowed`);
  if (/@\[/.test(src)) fail(`${where}: attributes (@[...]) are not allowed`);
  if (/(^|[^A-Za-z0-9_'.])#[A-Za-z_]/.test(src)) fail(`${where}: # commands are not allowed`);
  for (const w of FORBIDDEN) if (new RegExp(`(^|[^A-Za-z0-9_'.])${w}($|[^A-Za-z0-9_'])`).test(src)) fail(`${where}: forbidden word "${w}"`);
  for (const line of src.split("\n")) {
    if (/\bset_option\b/.test(line) && !/^\s*set_option (maxHeartbeats|maxRecDepth) \d+( in)?\s*$/.test(line))
      fail(`${where}: only "set_option maxHeartbeats N" and "set_option maxRecDepth N" are allowed`);
  }
  const code = src.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "" && !/^\s*--/.test(l));
  let i = 0;
  while (i < code.length && code[i].startsWith("import ")) { if (!IMPORT_OK.test(code[i])) fail(`${where}: import not allowed: ${code[i]}`); i++; }
  const ns = `OpenConjecture.Collatz.Proofs.${name}`;
  if (code[i] !== `namespace ${ns}`) fail(`${where}: the first line after the imports must be "namespace ${ns}"`);
  if (code[code.length - 1] !== `end ${ns}`) fail(`${where}: the last line must be "end ${ns}"`);
  for (let k = i + 1; k < code.length - 1; k++)
    if (/^\s*(namespace|end)\b/.test(code[k]) || /^\s*import\b/.test(code[k])) fail(`${where}: extra namespace/end/import line: ${code[k].trim()}`);
  if (!/^\s*theorem main\b/m.test(src)) fail(`${where}: must define "theorem main"`);
}

for (const f of readdirSync("OpenConjecture/Collatz/Proofs")) {
  if (!/^[A-Za-z0-9_]+\.lean$/.test(f)) fail(`OpenConjecture/Collatz/Proofs/${f}: bad file name`);
  checkProofFile(f.replace(/\.lean$/, ""));
}

const BASE = ["id", "kind", "statement", "difficulty", "title_en", "title_zh", "status"];
const DROP = ["modulus", "residue"];
const DONE = ["proved_by", "model", "verified_at"];
const imports = [], lines = [];
let i = 0;
for (const f of readdirSync("records/collatz").sort()) {
  const where = `records/collatz/${f}`;
  let r;
  try { r = JSON.parse(readFileSync(where, "utf8")); } catch { fail(`${where}: invalid JSON`); }
  if (f !== `${r.id}.json`) fail(`${where}: file name must be <id>.json`);
  if (!statements.has(r.statement)) fail(`${where}: unknown statement ${r.statement}`);
  if (r.status !== "open" && r.status !== "verified") fail(`${where}: status must be open or verified`);
  const allowed = [...BASE, ...(r.kind === "drop" ? DROP : []), ...(r.status === "verified" ? DONE : [])];
  for (const k of Object.keys(r)) if (!allowed.includes(k)) fail(`${where}: unexpected field ${k}`);
  for (const k of allowed) if (r[k] === undefined) fail(`${where}: missing field ${k}`);
  if (r.status !== "verified") continue;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(r.proved_by)) fail(`${where}: proved_by must be a GitHub login`);
  if (!/^[A-Za-z0-9 ._-]{1,40}$/.test(r.model)) fail(`${where}: model may use letters, digits, spaces and ._- (max 40)`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.verified_at)) fail(`${where}: verified_at must be YYYY-MM-DD`);
  if (!existsSync(`OpenConjecture/Collatz/Proofs/${r.statement}.lean`)) fail(`${where}: missing proof file OpenConjecture/Collatz/Proofs/${r.statement}.lean`);
  imports.push(`import OpenConjecture.Collatz.Proofs.${r.statement}`);
  lines.push(`theorem OpenConjectureCheck.c${i} : OpenConjecture.Collatz.${r.statement} := OpenConjecture.Collatz.Proofs.${r.statement}.main`);
  lines.push(`#print axioms OpenConjectureCheck.c${i}`);
  i++;
}
writeFileSync("checker/Verified.lean", imports.join("\n") + "\n\n" + lines.join("\n") + "\n");
console.log(`records ok; ${i} verified result(s) to check`);
