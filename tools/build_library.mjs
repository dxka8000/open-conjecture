// Builds the open-problem library index, site/library/library.json, from:
//  - google-deepmind/formal-conjectures (Apache-2.0): every theorem marked `@[category research open, ...]`,
//    with its docstring, Lean statement, AMS subject codes and the reference link of its file;
//  - our own board (the open problems in records/collatz), marked "on the board".
// Usage: node tools/build_library.mjs <path to a formal-conjectures checkout> <its commit hash>
// Run it by hand to refresh the library; the output is committed. Nothing is fetched at site build time.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Theorem names repeat across files (OEIS files all have "conjecture_1", for example), and an id must name exactly one
// problem: votes and research-note folders are keyed by it. A repeated name becomes "fc:<file path>.<name>", plus
// ".L<line>" if the same name repeats inside one file. Unique names keep "fc:<name>".
function dedupeIds(list) {
  const count = new Map();
  for (const e of list) count.set(e.id, (count.get(e.id) || 0) + 1);
  for (const e of list) {
    if (count.get(e.id) < 2 || !e.id.startsWith("fc:")) continue;
    const fc = (e.links || []).find((l) => l.label === "formal-conjectures");
    const m = fc && /\/FormalConjectures\/(.+)\.lean#L(\d+)$/.exec(fc.url);
    if (!m) continue;
    e._line = m[2];
    e.id = "fc:" + `${m[1].replace(/\//g, ".")}.${e.id.slice(3)}`.replace(/[^A-Za-z0-9_.'-]/g, "_");
  }
  const again = new Map();
  for (const e of list) again.set(e.id, (again.get(e.id) || 0) + 1);
  for (const e of list) { if (again.get(e.id) > 1 && e._line) e.id += `.L${e._line}`; delete e._line; }
  if (new Set(list.map((e) => e.id)).size !== list.length) throw new Error("library ids are still not unique");
  return list;
}
if (process.argv[2] === "--dedupe") {
  // Fix the ids of the committed library in place, without a formal-conjectures checkout.
  const d = JSON.parse(readFileSync("site/library/library.json", "utf8"));
  dedupeIds(d.entries);
  writeFileSync("site/library/library.json", JSON.stringify(d));
  console.log(`library: ${d.entries.length} entries, ids unique`);
  process.exit(0);
}

const [, , FC, COMMIT = "main"] = process.argv;
if (!FC || !existsSync(join(FC, "FormalConjectures"))) { console.error("usage: node tools/build_library.mjs <formal-conjectures checkout> <commit>"); process.exit(2); }
const REPO = "https://github.com/google-deepmind/formal-conjectures";
const MSC = { 3: "Logic", 5: "Combinatorics", 6: "Order and lattices", 8: "Algebraic systems", 11: "Number theory", 12: "Field theory", 13: "Commutative algebra",
  14: "Algebraic geometry", 15: "Linear algebra", 16: "Rings and algebras", 17: "Nonassociative algebra", 18: "Category theory", 19: "K-theory", 20: "Group theory",
  22: "Topological groups", 26: "Real functions", 28: "Measure theory", 30: "Complex analysis", 31: "Potential theory", 32: "Several complex variables",
  33: "Special functions", 34: "ODEs", 35: "PDEs", 37: "Dynamical systems", 39: "Difference equations", 40: "Sequences and series", 41: "Approximation theory",
  42: "Harmonic analysis", 43: "Abstract harmonic analysis", 44: "Integral transforms", 45: "Integral equations", 46: "Functional analysis", 47: "Operator theory",
  49: "Calculus of variations", 51: "Geometry", 52: "Convex and discrete geometry", 53: "Differential geometry", 54: "General topology", 55: "Algebraic topology",
  57: "Manifolds", 58: "Global analysis", 60: "Probability", 62: "Statistics", 65: "Numerical analysis", 68: "Computer science", 81: "Quantum theory",
  90: "Operations research", 91: "Game theory", 92: "Biology", 94: "Information theory", 97: "Mathematics education" };
const SOURCE = { ErdosProblems: "Erdős problems", Wikipedia: "Wikipedia", OEIS: "OEIS", Mathoverflow: "MathOverflow", Arxiv: "arXiv papers", Books: "Books",
  GreensOpenProblems: "Green's open problems", HilbertProblems: "Hilbert's problems", Kourovka: "Kourovka notebook", LittProblems: "Litt's problems",
  Millennium: "Millennium problems", OpenQuantumProblems: "Open quantum problems", OptimizationConstants: "Optimization constants", Other: "Other", Paper: "Papers",
  Subsets: "Subsets", WrittenOnTheWallII: "Written on the Wall II" };

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".lean")) files.push(p); } };
walk(join(FC, "FormalConjectures"));

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const entries = [];
for (const file of files.sort()) {
  const src = readFileSync(file, "utf8");
  const rel = relative(FC, file).split(sep).join("/");
  const collection = rel.split("/")[1];
  const head = /\/-!\s*\n#\s*([^\n]+)/.exec(src);
  const fileTitle = head ? head[1].trim() : rel.split("/").pop().replace(/\.lean$/, "");
  const headerBlock = (/\/-!([\s\S]*?)-\//.exec(src) || ["", ""])[1];
  const refs = [...headerBlock.matchAll(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g)].slice(0, 3).map((x) => ({ label: x[1].slice(0, 60), url: x[2] }));
  // Each open theorem: docstring, optional set_option lines, the attribute, then the statement.
  const re = /\/--((?:(?!-\/)[\s\S])*)-\/\s*\n(?:set_option[^\n]*\n)*@\[category research open([^\]]*)\]\s*\n\s*theorem\s+([^\s:]+)\s*((?:(?!:=)[\s\S])*?):=\s*by/g;
  for (const m of src.matchAll(re)) {
    const doc = m[1].replace(/\s+/g, " ").trim();
    const ams = [...m[2].matchAll(/AMS((?:\s+\d+)+)/g)].flatMap((x) => x[1].trim().split(/\s+/).map(Number));
    const name = m[3];
    const statement = m[4].replace(/\n\s*/g, "\n").trim().replace(/^:\s*/, "");
    const line = src.slice(0, m.index).split("\n").length;
    entries.push({
      id: `fc:${name}`,
      title: name.includes(".variants.") ? `${fileTitle} (variant ${name.split(".variants.")[1]})` : fileTitle,
      statement: clip(doc, 700),
      lean: clip(statement, 1500),
      areas: [...new Set(ams.map((c) => MSC[c]).filter(Boolean))],
      source: SOURCE[collection] || collection,
      links: [...refs, { label: "formal-conjectures", url: `${REPO}/blob/${COMMIT}/${rel}#L${line}` }],
      status: "open",
      formalized: true,
    });
  }
}

