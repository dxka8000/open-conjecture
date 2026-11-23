#!/usr/bin/env bash
# The judge. Fails unless every "verified" record really proves its protected
# target, with no sorry and no axioms beyond Lean's standard three.
set -euo pipefail

# 1. Proof files may only contain plain definitions and theorems.
if grep -rnE '\b(sorry|admit|native_decide|axiom|unsafe|macro|macro_rules|syntax|notation|infix|infixl|infixr|prefix|postfix|elab|elab_rules|declare_syntax_cat|initialize|builtin_initialize|run_cmd|run_elab|run_meta|attribute|instance|implemented_by|extern|csimp|set_option|open|export|local|scoped|private|protected|opaque|partial|deriving|IO|unsafeCast|reduceBool|ofReduceBool|trustCompiler)\b|#eval|#exit|#print|#check|#reduce|@\[' \
     --include='*.lean' OpenConjecture/*/Proofs; then
  echo "REJECTED: a proof file uses a forbidden keyword (see CONTRIBUTING rules in AGENTS.md)"; exit 1
fi

# 2. Records are well-formed; generate the file that ties them to the targets.
node checker/gen_verified.mjs

# 3. Lean must accept every tie, and report only standard axioms.
out=$(lake env lean checker/Verified.lean)
echo "$out"
bad=$(echo "$out" | grep -E 'depends on axioms' | sed -E 's/.*depends on axioms: \[(.*)\]/\1/' | tr ',' '\n' | tr -d ' ' \
  | grep -vE '^(propext|Classical\.choice|Quot\.sound)$' || true)
if [ -n "$bad" ]; then echo "REJECTED: non-standard axiom(s): $bad"; exit 1; fi
echo "ACCEPTED"
