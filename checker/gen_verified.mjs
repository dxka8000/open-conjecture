// The record and file gate. Runs before Lean, on every pull request and on main.
// 1. Split files (outside agents' Proposals/, and any in-house Splits/) and proof files follow the structure rules.
// 2. Every record is well-formed and names a statement that exists.
// 3. Writes checker/Verified.lean, which ties every verified record to its statement
//    and every refuted record to the negation of its statement.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { readNotes } from "./notes.mjs";
import { readProfiles } from "./profiles.mjs";

const fail = (m) => { console.error("REJECTED: " + m); process.exit(1); };
const PROOFS = "OpenConjecture/Collatz/Proofs";
const SPLITS = "OpenConjecture/Collatz/Splits";
const PROPOSALS = "OpenConjecture/Collatz/Proposals";
const listLean = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

const FORBIDDEN = ["sorry", "admit", "native_decide", "axiom", "unsafe", "macro", "macro_rules", "syntax", "notation",
  "infix", "infixl", "infixr", "prefix", "postfix", "elab", "elab_rules", "declare_syntax_cat", "initialize",
  "builtin_initialize", "run_cmd", "run_elab", "run_meta", "attribute", "instance", "implemented_by", "extern", "csimp",
  "export", "local", "scoped", "private", "opaque", "partial", "deriving", "IO", "unsafeCast", "reduceBool",
  "ofReduceBool", "trustCompiler", "section", "debug", "skipKernelTC"];
const IMPORT_OK = /^import (Mathlib(\.[A-Za-z0-9_.]+)?|OpenConjecture\.Collatz\.(Basic|Lemmas)|OpenConjecture\.Collatz\.(Proofs|Splits|Proposals)\.[A-Za-z0-9_]+)$/;

// Fragments banned anywhere, even inside longer names (e.g. _root_.IO, unsafeBaseIO, by_elab,
// run_tac, simproc, eval%): these are the ways Lean code can run programs while it is being
// checked, which could tamper with the judge. Proofs never need them.
const FORBIDDEN_FRAGMENTS = ["IO", "unsafe", "Unsafe", "elab", "Elab", "_tac", "simproc", "eval%", "_root_", "Meta",
  "TacticM", "CoreM", "CommandM", "implemented", "extern", "reduceBool", "include_str", "declare_", "register_",
  "initialize", "System", "Process", "FilePath", "writeModule", "Environment"];

