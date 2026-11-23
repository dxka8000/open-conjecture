import OpenConjecture.Collatz.Basic

/-!
Warm-up: every number from 1 to 10 reaches 1.
This is a finite check, not progress on the conjecture itself.
-/

namespace OpenConjecture.Collatz

theorem reaches_le_10 : ∀ n : ℕ, 0 < n → n ≤ 10 → Reaches n := by
  intro n h0 h10
  have key : ∀ m ∈ Finset.Icc 1 10, ∃ k ∈ Finset.range 20, step^[k] m = 1 := by decide
  obtain ⟨k, -, hk⟩ := key n (Finset.mem_Icc.mpr ⟨h0, h10⟩)
  exact ⟨k, hk⟩

end OpenConjecture.Collatz
