import OpenConjecture.Collatz.Lemmas

namespace OpenConjecture.Collatz

def Step_NoCycleUpTo_2 : Prop :=
  ∀ n k : ℕ, 0 < n → 0 < k → k ≤ 2 → step^[k] n = n → n = 1 ∨ n = 2 ∨ n = 4

end OpenConjecture.Collatz
