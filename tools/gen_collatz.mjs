// Generates the board: OpenConjecture/Collatz/Lemmas.lean (protected statements) and one record per
// problem in records/collatz/. Existing records are never overwritten.
// Usage: node tools/gen_collatz.mjs
//
// Every statement here is UNSOLVED: nobody has a proof or a disproof. We only state problems.
// Steps (tools/steps.mjs) are our own splits; each split comes with a Lean proof in
// OpenConjecture/Collatz/Splits/ that its steps together imply the parent. Outside agents prove or refute.
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import steps from "./steps.mjs";

const T = "(fun m : ℕ => if m % 2 = 0 then m / 2 else (3 * m + 1) / 2)";

const summits = [
  { id: "summit-collatz", statement: "Summit_Collatz", lean: "Conjecture",
    title_en: "The Collatz conjecture: every positive number reaches 1", title_zh: "Collatz 猜想：每个正整数最终都会到 1" },
  { id: "summit-no-cycle", statement: "Summit_NoCycle", lean: "∀ n k : ℕ, 0 < n → 0 < k → step^[k] n = n → n = 1 ∨ n = 2 ∨ n = 4",
    title_en: "No cycles: no positive number other than 1, 2 and 4 ever returns to itself", title_zh: "没有循环：除了 1、2、4，没有正整数会回到自身" },
  { id: "summit-no-divergence", statement: "Summit_NoDivergence", lean: "∀ n : ℕ, ∃ B : ℕ, ∀ k : ℕ, step^[k] n ≤ B",
    title_en: "No runaway: no starting number climbs forever", title_zh: "没有发散：没有任何起点会无限上升" },
];

// Open problems: precise, unsolved, and each a real step toward (or beside) a summit.
const open = [
  { id: "open-density-one", parent: "summit-collatz", statement: "Open_DensityOne",
    lean: "Filter.Tendsto (fun N : ℕ => ((Set.ncard {n : ℕ | n < N ∧ Reaches n} : ℝ) / N)) Filter.atTop (nhds 1)",
    title_en: "Almost every number reaches 1 (natural density 1)",
    title_zh: "几乎所有的数都会到 1（自然密度为 1）",
    about_en: "Unsolved. Terras (1976) proved that almost every number eventually drops below itself, and Tao (2019) that almost every orbit gets almost bounded (in logarithmic density). Neither shows that almost every number actually reaches 1.",
    about_zh: "未解决。Terras（1976）证明了几乎所有的数最终会降到自身以下，Tao（2019）证明了几乎所有轨道会降到“几乎有界”（对数密度意义下）。两者都没有证明几乎所有的数真的会到 1。" },
  { id: "open-reach-count", parent: "summit-collatz", statement: "Open_ReachCount_0_95",
    lean: "∃ x₀ : ℕ, ∀ x : ℕ, x₀ ≤ x → (x : ℝ) ^ (0.95 : ℝ) ≤ (Set.ncard {n : ℕ | 0 < n ∧ n ≤ x ∧ Reaches n} : ℝ)",
    title_en: "For large x, at least x^0.95 numbers up to x reach 1",
    title_zh: "x 足够大时，x 以内至少有 x^0.95 个数会到 1",
    about_en: "Unsolved. The best published lower bound is x^0.84 (Krasikov and Lagarias, Acta Arithmetica 2003, by a computer-assisted linear program). A 2026 preprint, reported in arXiv:2608.27617 but unrefereed, claims x^0.90 from a higher level of the same linear program. The target here, 0.95, is beyond both.",
    about_zh: "未解决。已发表的最好下界是 x^0.84（Krasikov 与 Lagarias，Acta Arithmetica 2003，借助计算机求解线性规划）。一篇 2026 年的预印本（arXiv:2608.27617 中提到，未经同行评审）声称用同一线性规划的更高层得到 x^0.90。这里的目标 0.95 超过两者。" },
  { id: "open-coefficient-stopping", parent: "summit-collatz", statement: "Open_CoefficientStopping",
    lean: `∀ n k : ℕ, 2 ≤ n → 3 ^ ((Finset.range k).filter (fun i => Nat.iterate ${T} i n % 2 = 1)).card < 2 ^ k → ∃ j : ℕ, j ≤ k ∧ Nat.iterate ${T} j n < n`,
    title_en: "Terras's coefficient stopping time conjecture: once the 3^a/2^k factor drops below 1, the number has dropped below itself",
    title_zh: "Terras 系数停时猜想：一旦系数 3^a/2^k 小于 1，这个数就已经降到自身以下",
    about_en: "Unsolved since Terras (1976). With T(n) = n/2 or (3n+1)/2, after k steps with a odd ones T^k(n) = (3^a/2^k) n + c with c ≥ 0. The conjecture says the stopping time equals the first k where 3^a < 2^k.",
    about_zh: "自 Terras（1976）以来未解决。用 T(n) = n/2 或 (3n+1)/2，走 k 步、其中 a 步为奇数时，T^k(n) = (3^a/2^k) n + c，c ≥ 0。猜想说：停时恰好等于第一个满足 3^a < 2^k 的 k。" },
  { id: "open-no-m-cycle-100", parent: "summit-no-cycle", statement: "Open_NoMCycle_100",
    lean: "(∀ n : ℕ, 0 < n → n < 2 ^ 71 → Reaches n) → ∀ n k : ℕ, 0 < n → 0 < k → step^[k] n = n → ((Finset.range k).filter (fun i => step^[i] n % 2 = 1 ∧ step^[i + k - 2] n % 2 = 0)).card ≤ 100 → n = 1 ∨ n = 2 ∨ n = 4",
    title_en: "No Collatz cycle with at most 100 local minima, given the verification up to 2^71",
    title_zh: "在已验证到 2^71 的前提下，不存在局部极小值不超过 100 个的 Collatz 循环",
    about_en: "Unsolved. An m-cycle is a cycle with m local minima (m blocks of odd steps); the count in the statement is exactly that: odd members two steps after an even one. Simons and de Weger (2005) excluded m ≤ 68; Hercher (Journal of Integer Sequences, 2023) excluded m ≤ 91, using the verification bound then available. Barina (Journal of Supercomputing, 2025) has since verified every number below 2^71, which is the hypothesis here. Nobody has published m ≤ 100.",
    about_zh: "未解决。m-循环是有 m 个局部极小值（m 段奇数步）的循环；命题中计数的正是这个：在一个偶数之后两步出现的奇数成员。Simons 与 de Weger（2005）排除了 m ≤ 68；Hercher（Journal of Integer Sequences，2023）利用当时的验证范围排除了 m ≤ 91。Barina（Journal of Supercomputing，2025）此后验证了 2^71 以下的所有数，这就是本题的前提。还没有人发表 m ≤ 100 的结果。" },
  { id: "open-five-x-plus-one", parent: "summit-no-divergence", statement: "Open_FiveXPlusOne_7",
    lean: "∀ B : ℕ, ∃ k : ℕ, B < Nat.iterate (fun m : ℕ => if m % 2 = 0 then m / 2 else 5 * m + 1) k 7",
    title_en: "The 5x+1 cousin: the orbit of 7 under n → n/2 or 5n+1 grows without bound",
    title_zh: "5x+1 版本：在 n → n/2 或 5n+1 下，7 的轨道会无限增长",
    about_en: "Unsolved. For the 5x+1 map, almost every orbit is expected to diverge, and 7 is the smallest number whose orbit has never been seen to return. Nobody has proved that any 5x+1 orbit diverges. Methods that prove divergence here may show what a divergent 3x+1 orbit would need.",
    about_zh: "未解决。对 5x+1 映射，人们预期几乎所有轨道都会发散，7 是最小的、从未被观察到回落的起点。但没有人证明过任何一条 5x+1 轨道发散。能在这里证明发散的方法，也许能说明 3x+1 的发散轨道需要满足什么。" },
];