function commonChecks(where, src) {
  if (/["`]/.test(src)) fail(`${where}: string literals and backticks are not allowed`);
  for (const w of FORBIDDEN_FRAGMENTS) if (src.includes(w)) fail(`${where}: forbidden text "${w}" (not allowed anywhere, even inside a longer name or a comment)`);
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

// ---- statements ----
// Fixed statements are in Lemmas.lean (protected). Steps proposed by outside agents are in
// Proposals/Step_<Name>.lean, one definition per file. A split adds 1 to 4 steps under one parent plus
// Proposals/Split_<Parent>.lean, which proves that the steps together imply <Parent>; the gate writes the
// type of that check itself (below), so a split file can't claim anything weaker. Splits/ is the same,
// for in-house splits (none at present).
const norm = (t) => t.replace(/\s+/g, " ").trim();
const bodies = new Map(); // statement name -> normalized body text
for (const m of readFileSync("OpenConjecture/Collatz/Lemmas.lean", "utf8").matchAll(/^def ([A-Za-z0-9_]+) : Prop := (.*)$/gm)) {
  if (bodies.has(m[1])) fail(`Lemmas.lean: ${m[1]} is defined twice`);
  bodies.set(m[1], norm(m[2]));
}
const splitFiles = [];
for (const f of listLean(PROPOSALS)) {
  const where = `${PROPOSALS}/${f}`;
  if (/^Split_[A-Za-z0-9_]+\.lean$/.test(f)) continue; // checked with the splits below
  const m = /^(Step_[A-Za-z0-9_]+)\.lean$/.exec(f);
  if (!m) fail(`${where}: files here are named Step_<Name>.lean or Split_<Parent>.lean`);
  const name = m[1];
  const { code, i } = commonChecks(where, readFileSync(where, "utf8"));
  if (code[i] !== "namespace OpenConjecture.Collatz") fail(`${where}: the first line after the imports must be "namespace OpenConjecture.Collatz"`);
  if (code[code.length - 1] !== "end OpenConjecture.Collatz") fail(`${where}: the last line must be "end OpenConjecture.Collatz"`);
  if (!code[i + 1] || !code[i + 1].startsWith(`def ${name} : Prop :=`)) fail(`${where}: it must contain exactly "def ${name} : Prop := ..."`);
  for (let k = i + 2; k < code.length - 1; k++)
    if (!/^\s+\S/.test(code[k])) fail(`${where}: only the one definition is allowed (continuation lines must be indented)`);
  if (bodies.has(name)) fail(`${where}: ${name} already exists`);
  bodies.set(name, norm([code[i + 1].slice(`def ${name} : Prop :=`.length), ...code.slice(i + 2, code.length - 1)].join(" ")));
}
const statements = new Set(bodies.keys());
// No statement may restate another, word for word or by name.
for (const [name, body] of bodies) {
  if (body === "") fail(`${name} is empty`);
  if (statements.has(body)) fail(`${name} is just the statement ${body}`);
  for (const [other, b] of bodies) if (other !== name && b === body) fail(`${name} is the same text as ${other}`);
}
for (const [dir, nsBase] of [[SPLITS, "OpenConjecture.Collatz.Splits"], [PROPOSALS, "OpenConjecture.Collatz.Proposals"]]) {
  for (const f of listLean(dir)) {
    const where = `${dir}/${f}`;
    const sp = /^(Split_([A-Za-z0-9_]+))\.lean$/.exec(f);
    if (!sp) { if (dir === SPLITS) fail(`${where}: split files are named Split_<Parent>.lean`); continue; }
    const s = { name: sp[1], parent: sp[2], where, ns: `${nsBase}.${sp[1]}` };
    if (splitFiles.some((x) => x.name === s.name)) fail(`${where}: ${s.parent} is already split`);
    const src = readFileSync(where, "utf8");
    const { code, i } = commonChecks(where, src);
    if (code[i] !== `namespace ${s.ns}`) fail(`${where}: the first line after the imports must be "namespace ${s.ns}"`);
    if (code[code.length - 1] !== `end ${s.ns}`) fail(`${where}: the last line must be "end ${s.ns}"`);
    for (let k = i + 1; k < code.length - 1; k++)
      if (/^\s*(namespace|end|import)\b/.test(code[k])) fail(`${where}: extra namespace/end/import line: ${code[k].trim()}`);
    if (!/^\s*theorem main\b/m.test(src)) fail(`${where}: must define "theorem main"`);
    if (!statements.has(s.parent)) fail(`${where}: no statement named ${s.parent}`);
    splitFiles.push(s);
  }
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
const EXTRA = { drop: ["modulus", "residue"], step: ["parent", "split", "sketch", "proposed_by", "proposed_at"], milestone: ["parent"], summit: [],
  program: ["parent", "about_en", "about_zh"] };
const DONE = ["proved_by", "model", "verified_at"];
// Optional: the agent tool used (Claude Code, Codex CLI, ...); steps may also say which model and tool split them
// (proposed_model, proposed_tool), kept apart from the prover's model and tool.
const OPTIONAL = { done: ["tool"], step: ["proposed_model", "proposed_tool"] };
const TAG_RE = /^[A-Za-z0-9 ._+-]{1,40}$/;
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
  const required = [...BASE, ...EXTRA[r.kind], ...(r.status === "open" ? [] : DONE)];
  const allowed = [...required, ...(r.kind === "step" ? OPTIONAL.step : []), ...(r.status === "open" ? [] : OPTIONAL.done)];
  for (const k of Object.keys(r)) if (!allowed.includes(k)) fail(`${where}: unexpected field ${k}`);
  for (const k of required) if (r[k] === undefined) fail(`${where}: missing field ${k}`);
  for (const k of ["model", "tool", "proposed_model", "proposed_tool"]) if (r[k] !== undefined && !TAG_RE.test(r[k])) fail(`${where}: ${k} may use letters, digits, spaces and ._+- (max 40)`);
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.proposed_at)) fail(`${where}: proposed_at must be YYYY-MM-DD`);
    const sp = splitFiles.find((s) => s.name === r.split);
    if (!sp) fail(`${where}: split ${r.split} is not a file ${PROPOSALS}/Split_<Parent>.lean`);
    if (sp.parent !== byId.get(r.parent).statement) fail(`${where}: split ${r.split} proves ${sp.parent}, but this step's parent ${r.parent} has statement ${byId.get(r.parent).statement}`);
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
// Research notes: format, sections, links, and a record that exists.
let notes = [];
try { notes = readNotes("."); } catch (e) { fail(e.message); }
for (const nt of notes) if (!ids.has(nt.record)) fail(`${nt.path}: no record ${nt.record}`);
// Contributor profiles: format and links.
let profiles = new Map();
try { profiles = readProfiles("."); } catch (e) { fail(e.message); }
// Every split: its steps together must imply its parent. The type is written here, never taken from the file.
let m = 0;
for (const s of splitFiles) {
  const steps = records.map(({ r }) => r).filter((r) => r.kind === "step" && r.split === s.name).map((r) => r.statement).sort();
  if (steps.length < 1 || steps.length > 4) fail(`${s.where}: a split has 1 to 4 steps (step records with "split": "${s.name}"), it has ${steps.length}`);
  const hyp = steps.map((x) => `OpenConjecture.Collatz.${x}`).join(" ∧ ");
  imports.push(`import ${s.ns}`);
  lines.push(`theorem OpenConjectureCheck.s${m} : (${hyp}) → OpenConjecture.Collatz.${s.parent} := ${s.ns}.main`);
  lines.push(`#print axioms OpenConjectureCheck.s${m}`);
  m++;
}
writeFileSync("checker/Verified.lean", imports.join("\n") + "\n\n" + lines.join("\n") + "\n");
console.log(`records ok; ${n} settled result(s), ${m} split(s) to check, ${notes.length} research note(s), ${profiles.size} profile(s)`);
