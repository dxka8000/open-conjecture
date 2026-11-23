#!/usr/bin/env bash
# Fails if any listed result uses `sorry` or a non-standard axiom.
set -euo pipefail
out=$(lake env lean checker/Axioms.lean)
echo "$out"
bad=$(echo "$out" | tr ',[]' '\n\n\n' | grep -oE '[A-Za-z_][A-Za-z0-9_.]*' \
  | grep -E '^(sorryAx|Lean\.ofReduceBool|Lean\.trustCompiler)$' || true)
if [ -n "$bad" ]; then echo "REJECTED: forbidden axiom(s): $bad"; exit 1; fi
if grep -rnE '\b(sorry|admit|native_decide)\b' --include='*.lean' OpenConjecture; then
  echo "REJECTED: sorry/admit/native_decide found in source"; exit 1; fi
echo "ACCEPTED"
