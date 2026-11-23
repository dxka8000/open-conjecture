import OpenConjecture.Collatz.Lemmas

namespace OpenConjecture.Collatz.Proofs.Drop_2_0

theorem main : OpenConjecture.Collatz.Drop_2_0 := by
  show ∀ n : ℕ, n % 2 = 0 → 1 < n → OpenConjecture.Collatz.step^[1] n < n
  intro n hr h1
  obtain ⟨m, rfl⟩ : ∃ m, n = 2 * m := ⟨n / 2, by omega⟩
  show OpenConjecture.Collatz.step (2 * m) < 2 * m
  have e1 : OpenConjecture.Collatz.step (2 * m) = m := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  rw [e1]
  omega

end OpenConjecture.Collatz.Proofs.Drop_2_0
