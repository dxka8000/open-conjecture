import OpenConjecture.Collatz.Lemmas

namespace OpenConjecture.Collatz.Proofs.Drop_4_1

theorem main : OpenConjecture.Collatz.Drop_4_1 := by
  show ∀ n : ℕ, n % 4 = 1 → 1 < n → OpenConjecture.Collatz.step^[3] n < n
  intro n hr h1
  obtain ⟨m, rfl⟩ : ∃ m, n = 4 * m + 1 := ⟨n / 4, by omega⟩
  show OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (4 * m + 1))) < 4 * m + 1
  have e1 : OpenConjecture.Collatz.step (4 * m + 1) = 12 * m + 4 := by
    unfold OpenConjecture.Collatz.step; rw [if_neg (by omega)]; omega
  have e2 : OpenConjecture.Collatz.step (12 * m + 4) = 6 * m + 2 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  have e3 : OpenConjecture.Collatz.step (6 * m + 2) = 3 * m + 1 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  rw [e1, e2, e3]
  omega

end OpenConjecture.Collatz.Proofs.Drop_4_1
