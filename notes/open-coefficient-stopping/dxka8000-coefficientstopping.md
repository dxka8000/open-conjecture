# Terras's coefficient stopping time conjecture: what is known and where it is stuck
Record: open-coefficient-stopping
Author: @dxka8000
Date: 2026-11-24
Model: Claude Opus 5.5
Tool: Claude Code

## Problem in plain words

Use the shortcut Collatz map T(m) = m/2 for even m and T(m) = (3m+1)/2 for odd m. After k steps from n, of which a are odd steps, one has exactly

    2^k * T^k(n) = 3^a * n + c_k(n),   with c_k(n) >= 0,

where c_k(n) is built up by c_0 = 0, c_(j+1) = c_j after an even step and c_(j+1) = 3 c_j + 2^j after an odd step. So T^k(n) is "n times the coefficient 3^a/2^k, plus a small positive correction".

Two stopping times (names as in Lagarias's annotated bibliography):

- the stopping time sigma(n): the first k >= 1 with T^k(n) < n;
- the coefficient stopping time kappa(n): the first k >= 1 with 3^a < 2^k, that is, the first time the coefficient drops below 1.

Because the correction is never negative, T^k(n) < n forces 3^a < 2^k, so kappa(n) <= sigma(n) always. Terras's Coefficient Stopping Time Conjecture says the converse: for every n >= 2, sigma(n) = kappa(n). In words: the number never "lags behind" its coefficient; as soon as the multiplier 3^a/2^k is below 1, the number itself is already below where it started.

How the Lean statement `Open_CoefficientStopping` matches this. It says: for all n >= 2 and all k, if 3^(number of odd steps among the first k) < 2^k then some j <= k has T^j(n) < n. Applying it at k = kappa(n) gives sigma(n) <= kappa(n); conversely, if sigma(n) <= kappa(n) then every k with 3^a < 2^k satisfies k >= kappa(n) >= sigma(n), so j = sigma(n) works. So the Lean statement is exactly "sigma(n) <= kappa(n) for every n >= 2 with kappa(n) finite". Two remarks:

- It is vacuous for any n whose coefficient never drops below 1 (kappa(n) infinite). So it does not by itself say that every n has finite stopping time, and it does not imply the full Collatz conjecture.
- An equivalent form: for every n >= 2 with kappa(n) = k finite and a odd steps in the first k, T^k(n) < n, that is, c_k(n) < (2^k - 3^a) * n.

## Known results

- R. Terras (1976), "A stopping time problem on the positive integers", Acta Arithmetica 30, 241-252. https://doi.org/10.4064/aa-30-3-241-252 Studies the stopping time, introduces the coefficient stopping time, shows that the integers with stopping time k form a union of residue classes mod 2^k minus finitely many exceptions, that finite stopping time holds on a set of natural density one, and formulates the Coefficient Stopping Time Conjecture. According to Lagarias's annotation he proves it whenever kappa(n) is at most 2593 (the bibliography states the bound as "<= 2593" in the Terras entry and "< 2593" in the Garner entry).
- R. Terras (1979), "On the existence of a density", Acta Arithmetica 35, 101-102. https://doi.org/10.4064/aa-35-1-101-102 Supplies further details of the 1976 density-one argument.
- C. J. Everett (1977), "Iteration of the number-theoretic function f(2n) = n, f(2n + 1) = 3n + 2", Advances in Mathematics 25, 42-45. https://doi.org/10.1016/0001-8708(77)90087-1 Independently proves that the set of n with some iterate T^k(n) < n has natural density one.
- L. E. Garner (1981), "On the Collatz 3n+1 algorithm", Proceedings of the American Mathematical Society 82, 19-22. https://doi.org/10.1090/S0002-9939-1981-0603593-2 Using Terras's method, extends the verified range of the conjecture to kappa(n) < 105,000, using the continued fraction expansion of log_2 3 and the then-known verification of the 3x+1 conjecture for n < 2.0 x 10^9 (as summarized by Lagarias; the annotation's displayed inequality reads "kappa(n) <= sigma(n)", which is the trivial direction, while the surrounding text says it extends Terras's verification of the conjecture).
- J. C. Lagarias (2003, revised 2011), "The 3x+1 problem: An annotated bibliography (1963-1999)", arXiv. https://arxiv.org/abs/math/0309224 The source for the summaries above (entries for Terras 1976, Terras 1979, Everett 1977 and Garner 1981), including the definitions of sigma and kappa and the statement of the conjecture.
- T. Tao (2019), "Almost all orbits of the Collatz map attain almost bounded values", arXiv. https://arxiv.org/abs/1909.03562 Shows that for any f tending to infinity, the orbit minimum of N is at most f(N) for almost all N in logarithmic density. Not about kappa, but it is a strong "almost all" result on orbit descent and illustrates the limits of density methods for an "every n" statement like this one.

Elementary facts (proofs are short and given here; they are not taken from the sources above):

1. The conjecture implies that the only cycle of T on positive integers is {1, 2}. Proof: let n >= 2 be the smallest element of a cycle of length k with a odd steps. A cycle other than {1, 2} must contain an odd step (even steps strictly decrease), so c_k(n) >= 1 and 2^k n = 3^a n + c_k(n) > 3^a n, so 3^a < 2^k. The conjecture then gives some T^j(n) < n with j <= k, contradicting minimality of n in its cycle. So this record is at least as hard as the "no nontrivial cycles" summit.
2. At k = kappa(n) the last step is even (an odd step would raise the coefficient), so 2^(k-1) <= 3^a < 2^k.
3. A crude bound on the correction: if p_0 < p_1 < ... < p_(a-1) are the odd positions before kappa(n), then c_k(n) = sum over r of 3^(a-1-r) * 2^(p_r), and minimality of kappa gives 2^(p_r) <= 3^r, hence c_k(n) <= a * 3^(a-1). Therefore any counterexample n with kappa(n) = k must satisfy n * (2^k - 3^a) <= a * 3^(a-1). This is the shape of the Terras/Garner argument: bound the correction above and 2^k - 3^a below.
4. This crude bound alone is not enough even for small n. A script by the author (plain Python, exact integer arithmetic) checked all 2 <= n < 10^6: sigma(n) = kappa(n) for each of them, the identity in the first section holds, and the largest kappa(n) in that range is 176, at n = 626331. But the crude inequality n * (2^k - 3^a) > a * 3^(a-1) fails at n = 47, where kappa = 54, a = 34, 2^54 - 3^34 = 1337216809815415, and the left side is about 6.28 x 10^16 against a right side of about 1.89 x 10^17. The true correction there is c_54(47) = 44834791551842521, which is below 6.28 x 10^16, and indeed T^54(47) = 46 < 47. So any proof must use the actual correction, not the worst case.

## Attack routes

1. Finite verification by Diophantine approximation (Terras 1976, Garner 1981). For a fixed range of k, bound 2^k - 3^a from below using the continued fraction of log_2 3, bound the correction from above, and conclude that any counterexample with that kappa is a small number, which is then checked directly. This proves the conjecture for kappa(n) below an explicit bound.
2. Residue-class structure (Terras 1976). Whether kappa(n) = k, and the value of c_k(n), depend only on the first k parity bits of n, that is, on n mod 2^k. For each such parity vector the condition c_k < (2^k - 3^a) n holds for all large n in the class, so counterexamples are confined to the finitely many small members of each class. The conjecture says these finite exceptional sets are all empty.
3. Density and probabilistic methods (Terras, Everett, Tao). These show that typical n behave as the heuristic predicts (finite stopping time on a density-one set; orbit minima almost bounded for almost all N). One could hope for a density-one version of this conjecture by the same means.
4. Via the cycle problem. Fact 1 shows a proof of this conjecture would rule out nontrivial cycles. In the other direction, cycle-exclusion techniques work with the same quantity 2^k - 3^a and the same correction sum, so they are a natural source of lemmas.

## Where each route is stuck

1. Finite verification: each run of the method handles kappa(n) up to a fixed bound only. For all k one needs a lower bound on 2^k - 3^a valid for every k (an effective irrationality-measure type estimate for log_2 3) together with a way to dispose of all counterexample candidates, whose size bound grows with k. With a polynomial-in-k lower bound one gets "a counterexample n is at most polynomial in kappa(n)", but nothing currently rules out a number whose coefficient stopping time is that large relative to the number itself.
2. Residue classes: there are infinitely many parity vectors, and for each one the exceptional small members must be checked; there is no known uniform argument that they are empty. Fact 4 shows that the worst-case bound on the correction is too weak even at n = 47, so a uniform argument must exploit cancellation or structure in the actual correction sum.
3. Density methods: they say nothing about individual numbers. An exceptional set of density zero (even logarithmic density zero) is not excluded, and the conjecture is an "every n >= 2" statement.
4. Cycles: the implication goes only one way; ruling out cycles would not prove this conjecture, and nontrivial cycles are themselves not ruled out.

## Candidate splits

None of the following has been compiled; they are sketches for a thinker, with names chosen to fit the Proposals format. Write `Tf m := if m % 2 = 0 then m / 2 else (3 * m + 1) / 2` and `oddc n k := ((Finset.range k).filter (fun i => Tf^[i] n % 2 = 1)).card` (both would have to be inlined, since a step file may contain exactly one def).

Split 1 (Diophantine ingredient plus a "long kappa" statement), for some explicit constant D:

    -- Step_CS_LogGap : no dynamics, a statement purely about powers of 2 and 3
    ∀ k a : ℕ, 2 ^ (k - 1) ≤ 3 ^ a → 3 ^ a < 2 ^ k → 3 ^ a ≤ (2 ^ k - 3 ^ a) * (k + 1) ^ D

    -- Step_CS_LongKappa : the conjecture only for n that are small compared with kappa(n)
    ∀ n k : ℕ, 2 ≤ n → 3 ^ oddc n k < 2 ^ k → (∀ i, 1 ≤ i → i < k → 2 ^ i ≤ 3 ^ oddc n i) →
      n ≤ k * (k + 1) ^ D → Tf^[k] n < n

Why they imply the parent: by Fact 3, c_k(n) <= a * 3^(a-1) <= k * 3^a, and with Step_CS_LogGap this is at most k * (k+1)^D * (2^k - 3^a); so for n > k * (k+1)^D one gets c_k(n) < (2^k - 3^a) * n, i.e. T^k(n) < n, and the remaining n are covered by Step_CS_LongKappa. Caveats a thinker must address: (a) Step_CS_LogGap is a number-theory statement whose truth for some D is what lower bounds for linear forms in logarithms are designed to give, but this note does not supply a verified constant or reference, so the proposer must; (b) a reviewer may see Step_CS_LongKappa as most of the difficulty of the parent; the argument for it being genuinely smaller is that for each k it concerns only finitely many n (at most k * (k+1)^D of them), which is exactly the finite check Terras and Garner perform, so it is the "uniform in k" part isolated cleanly.

Split 2 (single step, density version), as a weaker target rather than a split: "the set of n >= 2 with kappa(n) finite and sigma(n) > kappa(n) has natural density zero". This is not a split of this record (it does not imply it) and is listed only as a natural companion record.

Things to avoid: splitting by ranges of kappa or by residue classes mod a power of 2 (each piece is as hard as the whole), and the strengthened single step "n * (2^k - 3^a) > a * 3^(a-1) at k = kappa(n)", which is false at n = 47 (Fact 4).

## Open questions

- Does the Collatz conjecture imply the Coefficient Stopping Time Conjecture? Fact 1 gives an implication from this conjecture to "no nontrivial cycles"; the author knows of no implication in the other direction, and knowing all orbits reach 1 does not obviously control when the first descent happens.
- Is there an explicit D making Step_CS_LogGap true, with a proof short enough to formalize in Lean/Mathlib? Even a statement for k below a large explicit bound, proved by the continued fraction of log_2 3, would be a useful building block.
- For large k, how small can a member of a kappa = k residue class be, relative to its correction c_k? Fact 4 suggests the gap between the true correction and the crude bound a * 3^(a-1) is large in practice; a structural lower bound on that gap would sharpen route 1.
- Is there a density-one version (Split 2) provable by the Terras/Everett or Tao methods?
