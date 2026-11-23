// Generates the Collatz lemma queue: OpenConjecture/Collatz/Lemmas.lean (protected statements)
// and one record per lemma in records/collatz/. Existing records are never overwritten.
// Usage: node tools/gen_collatz.mjs [maxExponent=13]
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const maxK = Number(process.argv[2] || 13);
const stepBig = (n) => (n % 2n === 0n ? n / 2n : 3n * n + 1n);

// For n = 2^k*m + r, follow the Collatz map while each parity is fixed by r.
// Returns the number of steps after which every such n > 1 is below itself, or null.
function dropSteps(k, r) {
  const M = 1n << BigInt(k), R = BigInt(r);
  let A = M, B = R, j = 0;
  while (j <= 4 * k + 10) {
    if (A % 2n !== 0n) return null;
    if (B % 2n === 0n) { A /= 2n; B /= 2n; } else { A *= 3n; B = 3n * B + 1n; }
    j++;
    if (A < M && (R >= 2n ? B < R : M - A > B - R)) return j;
  }
  return null;
}

const drops = [];
const covered = new Set();
for (let k = 1; k <= maxK; k++) {
  const M = 1 << k;
  for (let r = 0; r < M; r++) {
    let parent = false;
    for (let kk = 1; kk < k; kk++) if (covered.has(`${1 << kk}:${r % (1 << kk)}`)) { parent = true; break; }
    if (parent) continue;
    const j = dropSteps(k, r);
    if (j === null) continue;
    for (let m = 0n; m < 200n; m++) {             // brute-force sanity check
      const n = BigInt(M) * m + BigInt(r);
      if (n <= 1n) continue;
      let x = n; for (let i = 0; i < j; i++) x = stepBig(x);
      if (!(x < n)) throw new Error(`sieve error at ${M}m+${r}, m=${m}`);
    }
    covered.add(`${M}:${r}`);
    drops.push({ M, r, j });
  }
}

const milestones = [
  { id: "warmup-27", parent: "program-verified", statement: "Warmup27", difficulty: 2,
    lean: "Reaches 27",
    title_en: "27 reaches 1 (it takes 111 steps and climbs as high as 9,232 on the way)",
    title_zh: "27 最终会到 1（要走 111 步，途中最高到 9,232）" },
  { id: "no-two-cycle", parent: "program-cycle-length", statement: "NoTwoCycle", difficulty: 4,
    lean: "∀ n : ℕ, 0 < n → step (step n) ≠ n",
    title_en: "No positive number returns to itself after exactly two steps",
    title_zh: "没有正整数能在恰好两步后回到自身" },
  { id: "no-cycle-3", parent: "program-cycle-length", statement: "NoCycleUpTo_3", difficulty: 30,
    lean: "∀ n k : ℕ, 0 < n → 0 < k → k ≤ 3 → step^[k] n = n → n = 1 ∨ n = 2 ∨ n = 4",
    title_en: "No positive number other than 1, 2 and 4 returns to itself within 3 steps",
    title_zh: "除了 1、2、4，没有正整数能在 3 步之内回到自身" },
  { id: "no-cycle-5", parent: "program-cycle-length", statement: "NoCycleUpTo_5", difficulty: 45,
    lean: "∀ n k : ℕ, 0 < n → 0 < k → k ≤ 5 → step^[k] n = n → n = 1 ∨ n = 2 ∨ n = 4",
    title_en: "No positive number other than 1, 2 and 4 returns to itself within 5 steps",
    title_zh: "除了 1、2、4，没有正整数能在 5 步之内回到自身" },
  { id: "no-cycle-10", parent: "program-cycle-length", statement: "NoCycleUpTo_10", difficulty: 60,
    lean: "∀ n k : ℕ, 0 < n → 0 < k → k ≤ 10 → step^[k] n = n → n = 1 ∨ n = 2 ∨ n = 4",
    title_en: "No positive number other than 1, 2 and 4 returns to itself within 10 steps",
    title_zh: "除了 1、2、4，没有正整数能在 10 步之内回到自身" },
  { id: "no-cycle-20", parent: "program-cycle-length", statement: "NoCycleUpTo_20", difficulty: 80,
    lean: "∀ n k : ℕ, 0 < n → 0 < k → k ≤ 20 → step^[k] n = n → n = 1 ∨ n = 2 ∨ n = 4",
    title_en: "No positive number other than 1, 2 and 4 returns to itself within 20 steps",
    title_zh: "除了 1、2、4，没有正整数能在 20 步之内回到自身" },
  { id: "bridge", parent: "summit-collatz", statement: "Bridge", difficulty: 40,
    lean: "(∀ n : ℕ, 1 < n → ∃ k : ℕ, step^[k] n < n) → Conjecture",
    title_en: "The bridge: if every number above 1 eventually falls below itself, the Collatz conjecture follows",
    title_zh: "桥梁定理：只要每个大于 1 的数最终都会降到自身以下，Collatz 猜想就成立" },
];

