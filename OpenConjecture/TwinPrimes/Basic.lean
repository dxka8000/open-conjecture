import Mathlib

/-!
# The twin prime conjecture

There are infinitely many primes `p` such that `p + 2` is also prime. It is open.

This file is protected: pull requests may not change it.
-/

namespace OpenConjecture.TwinPrimes

/-- The twin prime conjecture. **Open.** -/
def Conjecture : Prop := ∀ N : ℕ, ∃ p : ℕ, N < p ∧ p.Prime ∧ (p + 2).Prime

/-- Ladder target: there is a twin prime pair above `B`. -/
def Target (B : ℕ) : Prop := ∃ p : ℕ, B < p ∧ p.Prime ∧ (p + 2).Prime

end OpenConjecture.TwinPrimes
