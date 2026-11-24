// Anti-gaming check for our own splits (heuristic). Runs in CI after Lean has built the library.
// 1. Triviality: a step is REJECTED if `decide`, `simp`, `norm_num` or `omega` proves it.
// 2. Filler: for a split with steps S1..Sk of parent P, it is REJECTED if cheap tactics prove P from one
//    step alone, or from all steps but one (that step would be filler).
// Every attempt runs under a small heartbeat limit, and each file under a wall-clock cap. A timeout
// counts as "not proven", which is the passing direction. Control statements check the mechanism.
// These checks block obvious filler and restatements, not every disguised one.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TRIVIAL = ["decide", "simp", "norm_num", "omega"];
const FILLER = ["exact h", "simpa using h", "tauto", "simp_all", "omega", "aesop"];
const HEARTBEATS = 20000; // a tenth of Lean's default
const FILE_CAP_MS = 300e3;

const recs = readdirSync("records/collatz").map((f) => JSON.parse(readFileSync(`records/collatz/${f}`, "utf8")));
const byId = new Map(recs.map((r) => [r.id, r]));
const steps = recs.filter((r) => r.kind === "step" && r.status === "open").map((r) => r.statement).sort();
const splits = new Map();
for (const r of recs.filter((r) => r.kind === "step")) {
  const s = splits.get(r.split) || { parent: byId.get(r.parent).statement, steps: [] };
  s.steps.push(r.statement);
  splits.set(r.split, s);
}
const NAME = /^[A-Za-z0-9_]+$/;
for (const n of [...steps, ...[...splits.values()].flatMap((s) => [s.parent, ...s.steps])]) if (!NAME.test(n)) throw new Error("bad name " + n);

mkdirSync("checker/anti_gaming", { recursive: true });
const PROP = "OpenConjecture/Collatz/Proposals";
const stepImports = (existsSync(PROP) ? readdirSync(PROP) : []).map((f) => /^(Step_[A-Za-z0-9_]+)\.lean$/.exec(f)).filter(Boolean)
  .map((m) => `import OpenConjecture.Collatz.Proposals.${m[1]}`);
// One attempt per line: Lean reports errors as <file>:<line>:<col>: error, so the line says which failed.
function run(name, defs, tests) {
  const head = ["import OpenConjecture.Collatz.Lemmas", ...stepImports, "", "namespace OpenConjecture.Collatz", ...defs];
  const lines = [...head, ...tests.map((t) => `set_option maxHeartbeats ${HEARTBEATS} in example : ${t.goal} := by ${t.tac}`), "end OpenConjecture.Collatz", ""];
  const file = `checker/anti_gaming/${name}.lean`;
  writeFileSync(file, lines.join("\n"));
  const r = spawnSync("lake", ["env", "lean", file], { encoding: "utf8", timeout: FILE_CAP_MS });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.error && r.error.code === "ETIMEDOUT") return { timedOut: true, out, proved: [] };
  const bad = new Set([...out.matchAll(/:(\d+):\d+: error/g)].map((m) => Number(m[1])));
  return { out, proved: tests.filter((t, k) => !bad.has(head.length + k + 1)) };
}
const unfoldTo = (names) => `simp only [${names.join(", ")}] at *`;
const trivialTests = (s) => TRIVIAL.map((tac) => ({ goal: s, tac: `unfold ${s}; ${tac}`, label: `by ${tac}` }));
const fillerTests = (hyps, parent) => FILLER.map((tac) => ({ goal: `(${hyps.join(" ∧ ")}) → ${parent}`,
  tac: `intro h; ${unfoldTo([...hyps, parent])}; ${tac}`, label: `${tac} from ${hyps.join(" ∧ ")}` }));

// Controls: each must be proved, or the check itself is broken.
const control = run("Control", [
  "def CtlTriv : Prop := ∀ n : ℕ, n + 0 = n",
  "def CtlParent : Prop := ∀ n : ℕ, n < 5 → n < 7",
  "def CtlFiller : Prop := ∀ n : ℕ, n < 5 → n < 7",
  "def CtlOther : Prop := ∀ n : ℕ, n < 9 → n < 9",
], [...trivialTests("CtlTriv").filter((t) => /omega|simp$/.test(t.tac)), ...fillerTests(["CtlFiller"], "CtlParent").slice(0, 2),
    ...fillerTests(["CtlFiller", "CtlOther"], "CtlParent").slice(2, 3)]);
if (control.timedOut || control.proved.length !== 5) {
  console.error(control.out);
  console.error(`FAULT: the anti-gaming check proved ${control.proved.length} of its 5 control statements; the check itself is broken.`);
  process.exit(2);
}

let bad = 0;
for (const s of steps) {
  const r = run(s, [], trivialTests(s));
  if (r.timedOut) console.log(`${s}: attempts ran out of time; counted as not trivial`);
  else if (r.proved.length) { bad++; console.error(`REJECTED: ${s} is trivial: ${r.proved.map((t) => t.label).join(", ")} proves it.`); }
  else console.log(`${s}: none of ${TRIVIAL.join(", ")} proves it`);
}
for (const [name, sp] of [...splits].sort()) {
  const k = sp.steps.length;
  // A one-step split is "it suffices to prove this step": the step implying the parent easily is the point.
  if (k === 1) { console.log(`${name}: one step, no filler check`); continue; }
  const sets = sp.steps.map((x) => [x]);
  if (k > 2) for (const drop of sp.steps) sets.push(sp.steps.filter((x) => x !== drop));
  const r = run(name, [], sets.flatMap((h) => fillerTests(h, sp.parent)));
  if (r.timedOut) { console.log(`${name}: filler attempts ran out of time; counted as not proven`); continue; }
  if (r.proved.length) { bad++; console.error(`REJECTED: ${name} has filler: ${sp.parent} follows by ${r.proved.map((t) => t.label).join("; ")}.`); }
  else console.log(`${name}: no single step${k > 2 ? " and no set of all-but-one steps" : ""} gives ${sp.parent} by cheap tactics`);
}
process.exit(bad ? 1 : 0);