const lean = [
  "import OpenConjecture.Collatz.Basic",
  "",
  "/-!",
  "# The board: unsolved statements only",
  "",
  "Generated by `tools/gen_collatz.mjs`. This file is protected: pull requests may not change it.",
  "Every definition below is an open problem. Steps are proved to imply their parent in `Splits/`.",
  "-/",
  "",
  "namespace OpenConjecture.Collatz",
  "",
];
for (const s of summits) lean.push(`/-- Unsolved summit. -/`, `def ${s.statement} : Prop := ${s.lean}`, "");
for (const s of open) lean.push(`/-- Unsolved, under ${s.parent}. -/`, `def ${s.statement} : Prop := ${s.lean}`, "");
for (const s of steps) lean.push(`/-- Unsolved step of ${s.parent}; see ${s.split}. -/`, `def ${s.statement} : Prop := ${s.lean}`, "");
lean.push("end OpenConjecture.Collatz", "");
writeFileSync("OpenConjecture/Collatz/Lemmas.lean", lean.join("\n"));

mkdirSync("records/collatz", { recursive: true });
let created = 0;
const put = (rec) => {
  const f = `records/collatz/${rec.id}.json`;
  if (existsSync(f)) return;
  writeFileSync(f, JSON.stringify(rec, null, 2) + "\n");
  created++;
};
for (const s of summits)
  put({ id: s.id, kind: "summit", statement: s.statement, difficulty: 1000, title_en: s.title_en, title_zh: s.title_zh, status: "open" });
for (const s of open)
  put({ id: s.id, kind: "program", parent: s.parent, statement: s.statement, difficulty: 900, title_en: s.title_en, title_zh: s.title_zh,
    about_en: s.about_en, about_zh: s.about_zh, status: "open" });
for (const s of steps)
  put({ id: s.id, kind: "step", parent: s.parent, split: s.split, statement: s.statement, difficulty: 850, title_en: s.title_en, title_zh: s.title_zh,
    sketch: s.sketch, status: "open" });
console.log(`${summits.length} summits + ${open.length} open problems + ${steps.length} steps, ${created} new records`);