// Our own board.
const board = readdirSync("records/collatz").map((f) => JSON.parse(readFileSync(`records/collatz/${f}`, "utf8"))).filter((r) => r.kind === "program");
const bodies = new Map([...readFileSync("OpenConjecture/Collatz/Lemmas.lean", "utf8").matchAll(/^def ([A-Za-z0-9_]+) : Prop := (.*)$/gm)].map((m) => [m[1], m[2]]));
const ours = board.map((r) => ({
  id: `ph:${r.id}`, title: r.title_en, title_zh: r.title_zh, statement: r.about_en, statement_zh: r.about_zh, lean: bodies.get(r.statement) || "",
  areas: ["Number theory", "Dynamical systems"], source: "ProofHive", links: [{ label: "On the board", url: `lemmas.html#l-${r.id}` }],
  status: r.status === "open" ? "open" : r.status, formalized: true, on_board: true,
}));

const out = {
  generated: new Date().toISOString().slice(0, 10),
  attribution: {
    "formal-conjectures": { repo: REPO, commit: COMMIT, license: "Apache-2.0",
      notice: "Statements, docstrings and Lean code from google-deepmind/formal-conjectures, Copyright The Formal Conjectures Authors, licensed under the Apache License, Version 2.0. Shortened and reformatted here; see the linked source file for the original." },
  },
  entries: dedupeIds([...ours, ...entries]),
};
mkdirSync("site/library", { recursive: true });
writeFileSync("site/library/library.json", JSON.stringify(out));
writeFileSync("site/library/NOTICE.txt", `The open-problem library includes material from google-deepmind/formal-conjectures (${REPO}),\ncommit ${COMMIT}, Copyright The Formal Conjectures Authors, licensed under the Apache License, Version 2.0:\nhttps://www.apache.org/licenses/LICENSE-2.0\nStatements were shortened and reformatted. Links to erdosproblems.com and other sources point to the originals; their text is not copied.\n`);
console.log(`library: ${ours.length} on the board + ${entries.length} open problems from formal-conjectures (${(JSON.stringify(out).length / 1e6).toFixed(2)} MB)`);
