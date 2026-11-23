import Mathlib

/-!
# The Collatz conjecture

Take any positive whole number. If it is even, halve it; if it is odd, triple it and add one.
The conjecture says you always end up at 1. It is open.
-/

namespace OpenConjecture.Collatz

/-- One step of the Collatz map. -/
def step (n : ℕ) : ℕ := if n % 2 = 0 then n / 2 else 3 * n + 1

/-- `n` reaches 1 after some number of Collatz steps. -/
def Reaches (n : ℕ) : Prop := ∃ k : ℕ, step^[k] n = 1

/-- The Collatz conjecture: every positive whole number reaches 1. **Open.** -/
def Conjecture : Prop := ∀ n : ℕ, 0 < n → Reaches n

end OpenConjecture.Collatz
