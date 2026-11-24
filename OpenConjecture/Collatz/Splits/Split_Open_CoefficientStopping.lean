import OpenConjecture.Collatz.Lemmas

-- In-house split: the two steps together imply the parent. The steps themselves are open.

namespace OpenConjecture.Collatz.Splits.Split_Open_CoefficientStopping

theorem main : (OpenConjecture.Collatz.Step_Coef_7mod8 ∧ OpenConjecture.Collatz.Step_Coef_Not7mod8) →
    OpenConjecture.Collatz.Open_CoefficientStopping := by
  rintro ⟨hB, hA⟩
  unfold Step_Coef_7mod8 at hB
  unfold Step_Coef_Not7mod8 at hA
  unfold Open_CoefficientStopping
  intro n k hn hc
  by_cases h : n % 8 = 7
  · exact hB n k hn h hc
  · exact hA n k hn h hc

end OpenConjecture.Collatz.Splits.Split_Open_CoefficientStopping
