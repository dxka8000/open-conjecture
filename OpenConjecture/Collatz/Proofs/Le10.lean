import OpenConjecture.Collatz.Basic

namespace OpenConjecture.Collatz

theorem reaches_le_10 : Target 10 := by
  show ∀ n : ℕ, 0 < n → n ≤ 10 → Reaches n
  intro n h0 h10
  have key : ∀ m ∈ Finset.Icc 1 10, ∃ k ∈ Finset.range 20, step^[k] m = 1 := by decide
  obtain ⟨k, -, hk⟩ := key n (Finset.mem_Icc.mpr ⟨h0, h10⟩)
  exact ⟨k, hk⟩

end OpenConjecture.Collatz
