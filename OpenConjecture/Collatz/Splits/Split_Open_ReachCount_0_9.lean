import OpenConjecture.Collatz.Lemmas

-- In-house split: the two steps together imply the parent. The steps themselves are open.

namespace OpenConjecture.Collatz.Splits.Split_Open_ReachCount_0_9

theorem count_split (x : ℕ) : Set.ncard {n : ℕ | 0 < n ∧ n ≤ x ∧ Reaches n} =
    Set.ncard {n : ℕ | 0 < n ∧ n ≤ x ∧ n % 3 ≠ 0 ∧ Reaches n} +
      Set.ncard {n : ℕ | 0 < n ∧ n ≤ x ∧ n % 3 = 0 ∧ Reaches n} := by
  have hU : {n : ℕ | 0 < n ∧ n ≤ x ∧ Reaches n} =
      {n : ℕ | 0 < n ∧ n ≤ x ∧ n % 3 ≠ 0 ∧ Reaches n} ∪ {n : ℕ | 0 < n ∧ n ≤ x ∧ n % 3 = 0 ∧ Reaches n} := by
    ext n
    simp only [Set.mem_union, Set.mem_setOf_eq]
    constructor
    · rintro ⟨h0, h1, h2⟩
      by_cases h : n % 3 = 0
      · exact Or.inr ⟨h0, h1, h, h2⟩
      · exact Or.inl ⟨h0, h1, h, h2⟩
    · rintro (⟨h0, h1, _, h2⟩ | ⟨h0, h1, _, h2⟩)
      · exact ⟨h0, h1, h2⟩
      · exact ⟨h0, h1, h2⟩
  have hD : Disjoint {n : ℕ | 0 < n ∧ n ≤ x ∧ n % 3 ≠ 0 ∧ Reaches n} {n : ℕ | 0 < n ∧ n ≤ x ∧ n % 3 = 0 ∧ Reaches n} := by
    rw [Set.disjoint_left]
    rintro n ⟨_, _, h1, _⟩ ⟨_, _, h2, _⟩
    exact h1 h2
  have hF1 : ({n : ℕ | 0 < n ∧ n ≤ x ∧ n % 3 ≠ 0 ∧ Reaches n} : Set ℕ).Finite :=
    (Set.finite_Iic x).subset (fun n hn => hn.2.1)
  have hF2 : ({n : ℕ | 0 < n ∧ n ≤ x ∧ n % 3 = 0 ∧ Reaches n} : Set ℕ).Finite :=
    (Set.finite_Iic x).subset (fun n hn => hn.2.1)
  rw [hU, Set.ncard_union_eq hD hF1 hF2]

theorem main : (OpenConjecture.Collatz.Step_ReachCount_Mul3 ∧ OpenConjecture.Collatz.Step_ReachCount_Not3) →
    OpenConjecture.Collatz.Open_ReachCount_0_9 := by
  rintro ⟨hB, hA⟩
  unfold Step_ReachCount_Mul3 at hB
  unfold Step_ReachCount_Not3 at hA
  unfold Open_ReachCount_0_9
  obtain ⟨b, hb⟩ := hB
  obtain ⟨a, ha⟩ := hA
  refine ⟨max a b, fun x hx => ?_⟩
  have h1 := ha x (le_trans (le_max_left a b) hx)
  have h2 := hb x (le_trans (le_max_right a b) hx)
  rw [count_split x, Nat.cast_add]
  linarith

end OpenConjecture.Collatz.Splits.Split_Open_ReachCount_0_9
