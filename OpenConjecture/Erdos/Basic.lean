import Mathlib

/-!
# Erdős problems

Seven open problems of Paul Erdős, numbered as on https://www.erdosproblems.com. The statements follow
the formalisations in google-deepmind/formal-conjectures (Apache-2.0), restated here without that
project's helper definitions so that they need only Mathlib.

This file is protected: pull requests may not change it.
-/

namespace OpenConjecture.Erdos

/-- `n` is powerful: every prime that divides `n` divides it at least twice. -/
def Powerful (n : ℕ) : Prop := ∀ p : ℕ, p.Prime → p ∣ n → p ^ 2 ∣ n

end OpenConjecture.Erdos
