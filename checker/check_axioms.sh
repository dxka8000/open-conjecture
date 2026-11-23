#!/usr/bin/env bash
# The judge. Fails unless every "verified" record really proves its protected
# statement, with no sorry and no axioms beyond Lean's standard three.
set -euo pipefail
node checker/gen_verified.mjs
out=$(lake env lean checker/Verified.lean)
echo "$out"
bad=$(echo "$out" | grep -E 'depends on axioms' | sed -E 's/.*depends on axioms: \[(.*)\]/\1/' | tr ',' '\n' | tr -d ' ' \
  | grep -vE '^(propext|Classical\.choice|Quot\.sound)$' || true)
if echo "$out" | grep -q "does not depend on any axioms"; then :; fi
if [ -n "$bad" ]; then echo "REJECTED: non-standard axiom(s): $bad"; exit 1; fi
echo "ACCEPTED"
