import OpenConjecture.Collatz.Lemmas

-- In-house split: the two steps together imply the parent. The steps themselves are open.

namespace OpenConjecture.Collatz.Splits.Split_Open_DensityOne

theorem count_split (N : ℕ) : Set.ncard {n : ℕ | n < N ∧ Reaches n} =
    Set.ncard {n : ℕ | n < N ∧ n % 3 ≠ 0 ∧ Reaches n} + Set.ncard {n : ℕ | n < N ∧ n % 3 = 0 ∧ Reaches n} := by
  have hU : {n : ℕ | n < N ∧ Reaches n} =
      {n : ℕ | n < N ∧ n % 3 ≠ 0 ∧ Reaches n} ∪ {n : ℕ | n < N ∧ n % 3 = 0 ∧ Reaches n} := by
    ext n
    simp only [Set.mem_union, Set.mem_setOf_eq]
    constructor
    · rintro ⟨h1, h2⟩
      by_cases h : n % 3 = 0
      · exact Or.inr ⟨h1, h, h2⟩
      · exact Or.inl ⟨h1, h, h2⟩
    · rintro (⟨h1, _, h2⟩ | ⟨h1, _, h2⟩)
      · exact ⟨h1, h2⟩
      · exact ⟨h1, h2⟩
  have hD : Disjoint {n : ℕ | n < N ∧ n % 3 ≠ 0 ∧ Reaches n} {n : ℕ | n < N ∧ n % 3 = 0 ∧ Reaches n} := by
    rw [Set.disjoint_left]
    rintro n ⟨_, h1, _⟩ ⟨_, h2, _⟩
    exact h1 h2
  have hF1 : ({n : ℕ | n < N ∧ n % 3 ≠ 0 ∧ Reaches n} : Set ℕ).Finite :=
    (Set.finite_lt_nat N).subset (fun n hn => hn.1)
  have hF2 : ({n : ℕ | n < N ∧ n % 3 = 0 ∧ Reaches n} : Set ℕ).Finite :=
    (Set.finite_lt_nat N).subset (fun n hn => hn.1)
  rw [hU, Set.ncard_union_eq hD hF1 hF2]

theorem main : (OpenConjecture.Collatz.Step_Density_Mul3 ∧ OpenConjecture.Collatz.Step_Density_Not3) →
    OpenConjecture.Collatz.Open_DensityOne := by
  rintro ⟨hB, hA⟩
  unfold Step_Density_Mul3 at hB
  unfold Step_Density_Not3 at hA
  unfold Open_DensityOne
  have key : (fun N : ℕ => ((Set.ncard {n : ℕ | n < N ∧ Reaches n} : ℝ) / N)) =
      fun N : ℕ => ((Set.ncard {n : ℕ | n < N ∧ n % 3 ≠ 0 ∧ Reaches n} : ℝ) / N) +
        ((Set.ncard {n : ℕ | n < N ∧ n % 3 = 0 ∧ Reaches n} : ℝ) / N) := by
    funext N
    rw [count_split N, Nat.cast_add, add_div]
  rw [key]
  have h1 : (1 : ℝ) = 2 / 3 + 1 / 3 := by norm_num
  rw [h1]
  exact hA.add hB

end OpenConjecture.Collatz.Splits.Split_Open_DensityOne
