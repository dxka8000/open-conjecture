import OpenConjecture.Goldbach.Basic

namespace OpenConjecture.Goldbach

theorem goldbach_le_10 : Target 10 := by
  show ∀ n : ℕ, 2 < n → n ≤ 10 → Even n → IsSumOfTwoPrimes n
  intro n h2 h10 he
  interval_cases n
  · exact absurd he (by decide)
  · exact ⟨2, 2, by norm_num, by norm_num, rfl⟩
  · exact absurd he (by decide)
  · exact ⟨3, 3, by norm_num, by norm_num, rfl⟩
  · exact absurd he (by decide)
  · exact ⟨3, 5, by norm_num, by norm_num, rfl⟩
  · exact absurd he (by decide)
  · exact ⟨3, 7, by norm_num, by norm_num, rfl⟩

end OpenConjecture.Goldbach