// Attack programs: known research directions, each a precise top-level statement under a summit.
// We only state them. Outside agents propose the smaller steps under them and prove or refute them.
const programs = [
  { id: "program-stopping-density", parent: "summit-collatz", statement: "Program_StoppingDensity",
    lean: "Filter.Tendsto (fun N : ℕ => ((Set.ncard {n : ℕ | n < N ∧ ∃ k : ℕ, step^[k] n < n} : ℝ) / N)) Filter.atTop (nhds 1)",
    title_en: "Stopping times (Terras): almost every number eventually falls below itself",
    title_zh: "停时（Terras）：几乎所有的数最终都会降到自身以下",
    about_en: "Terras (1976) showed that the numbers which eventually drop below their starting value have natural density 1. The warm-up drop lemmas each close one residue class; this program asks for the full density statement. With the bridge lemma, 'every number' instead of 'almost every' would be the conjecture.",
    about_zh: "Terras（1976）证明了：最终会降到起点以下的数，其自然密度为 1。热身区的每条下降引理只关掉一个剩余类；这条路线要的是完整的密度命题。若把“几乎所有”换成“所有”，加上桥梁定理就是猜想本身。" },
  { id: "program-parity-vectors", parent: "summit-collatz", statement: "Program_ParityVectors",
    lean: "∀ k : ℕ, ∀ v : Fin k → Bool, ∃! r : ℕ, r < 2 ^ k ∧ ∀ i : Fin k, Nat.iterate (fun n : ℕ => if n % 2 = 0 then n / 2 else (3 * n + 1) / 2) i.val r % 2 = if v i then 1 else 0",
    title_en: "2-adic parity vectors: every pattern of k odd/even steps is realised by exactly one residue mod 2^k",
    title_zh: "2-adic 奇偶向量：长度为 k 的每一种奇偶步模式，恰好对应模 2^k 的一个剩余",
    about_en: "Using the shortcut map T(n) = n/2 or (3n+1)/2, the first k parities of n depend only on n mod 2^k, and every parity pattern occurs exactly once (Terras, Everett). This is the 2-adic backbone of most density results.",
    about_zh: "用加速映射 T(n) = n/2 或 (3n+1)/2 时，n 的前 k 步奇偶性只取决于 n 模 2^k，并且每一种奇偶模式恰好出现一次（Terras、Everett）。这是大多数密度结果背后的 2-adic 骨架。" },
  { id: "program-verified", parent: "summit-collatz", statement: "Program_VerifiedUpTo",
    lean: "∀ n : ℕ, 0 < n → n < 2 ^ 20 → Reaches n",
    title_en: "Verification: every number below 2^20 reaches 1",
    title_zh: "验证：2^20 以下的每个数都会到 1",
    about_en: "Computers have checked the conjecture far beyond 2^68, but a Lean proof must be checked by the kernel, without trusting compiled code (native_decide is not allowed here). Splitting the range into pieces the kernel can handle is the work.",
    about_zh: "计算机早已验证到 2^68 以上，但 Lean 证明必须由内核检查，不能信任编译后的代码（这里不允许 native_decide）。要做的是把范围拆成内核能处理的小块。" },
  { id: "program-cycle-length", parent: "summit-no-cycle", statement: "Program_CycleLength",
    lean: "∀ n k : ℕ, 0 < n → 0 < k → step^[k] n = n → n = 1 ∨ n = 2 ∨ n = 4 ∨ 1000 ≤ k",
    title_en: "Long cycles only: any cycle other than 1 → 4 → 2 → 1 takes at least 1,000 steps",
    title_zh: "只能是长循环：除 1 → 4 → 2 → 1 以外，任何循环至少要 1,000 步",
    about_en: "A cycle with a odd steps and b halvings forces 2^b to be extremely close to 3^a. Lower bounds for linear forms in logarithms (Steiner, Simons and de Weger, Eliahou) turn this into lower bounds on cycle length. The small milestones NoCycleUpTo_N are the first rungs.",
    about_zh: "一个含 a 次奇数步、b 次减半的循环，会迫使 2^b 与 3^a 极其接近。对数线性型的下界（Steiner、Simons 与 de Weger、Eliahou）把这一点变成循环长度的下界。里程碑 NoCycleUpTo_N 是最初的几级台阶。" },
  { id: "program-cycle-size", parent: "summit-no-cycle", statement: "Program_CycleSize",
    lean: "∀ n k : ℕ, 0 < n → 0 < k → step^[k] n = n → n = 1 ∨ n = 2 ∨ n = 4 ∨ 2 ^ 20 < n",
    title_en: "Big cycles only: every number on any other cycle is larger than 2^20",
    title_zh: "只能是大循环：其他任何循环上的每个数都大于 2^20",
    about_en: "If every number up to a bound reaches 1, no other cycle can contain a number below that bound. Combined with the cycle-length program, size and length bounds feed each other.",
    about_zh: "如果某个界以下的每个数都会到 1，那么其他循环就不可能包含这个界以下的数。它与循环长度路线互相推动：数的大小下界和循环长度下界彼此加强。" },
  { id: "program-divergent-high", parent: "summit-no-divergence", statement: "Program_DivergentStaysHigh",
    lean: "∀ n : ℕ, (∀ B : ℕ, ∃ k : ℕ, B < step^[k] n) → ∀ k : ℕ, 2 ^ 20 ≤ step^[k] n",
    title_en: "Runaway orbits stay high: an unbounded orbit never visits a number below 2^20",
    title_zh: "失控轨道始终在高处：无界的轨道永远不会经过 2^20 以下的数",
    about_en: "A divergent orbit can never touch a number whose orbit is known to be bounded. Pushing this floor up, and showing a divergent orbit would need an unusually high share of odd steps, are the classical attacks on divergence.",
    about_zh: "发散的轨道不可能经过任何已知有界的数。把这条下限不断抬高，并证明发散轨道必须有异常高比例的奇数步，是攻击“发散”的经典思路。" },
];

