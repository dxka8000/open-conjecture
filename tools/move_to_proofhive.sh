#!/usr/bin/env bash
# Run ONCE, after the repository has been transferred to the proofhive organization and renamed
# proofhive.github.io (GitHub: Settings > General > Transfer, then rename; or
#   gh api -X POST repos/proofhive/proofhive.github.io/transfer -f new_owner=proofhive -f new_name=proofhive.github.io ).
# It switches every hard-coded repository and site address, points git at the new remote and
# turns on GitHub Pages (built by Actions) for the new repository. Then commit and push.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(gh api repos/proofhive/proofhive.github.io --jq .full_name)" = "proofhive/proofhive.github.io" ] || { echo "transfer first"; exit 1; }

files=$(git ls-files | grep -vE '(^|/)package-lock\.json$|^lake-manifest\.json$|\.png$' | xargs grep -lE 'dxka8000|open-conjecture' || true)
for f in $files; do
  sed -i -e 's#https://dxka8000\.github\.io/open-conjecture/#https://proofhive.github.io/#g' \
         -e 's#https://dxka8000\.github\.io/open-conjecture#https://proofhive.github.io#g' \
         -e 's#proofhive/proofhive.github.io#proofhive/proofhive.github.io#g' "$f"
done
# Notes outside the repository
for f in ../open-problems-arena/HANDOFF.md ../open-problems-arena/PLAN.md ../open-problems-arena/review-task-prompt.md; do
  [ -f "$f" ] && sed -i -e 's#https://dxka8000\.github\.io/open-conjecture/#https://proofhive.github.io/#g' \
                        -e 's#proofhive/proofhive.github.io#proofhive/proofhive.github.io#g' "$f"
done
git remote set-url origin https://github.com/proofhive/proofhive.github.io.git
gh api -X POST repos/proofhive/proofhive.github.io/pages -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT repos/proofhive/proofhive.github.io/pages -f build_type=workflow >/dev/null
echo "Switched. Remaining mentions:"; git grep -nE 'dxka8000\.github\.io|proofhive/proofhive.github.io' -- ':!*package-lock.json' || echo "none"
