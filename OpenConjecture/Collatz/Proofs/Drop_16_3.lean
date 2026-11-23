import OpenConjecture.Collatz.Lemmas

namespace OpenConjecture.Collatz.Proofs.Drop_16_3

theorem main : OpenConjecture.Collatz.Drop_16_3 := by
  show ∀ n : ℕ, n % 16 = 3 → 1 < n → OpenConjecture.Collatz.step^[6] n < n
  intro n hr h1
  obtain ⟨m, rfl⟩ : ∃ m, n = 16 * m + 3 := ⟨n / 16, by omega⟩
  show OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (16 * m + 3)))))) < 16 * m + 3
  have e1 : OpenConjecture.Collatz.step (16 * m + 3) = 48 * m + 10 := by
    unfold OpenConjecture.Collatz.step; rw [if_neg (by omega)]; omega
  have e2 : OpenConjecture.Collatz.step (48 * m + 10) = 24 * m + 5 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  have e3 : OpenConjecture.Collatz.step (24 * m + 5) = 72 * m + 16 := by
    unfold OpenConjecture.Collatz.step; rw [if_neg (by omega)]; omega
  have e4 : OpenConjecture.Collatz.step (72 * m + 16) = 36 * m + 8 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  have e5 : OpenConjecture.Collatz.step (36 * m + 8) = 18 * m + 4 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  have e6 : OpenConjecture.Collatz.step (18 * m + 4) = 9 * m + 2 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  rw [e1, e2, e3, e4, e5, e6]
  omega

end OpenConjecture.Collatz.Proofs.Drop_16_3
