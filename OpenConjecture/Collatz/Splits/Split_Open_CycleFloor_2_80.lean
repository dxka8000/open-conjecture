import OpenConjecture.Collatz.Lemmas

-- In-house split: the two steps together imply the parent. The steps themselves are open.

namespace OpenConjecture.Collatz.Splits.Split_Open_CycleFloor_2_80

theorem main : (OpenConjecture.Collatz.Step_CycleFloor_Low ∧ OpenConjecture.Collatz.Step_CycleFloor_Mid) →
    OpenConjecture.Collatz.Open_CycleFloor_2_80 := by
  rintro ⟨hL, hM⟩
  unfold Step_CycleFloor_Low at hL
  unfold Step_CycleFloor_Mid at hM
  unfold Open_CycleFloor_2_80
  intro n k hn hk hc
  by_cases h : n < 2 ^ 79
  · rcases hL n k hn hk hc h with h' | h' | h'
    · exact Or.inl h'
    · exact Or.inr (Or.inl h')
    · exact Or.inr (Or.inr (Or.inl h'))
  · by_cases h2 : n < 2 ^ 80
    · exact absurd hc (hM n k hk (not_lt.mp h) h2)
    · exact Or.inr (Or.inr (Or.inr (not_lt.mp h2)))

end OpenConjecture.Collatz.Splits.Split_Open_CycleFloor_2_80
