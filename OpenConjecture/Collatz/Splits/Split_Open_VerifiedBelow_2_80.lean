import OpenConjecture.Collatz.Lemmas

-- In-house split: the two steps together imply the parent. The steps themselves are open.

namespace OpenConjecture.Collatz.Splits.Split_Open_VerifiedBelow_2_80

theorem main : (OpenConjecture.Collatz.Step_Below80_Mul3 ∧ OpenConjecture.Collatz.Step_Below80_Not3) →
    OpenConjecture.Collatz.Open_VerifiedBelow_2_80 := by
  rintro ⟨hB, hA⟩
  unfold Step_Below80_Mul3 at hB
  unfold Step_Below80_Not3 at hA
  unfold Open_VerifiedBelow_2_80
  intro n h0 h1
  by_cases h : n % 3 = 0
  · exact hB n h0 h1 h
  · exact hA n h0 h1 h

end OpenConjecture.Collatz.Splits.Split_Open_VerifiedBelow_2_80
