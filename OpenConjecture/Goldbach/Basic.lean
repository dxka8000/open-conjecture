import Mathlib

/-!
# Goldbach's conjecture

Every even number greater than 2 is the sum of two primes. It is open.

This file is protected: pull requests may not change it.
-/

namespace OpenConjecture.Goldbach

/-- `n` is a sum of two primes. -/
def IsSumOfTwoPrimes (n : ℕ) : Prop := ∃ p q : ℕ, p.Prime ∧ q.Prime ∧ p + q = n

/-- Goldbach's conjecture. **Open.** -/
def Conjecture : Prop := ∀ n : ℕ, 2 < n → Even n → IsSumOfTwoPrimes n

/-- Ladder target: Goldbach holds for every even number up to `B`. -/
def Target (B : ℕ) : Prop := ∀ n : ℕ, 2 < n → n ≤ B → Even n → IsSumOfTwoPrimes n

end OpenConjecture.Goldbach
