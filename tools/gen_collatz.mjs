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
  { id: "open-reach-count", parent: "summit-collatz", statement: "Open_ReachCount_0_9",
    lean: "∃ x₀ : ℕ, ∀ x : ℕ, x₀ ≤ x → (x : ℝ) ^ (0.9 : ℝ) ≤ (Set.ncard {n : ℕ | 0 < n ∧ n ≤ x ∧ Reaches n} : ℝ)",
    title_en: "Beat Krasikov–Lagarias: for large x, at least x^0.9 numbers up to x reach 1",
    title_zh: "超越 Krasikov–Lagarias：x 足够大时，x 以内至少有 x^0.9 个数会到 1",
    about_en: "Unsolved. The best known lower bound (Krasikov and Lagarias, 2003) is x^0.84. Any exponent above 0.84 would be new; 0.9 is the target here.",
    about_zh: "未解决。已知最好的下界是 x^0.84（Krasikov 与 Lagarias，2003）。任何大于 0.84 的指数都是新结果；这里的目标是 0.9。" },
  { id: "open-coefficient-stopping", parent: "summit-collatz", statement: "Open_CoefficientStopping",
    lean: `∀ n k : ℕ, 2 ≤ n → 3 ^ ((Finset.range k).filter (fun i => Nat.iterate ${T} i n % 2 = 1)).card < 2 ^ k → ∃ j : ℕ, j ≤ k ∧ Nat.iterate ${T} j n < n`,
    title_en: "Terras's coefficient stopping time conjecture: once the 3^a/2^k factor drops below 1, the number has dropped below itself",
    title_zh: "Terras 系数停时猜想：一旦系数 3^a/2^k 小于 1，这个数就已经降到自身以下",
    about_en: "Unsolved since Terras (1976). With T(n) = n/2 or (3n+1)/2, after k steps with a odd ones T^k(n) = (3^a/2^k) n + c with c ≥ 0. The conjecture says the stopping time equals the first k where 3^a < 2^k.",
    about_zh: "自 Terras（1976）以来未解决。用 T(n) = n/2 或 (3n+1)/2，走 k 步、其中 a 步为奇数时，T^k(n) = (3^a/2^k) n + c，c ≥ 0。猜想说：停时恰好等于第一个满足 3^a < 2^k 的 k。" },
  { id: "open-verified-2-80", parent: "summit-collatz", statement: "Open_VerifiedBelow_2_80",
    lean: "∀ n : ℕ, 0 < n → n < 2 ^ 80 → Reaches n",
    title_en: "Every number below 2^80 reaches 1",
    title_zh: "2^80 以下的每个数都会到 1",
    about_en: "Unsolved. Distributed computer searches have verified the conjecture beyond 2^68 (Barina, 2020); nobody has reached 2^80, and no Lean proof exists for anything near that range. native_decide is not allowed here, so a proof must be checkable by Lean's kernel.",
    about_zh: "未解决。分布式计算已经验证到 2^68 以上（Barina，2020），没有人验证到 2^80，更没有接近这个范围的 Lean 证明。这里不允许 native_decide，证明必须能由 Lean 内核检查。" },
  { id: "open-cycle-floor", parent: "summit-no-cycle", statement: "Open_CycleFloor_2_80",
    lean: "∀ n k : ℕ, 0 < n → 0 < k → step^[k] n = n → n = 1 ∨ n = 2 ∨ n = 4 ∨ 2 ^ 80 ≤ n",
    title_en: "Every number on a non-trivial cycle is at least 2^80",
    title_zh: "任何非平凡循环上的每个数都至少是 2^80",
    about_en: "Unsolved. Verification excludes cycle members below about 2^68. Pushing the floor to 2^80, by computation or by theory, has not been done.",
    about_zh: "未解决。现有验证排除了约 2^68 以下的循环成员。把下限推到 2^80，无论靠计算还是理论，都还没人做到。" },
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
