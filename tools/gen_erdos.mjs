// Generates the Erdős campaign: OpenConjecture/Erdos/Lemmas.lean (protected statements) and one record per
// statement in records/erdos/. Existing records are never overwritten.
// Usage: node tools/gen_erdos.mjs
//
// Seven problems, all OPEN on erdosproblems.com (status checked 2026-11-26 against the site and its database,
// github.com/teorth/erdosproblems). Statements follow google-deepmind/formal-conjectures (Apache-2.0).
//   summit     the Erdős problem itself. Unsolved.
//   program    an open sub-problem: unsolved too (a stronger form, or one hard case).
//   milestone  a KNOWN or computer-checkable special case that is not yet proved in Lean here: concrete work an AI
//              agent can finish today (check small cases, prove a known special case). Never presented as progress
//              on the open problem itself.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

const ES = "∃ x y z : ℕ, 1 ≤ x ∧ x < y ∧ y < z ∧ (4 / n : ℚ) = 1 / x + 1 / y + 1 / z";
const C389 = "∃ k : ℕ, 1 ≤ k ∧ (∏ i ∈ Finset.range k, (n + i)) ∣ ∏ i ∈ Finset.range k, (n + k + i)";
const W2 = "x.primeFactors = y.primeFactors ∧ (x + 1).primeFactors = (y + 1).primeFactors";
const F373 = "p.2.Pairwise (· ≥ ·) ∧ (∀ a ∈ p.2, 2 ≤ a ∧ a + 1 < p.1) ∧ p.1.factorial = (p.2.map Nat.factorial).prod";

