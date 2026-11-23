import OpenConjecture.Collatz.Lemmas

namespace OpenConjecture.Collatz.Proofs.Drop_32_11

theorem main : OpenConjecture.Collatz.Drop_32_11 := by
  show ∀ n : ℕ, n % 32 = 11 → 1 < n → OpenConjecture.Collatz.step^[8] n < n
  intro n hr h1
  obtain ⟨m, rfl⟩ : ∃ m, n = 32 * m + 11 := ⟨n / 32, by omega⟩
  show OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (32 * m + 11)))))))) < 32 * m + 11
  have e1 : OpenConjecture.Collatz.step (32 * m + 11) = 96 * m + 34 := by
    unfold OpenConjecture.Collatz.step; rw [if_neg (by omega)]; omega
  have e2 : OpenConjecture.Collatz.step (96 * m + 34) = 48 * m + 17 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  have e3 : OpenConjecture.Collatz.step (48 * m + 17) = 144 * m + 52 := by
    unfold OpenConjecture.Collatz.step; rw [if_neg (by omega)]; omega
  have e4 : OpenConjecture.Collatz.step (144 * m + 52) = 72 * m + 26 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  have e5 : OpenConjecture.Collatz.step (72 * m + 26) = 36 * m + 13 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  have e6 : OpenConjecture.Collatz.step (36 * m + 13) = 108 * m + 40 := by
    unfold OpenConjecture.Collatz.step; rw [if_neg (by omega)]; omega
  have e7 : OpenConjecture.Collatz.step (108 * m + 40) = 54 * m + 20 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  have e8 : OpenConjecture.Collatz.step (54 * m + 20) = 27 * m + 10 := by
    unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
  rw [e1, e2, e3, e4, e5, e6, e7, e8]
  omega

end OpenConjecture.Collatz.Proofs.Drop_32_11