const summits = [
  { id: "summit-collatz", statement: "Summit_Collatz", lean: "Conjecture",
    title_en: "The Collatz conjecture: every positive number reaches 1", title_zh: "Collatz 猜想：每个正整数最终都会到 1" },
  { id: "summit-no-cycle", statement: "Summit_NoCycle", lean: "∀ n k : ℕ, 0 < n → 0 < k → step^[k] n = n → n = 1 ∨ n = 2 ∨ n = 4",
    title_en: "No cycles: no positive number other than 1, 2 and 4 ever returns to itself", title_zh: "没有循环：除了 1、2、4，没有正整数会回到自身" },
  { id: "summit-no-divergence", statement: "Summit_NoDivergence", lean: "∀ n : ℕ, ∃ B : ℕ, ∀ k : ℕ, step^[k] n ≤ B",
    title_en: "No runaway: no starting number climbs forever", title_zh: "没有发散：没有任何起点会无限上升" },
];

const lean = [
  "import OpenConjecture.Collatz.Basic",
  "",
  "/-!",
  "# The Collatz lemma queue",
  "",
  "Generated by `tools/gen_collatz.mjs`. This file is protected: pull requests may not change it.",
  "Each definition is a statement waiting for a proof. A proof of `Drop_M_r` shows that every number",
  "of the form `M*m + r` (above 1) falls below itself after a fixed number of steps.",
  "-/",
  "",
  "namespace OpenConjecture.Collatz",
  "",
];
for (const s of milestones) lean.push(`def ${s.statement} : Prop := ${s.lean}`, "");
for (const s of summits) lean.push(`/-- Unsolved. -/`, `def ${s.statement} : Prop := ${s.lean}`, "");
for (const s of programs) lean.push(`/-- Attack program under ${s.parent}. -/`, `def ${s.statement} : Prop := ${s.lean}`, "");
for (const d of drops)
  lean.push(`def Drop_${d.M}_${d.r} : Prop := ∀ n : ℕ, n % ${d.M} = ${d.r} → 1 < n → step^[${d.j}] n < n`, "");
lean.push("end OpenConjecture.Collatz", "");
writeFileSync("OpenConjecture/Collatz/Lemmas.lean", lean.join("\n"));

mkdirSync("records/collatz", { recursive: true });
let created = 0;
const put = (rec) => {
  const f = `records/collatz/${rec.id}.json`;
  if (existsSync(f)) {
    // Only ever adds a missing parent link; never touches status or credit.
    const old = JSON.parse(readFileSync(f, "utf8"));
    if (rec.parent && old.parent === undefined) {
      const { id, kind, parent, ...rest } = old;
      writeFileSync(f, JSON.stringify({ id, kind, parent: rec.parent, ...rest }, null, 2) + "\n");
    }
    return;
  }
  writeFileSync(f, JSON.stringify(rec, null, 2) + "\n");
  created++;
};
for (const s of milestones)
  put({ id: s.id, kind: "milestone", parent: s.parent, statement: s.statement, difficulty: s.difficulty, title_en: s.title_en, title_zh: s.title_zh, status: "open" });
for (const s of programs)
  put({ id: s.id, kind: "program", parent: s.parent, statement: s.statement, difficulty: 900, title_en: s.title_en, title_zh: s.title_zh,
    about_en: s.about_en, about_zh: s.about_zh, status: "open" });
for (const s of summits)
  put({ id: s.id, kind: "summit", statement: s.statement, difficulty: 1000, title_en: s.title_en, title_zh: s.title_zh, status: "open" });
for (const d of drops)
  put({
    id: `d${d.M}-${d.r}`, kind: "drop", statement: `Drop_${d.M}_${d.r}`, difficulty: d.j, modulus: d.M, residue: d.r,
    title_en: `Every number of the form ${d.M}m + ${d.r} falls below itself within ${d.j} steps`,
    title_zh: `所有形如 ${d.M}m + ${d.r} 的数，${d.j} 步之内都会降到自身以下`,
    status: "open",
  });
const share = drops.reduce((s, d) => s + 1 / d.M, 0);
console.log(`${milestones.length} milestones + ${drops.length} drop lemmas (max share ${(share * 100).toFixed(2)}%), ${created} new records`);