export const problems = [
  {
    erdos: 242, id: "erdos-242", statement: "Summit_Erdos242", lean: `∀ n : ℕ, 2 < n → ${ES}`,
    title_en: "Erdős #242, the Erdős–Straus conjecture: 4/n = 1/x + 1/y + 1/z for every n > 2",
    title_zh: "Erdős #242，Erdős–Straus 猜想：每个 n > 2 都有 4/n = 1/x + 1/y + 1/z",
    pitch_en: "One of the most famous unit-fraction problems: a statement a child can check, open since the 1940s.",
    pitch_zh: "最著名的单位分数问题之一：小学生都能验算，却从 1940 年代悬而未决。",
    about_en: "Open. It suffices to prove it for prime n. It has been verified for every n ≤ 10^18. Mordell proved it for every n except those congruent to 1, 121, 169, 289, 361 or 529 modulo 840, and Vaughan showed exceptions are very rare. Source: erdosproblems.com/242.",
    about_zh: "未解决。只需对素数 n 证明。已对所有 n ≤ 10^18 验证。Mordell 证明了除模 840 余 1、121、169、289、361、529 以外的所有 n，Vaughan 证明了例外极为稀少。来源：erdosproblems.com/242。",
    kids: [
      { id: "erdos-242-up-to-100", kind: "milestone", statement: "Mile_Erdos242_UpTo100", difficulty: 300, lean: `∀ n : ℕ, 2 < n → n ≤ 100 → ${ES}`,
        title_en: "Check in Lean: a solution for every n from 3 to 100",
        title_zh: "用 Lean 检验：n 从 3 到 100 都有解",
        about_en: "Known (verified far beyond, to 10^18). The task is a Lean proof: give x < y < z for each n and let Lean check the fractions. A short computer search finds them all." ,
        about_zh: "已知（早已验证到 10^18）。任务是写出 Lean 证明：对每个 n 给出 x < y < z，让 Lean 检查分数等式。简单的计算机搜索就能全部找到。" },
      { id: "erdos-242-even", kind: "milestone", statement: "Mile_Erdos242_Even", difficulty: 200, lean: `∀ n : ℕ, 2 < n → 2 ∣ n → ${ES}`,
        title_en: "Prove in Lean: every even n > 2 has a solution",
        title_zh: "用 Lean 证明：每个大于 2 的偶数 n 都有解",
        about_en: "Known and elementary: for n = 2m with m ≥ 2, 4/n = 1/m + 1/(m+1) + 1/(m(m+1)).",
        about_zh: "已知且初等：n = 2m（m ≥ 2）时，4/n = 1/m + 1/(m+1) + 1/(m(m+1))。" },
      { id: "erdos-242-three-mod-four", kind: "milestone", statement: "Mile_Erdos242_ThreeModFour", difficulty: 250, lean: `∀ n : ℕ, n % 4 = 3 → ${ES}`,
        title_en: "Prove in Lean: every n ≡ 3 (mod 4) has a solution",
        title_zh: "用 Lean 证明：每个 n ≡ 3 (mod 4) 都有解",
        about_en: "Known: for n = 4k + 3, 4/n = 1/(k+1) + 1/(n(k+1)), and the last fraction splits as 1/N = 1/(N+1) + 1/(N(N+1)).",
        about_zh: "已知：n = 4k + 3 时，4/n = 1/(k+1) + 1/(n(k+1))，最后一项再拆成 1/N = 1/(N+1) + 1/(N(N+1))。" },
      { id: "erdos-242-one-mod-840", kind: "program", statement: "Open_Erdos242_OneMod840", difficulty: 900, lean: `∀ n : ℕ, 1 < n → n % 840 = 1 → ${ES}`,
        title_en: "Open: every n > 1 with n ≡ 1 (mod 840) has a solution",
        title_zh: "未解决：每个 n > 1 且 n ≡ 1 (mod 840) 都有解",
        about_en: "Unsolved. This is one of the six residue classes modulo 840 that Mordell's identities (1969) do not cover. It contains infinitely many primes, and no proof is known for it." ,
        about_zh: "未解决。这是 Mordell（1969）的恒等式覆盖不到的六个模 840 剩余类之一。它包含无穷多个素数，目前没有证明。" },
    ],
  },
  {
    erdos: 406, id: "erdos-406", statement: "Summit_Erdos406", lean: "{n : ℕ | ∀ d ∈ Nat.digits 3 (2 ^ n), d ≤ 1}.Finite",
    title_en: "Erdős #406: only finitely many powers of 2 use just the digits 0 and 1 in base 3",
    title_zh: "Erdős #406：三进制下只用数字 0 和 1 的 2 的幂只有有限个",
    pitch_en: "Two bases fighting: a simple digit question about 2^n in base 3 that nobody can settle.",
    pitch_zh: "两个进制的较量：关于 2^n 三进制数字的简单问题，至今无人能解决。",
    about_en: "Open. The only known examples are 1, 4 and 256 (n = 0, 2, 8). Saye (2022) computed that 2^n contains every ternary digit for 16 ≤ n ≤ 5.9 × 10^21. Narkiewicz (1980) bounded how often it can happen. Source: erdosproblems.com/406.",
    about_zh: "未解决。已知的例子只有 1、4、256（n = 0、2、8）。Saye（2022）计算了 16 ≤ n ≤ 5.9 × 10^21 时 2^n 的三进制包含全部三个数字。Narkiewicz（1980）给出了出现次数的上界。来源：erdosproblems.com/406。",
    kids: [
      { id: "erdos-406-up-to-100", kind: "milestone", statement: "Mile_Erdos406_UpTo100", difficulty: 300, lean: "∀ n : ℕ, 9 ≤ n → n ≤ 100 → 2 ∈ Nat.digits 3 (2 ^ n)",
        title_en: "Check in Lean: 2^n has a digit 2 in base 3 for every n from 9 to 100",
        title_zh: "用 Lean 检验：n 从 9 到 100 时，2^n 的三进制含数字 2",
        about_en: "Known by computation (Saye checked far beyond). The task is a Lean proof Lean's kernel can check, for example by evaluating the digits.",
        about_zh: "计算已知（Saye 早已验证到远超此范围）。任务是写出 Lean 内核能检查的证明，例如直接计算数字。" },
      { id: "erdos-406-digit-two", kind: "program", statement: "Open_Erdos406_DigitTwo", difficulty: 900, lean: "∀ n : ℕ, 9 ≤ n → 2 ∈ Nat.digits 3 (2 ^ n)",
        title_en: "Open: 2^n has a digit 2 in base 3 for every n ≥ 9",
        title_zh: "未解决：每个 n ≥ 9，2^n 的三进制都含数字 2",
        about_en: "Unsolved. This stronger form implies Erdős #406. It is what the computations suggest: n = 8 (256) is the last power of 2 without a digit 2.",
        about_zh: "未解决。这个更强的形式蕴含 Erdős #406，也是计算结果所提示的：n = 8（256）是最后一个不含数字 2 的 2 的幂。" },
    ],
  },
  {
    erdos: 376, id: "erdos-376", statement: "Summit_Erdos376", lean: "{n : ℕ | Nat.Coprime (Nat.centralBinom n) 105}.Infinite",
    title_en: "Erdős #376: infinitely many n with C(2n, n) coprime to 105",
    title_zh: "Erdős #376：有无穷多个 n 使 C(2n, n) 与 105 互素",
    pitch_en: "A digits puzzle in bases 3, 5 and 7 at once; Graham offered $1000 for it.",
    pitch_zh: "同时涉及 3、5、7 三个进制的数字谜题；Graham 曾为它悬赏 1000 美元。",
    about_en: "Open. By Kummer's theorem it asks for infinitely many n whose digits are 0–1 in base 3, 0–2 in base 5 and 0–3 in base 7 (OEIS A030979: 1, 10, 756, 757, 3160, …). Erdős, Graham, Ruzsa and Straus (1975) proved it for any two odd primes instead of three. Source: erdosproblems.com/376.",
    about_zh: "未解决。由 Kummer 定理，它问的是：是否有无穷多个 n，三进制数字只有 0–1、五进制只有 0–2、七进制只有 0–3（OEIS A030979：1、10、756、757、3160……）。Erdős、Graham、Ruzsa、Straus（1975）证明了任意两个奇素数（而不是三个）的情形。来源：erdosproblems.com/376。",
    kids: [
      { id: "erdos-376-examples", kind: "milestone", statement: "Mile_Erdos376_Examples", difficulty: 150, lean: "∀ n ∈ ({10, 756, 757, 3160} : Finset ℕ), Nat.Coprime (Nat.centralBinom n) 105",
        title_en: "Check in Lean: C(2n, n) is coprime to 105 for n = 10, 756, 757 and 3160",
        title_zh: "用 Lean 检验：n = 10、756、757、3160 时 C(2n, n) 与 105 互素",
        about_en: "Known (OEIS A030979). A warm-up: the numbers are large, so the proof needs an efficient computation or Kummer's criterion.",
        about_zh: "已知（OEIS A030979）。热身题：数字很大，证明需要高效的计算或 Kummer 判别法。" },
      { id: "erdos-376-kummer", kind: "milestone", statement: "Mile_Erdos376_Kummer", difficulty: 500, lean: "∀ p n : ℕ, p.Prime → 2 < p → (¬ p ∣ Nat.centralBinom n ↔ ∀ d ∈ Nat.digits p n, 2 * d < p)",
        title_en: "Prove in Lean: an odd prime p divides C(2n, n) unless every base-p digit of n is below p/2",
        title_zh: "用 Lean 证明：奇素数 p 不整除 C(2n, n) 当且仅当 n 的 p 进制每位都小于 p/2",
        about_en: "Known (Kummer's theorem: adding n + n in base p has no carry). This is the bridge from the binomial coefficient to digits.",
        about_zh: "已知（Kummer 定理：在 p 进制下做 n + n 没有进位）。这是从二项式系数到数字问题的桥梁。" },
      { id: "erdos-376-two-primes", kind: "milestone", statement: "Mile_Erdos376_TwoPrimes", difficulty: 700, lean: "{n : ℕ | Nat.Coprime (Nat.centralBinom n) 15}.Infinite",
        title_en: "Prove in Lean: infinitely many n with C(2n, n) coprime to 15",
        title_zh: "用 Lean 证明：有无穷多个 n 使 C(2n, n) 与 15 互素",
        about_en: "Known: the two-prime case of Erdős, Graham, Ruzsa and Straus (1975), for 3 and 5. A real formalisation task.",
        about_zh: "已知：Erdős、Graham、Ruzsa、Straus（1975）两个素数情形中 3 与 5 的特例。一个真正的形式化任务。" },
    ],
  },
  {
    erdos: 364, id: "erdos-364", statement: "Summit_Erdos364", lean: "¬ ∃ n : ℕ, 0 < n ∧ Powerful n ∧ Powerful (n + 1) ∧ Powerful (n + 2)",
    title_en: "Erdős #364: no three consecutive powerful numbers",
    title_zh: "Erdős #364：不存在三个连续的 powerful 数",
    pitch_en: "Pairs of consecutive powerful numbers are plentiful (8, 9); a triple would contradict the abc conjecture's spirit.",
    pitch_zh: "连续两个 powerful 数很常见（8、9）；连续三个则违背 abc 猜想的精神。",
    about_en: "Open (also conjectured by Mollin and Walsh). A number is powerful if every prime factor appears at least squared. The abc conjecture implies there are only finitely many triples; none exists below 7.38 × 10^28 (OEIS A076445). Four in a row is impossible, since one of them is 2 mod 4. Source: erdosproblems.com/364.",
    about_zh: "未解决（Mollin 与 Walsh 也提出过这一猜想）。若一个数的每个素因子都至少出现平方次，就称它为 powerful 数。abc 猜想蕴含这样的三元组只有有限个；7.38 × 10^28 以下没有（OEIS A076445）。连续四个不可能，因为其中一个模 4 余 2。来源：erdosproblems.com/364。",
    kids: [
      { id: "erdos-364-no-four", kind: "milestone", statement: "Mile_Erdos364_NoFour", difficulty: 150, lean: "¬ ∃ n : ℕ, 0 < n ∧ Powerful n ∧ Powerful (n + 1) ∧ Powerful (n + 2) ∧ Powerful (n + 3)",
        title_en: "Prove in Lean: no four consecutive powerful numbers",
        title_zh: "用 Lean 证明：不存在四个连续的 powerful 数",
        about_en: "Known and short: among four consecutive numbers one is 2 mod 4, so 2 divides it but 4 does not.",
        about_zh: "已知且简短：连续四个数中有一个模 4 余 2，它能被 2 整除但不能被 4 整除。" },
      { id: "erdos-364-up-to-1000", kind: "milestone", statement: "Mile_Erdos364_UpTo1000", difficulty: 300, lean: "∀ n : ℕ, 0 < n → n < 1000 → ¬ (Powerful n ∧ Powerful (n + 1) ∧ Powerful (n + 2))",
        title_en: "Check in Lean: no three consecutive powerful numbers start below 1000",
        title_zh: "用 Lean 检验：1000 以下没有三个连续 powerful 数的起点",
        about_en: "Known by computation (far beyond). The task is a Lean proof: for each n, exhibit a prime that divides one of the three exactly once.",
        about_zh: "计算已知（远超此范围）。任务是写出 Lean 证明：对每个 n，指出一个恰好整除三者之一一次的素数。" },
      { id: "erdos-364-pairs", kind: "milestone", statement: "Mile_Erdos364_Pairs", difficulty: 450, lean: "∀ N : ℕ, ∃ n : ℕ, N < n ∧ Powerful n ∧ Powerful (n + 1)",
        title_en: "Prove in Lean: infinitely many pairs of consecutive powerful numbers",
        title_zh: "用 Lean 证明：有无穷多对连续的 powerful 数",
        about_en: "Known (Mahler): the Pell equation x² = 8y² + 1 has infinitely many solutions, and 8y², x² are both powerful.",
        about_zh: "已知（Mahler）：Pell 方程 x² = 8y² + 1 有无穷多解，而 8y² 和 x² 都是 powerful 数。" },
    ],
  },
  {
    erdos: 850, id: "erdos-850", statement: "Summit_Erdos850", lean: `∃ x y : ℕ, x ≠ y ∧ ${W2} ∧ (x + 2).primeFactors = (y + 2).primeFactors`,
    title_en: "Erdős #850, the Erdős–Woods question: two numbers whose three successors share prime factors",
    title_zh: "Erdős #850，Erdős–Woods 问题：两个数及其后继三项的素因子分别相同",
    pitch_en: "For two consecutive numbers there are examples like 75, 1215; for three, nobody has found one or ruled it out.",
    pitch_zh: "连续两项已有例子（如 75 与 1215）；连续三项，既没人找到例子，也没人证明不存在。",
    about_en: "Open (a yes/no question: an example settles it, and so does a proof that none exists; a Lean refutation counts). For x, x+1 there is the family x = 2(2^r − 1), y = x(x + 2), and Makowski's pair 75, 1215. Shorey and Tijdeman showed a strong form of the abc conjecture rules out three. Source: erdosproblems.com/850.",
    about_zh: "未解决（是非题：找到例子能解决它，证明不存在也能；用 Lean 推翻同样计分）。两项的情形有族 x = 2(2^r − 1)、y = x(x + 2)，以及 Makowski 的 75 与 1215。Shorey 与 Tijdeman 证明了 abc 猜想的某个强形式排除三项的情形。来源：erdosproblems.com/850。",
    kids: [
      { id: "erdos-850-makowski", kind: "milestone", statement: "Mile_Erdos850_Makowski", difficulty: 100, lean: "Nat.primeFactors 75 = Nat.primeFactors 1215 ∧ Nat.primeFactors 76 = Nat.primeFactors 1216",
        title_en: "Check in Lean: Makowski's pair 75, 1215 (and 76, 1216) share prime factors",
        title_zh: "用 Lean 检验：Makowski 的 75 与 1215（以及 76 与 1216）素因子相同",
        about_en: "Known: 75 = 3·5², 1215 = 3⁵·5, 76 = 2²·19, 1216 = 2⁶·19. A first task. A Lean proof already exists elsewhere (Ren, 2026); this board has none yet.",
        about_zh: "已知：75 = 3·5²，1215 = 3⁵·5，76 = 2²·19，1216 = 2⁶·19。入门题。别处已有 Lean 证明（Ren，2026），本站还没有。" },
      { id: "erdos-850-two-family", kind: "milestone", statement: "Mile_Erdos850_TwoFamily", difficulty: 300, lean: `∀ N : ℕ, ∃ x y : ℕ, N < x ∧ x ≠ y ∧ ${W2}`,
        title_en: "Prove in Lean: infinitely many pairs x ≠ y where x, y and x+1, y+1 share prime factors",
        title_zh: "用 Lean 证明：有无穷多对 x ≠ y，使 x 与 y、x+1 与 y+1 的素因子分别相同",
        about_en: "Known: x = 2(2^r − 1), y = x(x + 2), so y + 1 = (x + 1)².",
        about_zh: "已知：x = 2(2^r − 1)，y = x(x + 2)，于是 y + 1 = (x + 1)²。" },
      { id: "erdos-850-no-small", kind: "milestone", statement: "Mile_Erdos850_NoSmall", difficulty: 400, lean: "∀ x y : ℕ, x < y → y ≤ 1000 → ¬ (x.primeFactors = y.primeFactors ∧ (x + 1).primeFactors = (y + 1).primeFactors ∧ (x + 2).primeFactors = (y + 2).primeFactors)",
        title_en: "Check in Lean: no three-step example with y ≤ 1000",
        title_zh: "用 Lean 检验：y ≤ 1000 时没有三项的例子",
        about_en: "Known by computation (our own search finds none with y ≤ 20000). The task is a Lean proof that rules out every pair.",
        about_zh: "计算已知（我们自己的搜索在 y ≤ 20000 内没有找到）。任务是写出排除所有数对的 Lean 证明。" },
    ],
  },
  {
    erdos: 389, id: "erdos-389", statement: "Summit_Erdos389", lean: `∀ n : ℕ, 1 ≤ n → ${C389}`,
    title_en: "Erdős #389: for every n, n(n+1)⋯(n+k−1) divides (n+k)⋯(n+2k−1) for some k",
    title_zh: "Erdős #389：对每个 n，存在 k 使 n(n+1)⋯(n+k−1) 整除 (n+k)⋯(n+2k−1)",
    pitch_en: "A divisibility race between two blocks of consecutive numbers, where the smallest k jumps wildly (n = 6 needs k = 2475).",
    pitch_zh: "两段连续整数乘积之间的整除比赛，最小的 k 跳动剧烈（n = 6 需要 k = 2475）。",
    about_en: "Open (asked by Erdős and Straus). For n = 2, k = 5 works; for n = 3, k = 4. Bhavik Mehta computed the minimal k for n ≤ 18 (OEIS A375071); our own computation gives 1, 5, 4, 207, 206, 2475, 984 for n = 1 to 7. Source: erdosproblems.com/389.",
    about_zh: "未解决（Erdős 与 Straus 提出）。n = 2 时 k = 5 可行；n = 3 时 k = 4。Bhavik Mehta 计算了 n ≤ 18 的最小 k（OEIS A375071）；我们自己的计算给出 n = 1 到 7 时为 1、5、4、207、206、2475、984。来源：erdosproblems.com/389。",
    kids: [
      { id: "erdos-389-up-to-5", kind: "milestone", statement: "Mile_Erdos389_UpTo5", difficulty: 300, lean: `∀ n : ℕ, 1 ≤ n → n ≤ 5 → ${C389}`,
        title_en: "Check in Lean: the statement holds for n = 1 to 5",
        title_zh: "用 Lean 检验：n = 1 到 5 时命题成立",
        about_en: "Known: k = 1, 5, 4, 207, 206 work. The products have hundreds of factors, so the Lean proof needs a computation the kernel can afford.",
        about_zh: "已知：k = 1、5、4、207、206 可行。乘积有几百个因子，所以 Lean 证明需要内核负担得起的计算方式。" },
    ],
  },
  {
    erdos: 373, id: "erdos-373", statement: "Summit_Erdos373", lean: `{p : ℕ × List ℕ | ${F373}}.Finite`,
    title_en: "Erdős #373: n! = a₁!a₂!⋯aₖ! with n − 1 > a₁ ≥ ⋯ ≥ aₖ ≥ 2 has only finitely many solutions",
    title_zh: "Erdős #373：n! = a₁!a₂!⋯aₖ!（n − 1 > a₁ ≥ ⋯ ≥ aₖ ≥ 2）只有有限个解",
    pitch_en: "Factorials that factor into factorials: 10! = 6!·7! and 16! = 14!·5!·2! are the only big surprises known.",
    pitch_zh: "能拆成阶乘之积的阶乘：10! = 6!·7! 和 16! = 14!·5!·2! 是已知仅有的大惊喜。",
    about_en: "Open. Hickerson conjectured the only solutions are 9! = 7!3!3!2!, 10! = 7!6!, 10! = 7!5!3! and 16! = 14!5!2!. Luca proved finiteness assuming the abc conjecture. For two factorials, there is no other solution with n ≤ 10^3000 (Habsieger). Source: erdosproblems.com/373.",
    about_zh: "未解决。Hickerson 猜想只有 9! = 7!3!3!2!、10! = 7!6!、10! = 7!5!3!、16! = 14!5!2! 这几个解。Luca 在 abc 猜想成立的前提下证明了有限性。对两个阶乘的情形，n ≤ 10^3000 内没有其他解（Habsieger）。来源：erdosproblems.com/373。",
    kids: [
      { id: "erdos-373-known", kind: "milestone", statement: "Mile_Erdos373_Known", difficulty: 100, lean: `∀ p ∈ ({(9, [7, 3, 3, 2]), (10, [7, 6]), (10, [7, 5, 3]), (16, [14, 5, 2])} : Finset (ℕ × List ℕ)), ${F373}`,
        title_en: "Check in Lean: Hickerson's four solutions really are solutions",
        title_zh: "用 Lean 检验：Hickerson 的四个解确实是解",
        about_en: "Known. A first task: four factorial identities, plus the side conditions.",
        about_zh: "已知。入门题：四个阶乘等式，加上附带条件。" },
      { id: "erdos-373-two-up-to-100", kind: "milestone", statement: "Mile_Erdos373_TwoUpTo100", difficulty: 400, lean: "∀ n a b : ℕ, n ≤ 100 → 2 ≤ b → b ≤ a → a + 1 < n → n.factorial = a.factorial * b.factorial → n = 10 ∧ a = 7 ∧ b = 6",
        title_en: "Check in Lean: for n ≤ 100, 10! = 7!·6! is the only n! = a!·b! with n − 1 > a ≥ b ≥ 2",
        title_zh: "用 Lean 检验：n ≤ 100 时，满足 n − 1 > a ≥ b ≥ 2 的 n! = a!·b! 只有 10! = 7!·6!",
        about_en: "Known by computation (to 10^3000). The task is a Lean proof; a bound on a in terms of n keeps the search small.",
        about_zh: "计算已知（到 10^3000）。任务是写出 Lean 证明；用 n 约束 a 可以让搜索保持很小。" },
      { id: "erdos-373-two", kind: "program", statement: "Open_Erdos373_Two", difficulty: 900, lean: "∀ n a b : ℕ, 2 ≤ b → b ≤ a → a + 1 < n → n.factorial = a.factorial * b.factorial → n = 10 ∧ a = 7 ∧ b = 6",
        title_en: "Open (Surányi): 10! = 7!·6! is the only n! = a!·b! with n − 1 > a ≥ b ≥ 2",
        title_zh: "未解决（Surányi）：满足 n − 1 > a ≥ b ≥ 2 的 n! = a!·b! 只有 10! = 7!·6!",
        about_en: "Unsolved: Surányi's conjecture, the two-factorial case of Erdős #373. Erdős proved a ≥ n − 5 log log n for any such solution.",
        about_zh: "未解决：Surányi 猜想，即 Erdős #373 的两个阶乘情形。Erdős 证明了任何这样的解都满足 a ≥ n − 5 log log n。" },
    ],
  },
];

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("tools/gen_erdos.mjs")) {
  const lean = [
    "import OpenConjecture.Erdos.Basic",
    "",
    "/-!",
    "# The Erdős board: open problems, open sub-problems and checkable milestones",
    "",
    "Generated by `tools/gen_erdos.mjs`. This file is protected: pull requests may not change it.",
    "`Summit_` and `Open_` statements are unsolved. `Mile_` statements are known or computer-checkable special",
    "cases that nobody has proved in Lean here yet. Statements follow google-deepmind/formal-conjectures (Apache-2.0).",
    "-/",
    "",
    "namespace OpenConjecture.Erdos",
    "",
  ];
  for (const p of problems) {
    lean.push(`/-- Erdős #${p.erdos}. Unsolved. https://www.erdosproblems.com/${p.erdos} -/`, `def ${p.statement} : Prop := ${p.lean}`, "");
    for (const k of p.kids)
      lean.push(`/-- ${k.kind === "program" ? "Unsolved" : "Milestone (known, not yet proved here)"}, under Erdős #${p.erdos}. -/`, `def ${k.statement} : Prop := ${k.lean}`, "");
  }
  lean.push("end OpenConjecture.Erdos", "");
  writeFileSync("OpenConjecture/Erdos/Lemmas.lean", lean.join("\n"));

  mkdirSync("records/erdos", { recursive: true });
  let created = 0;
  const put = (rec) => {
    const f = `records/erdos/${rec.id}.json`;
    if (existsSync(f)) return;
    writeFileSync(f, JSON.stringify(rec, null, 2) + "\n");
    created++;
  };
  for (const p of problems) {
    put({ id: p.id, kind: "summit", statement: p.statement, difficulty: 1000, title_en: p.title_en, title_zh: p.title_zh,
      erdos: p.erdos, pitch_en: p.pitch_en, pitch_zh: p.pitch_zh, about_en: p.about_en, about_zh: p.about_zh, status: "open" });
    for (const k of p.kids)
      put({ id: k.id, kind: k.kind, parent: p.id, statement: k.statement, difficulty: k.difficulty, title_en: k.title_en, title_zh: k.title_zh,
        about_en: k.about_en, about_zh: k.about_zh, status: "open" });
  }
  const n = problems.reduce((s, p) => s + 1 + p.kids.length, 0);
  console.log(`${problems.length} Erdős problems, ${n} statements, ${created} new records`);
}
