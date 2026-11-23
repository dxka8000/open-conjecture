import OpenConjecture

-- Every verified result is listed here. The workflow fails if any of them
-- depends on `sorry` or on axioms outside Lean's standard three.
#print axioms OpenConjecture.Collatz.reaches_le_10
