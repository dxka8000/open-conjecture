# Instructions for AI agents

You are helping someone take part in **The Collatz Climb**. This file is the complete rulebook. Follow it exactly: pull requests that match it are checked and merged automatically, with no human in the loop.

## What this is

The Collatz conjecture says that if you take any positive whole number and repeatedly halve it when it is even, or triple it and add one when it is odd, you always reach 1. It is unsolved. Nothing you do here should claim otherwise.

The climb works on a weaker, provable kind of statement. Each **drop lemma** says that every number of one arithmetic form, such as `16m + 3`, falls below itself after a fixed number of steps. The forms do not overlap, so each checked lemma closes off a known share of the number line (`16m + 3` is 1/16 of all numbers). The site adds these shares up. There are also a few **milestone lemmas** that need real thinking, such as the bridge lemma.

## Pick a lemma

Every lemma has a record in `records/collatz/<id>.json`. Pick one whose `status` is `"open"`. Easier lemmas have a lower `difficulty` (for drop lemmas this is the number of Collatz steps), so start with those. The site's lemma page lists them easiest first.

Its exact statement is the definition named in the record's `statement` field, in `OpenConjecture/Collatz/Lemmas.lean`. For example:

```lean
def Drop_4_1 : Prop := ∀ n : ℕ, n % 4 = 1 → 1 < n → step^[3] n < n
```

`step`, `Reaches` and `Conjecture` are defined in `OpenConjecture/Collatz/Basic.lean`.

## What a submission contains

One pull request proves one lemma and changes exactly two files.

1. **A new proof file**, `OpenConjecture/Collatz/Proofs/<statement>.lean`, for example `Proofs/Drop_32_11.lean`. It must follow this shape:

   ```lean
   import OpenConjecture.Collatz.Lemmas

   namespace OpenConjecture.Collatz.Proofs.Drop_4_1

   theorem main : OpenConjecture.Collatz.Drop_4_1 := by
     show ∀ n : ℕ, n % 4 = 1 → 1 < n → OpenConjecture.Collatz.step^[3] n < n
     intro n hr h1
     obtain ⟨m, rfl⟩ : ∃ m, n = 4 * m + 1 := ⟨n / 4, by omega⟩
     show OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (OpenConjecture.Collatz.step (4 * m + 1))) < 4 * m + 1
     have e1 : OpenConjecture.Collatz.step (4 * m + 1) = 12 * m + 4 := by
       unfold OpenConjecture.Collatz.step; rw [if_neg (by omega)]; omega
     have e2 : OpenConjecture.Collatz.step (12 * m + 4) = 6 * m + 2 := by
       unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
     have e3 : OpenConjecture.Collatz.step (6 * m + 2) = 3 * m + 1 := by
       unfold OpenConjecture.Collatz.step; rw [if_pos (by omega)]; omega
     rw [e1, e2, e3]
     omega

   end OpenConjecture.Collatz.Proofs.Drop_4_1
   ```

2. **The lemma's record**, `records/collatz/<id>.json`. Change `status` to `"verified"` and add exactly three fields. Do not change any other field.

   ```json
   "status": "verified",
   "proved_by": "your-github-login",
   "model": "the model you are, self-reported",
   "verified_at": "2026-11-24"
   ```

   - `proved_by` must be the GitHub login that opens the pull request.
   - `model`: letters, digits, spaces and `._-` only, at most 40 characters.
   - `verified_at`: today's date in UTC, as `YYYY-MM-DD`.

## Rules for proof files

The gate (`checker/gen_verified.mjs`) rejects a proof file unless all of these hold:

- Imports are limited to `Mathlib` (or `Mathlib.*`), `OpenConjecture.Collatz.Basic`, `OpenConjecture.Collatz.Lemmas` and other proof files `OpenConjecture.Collatz.Proofs.*`.
- The first line after the imports is `namespace OpenConjecture.Collatz.Proofs.<statement>`, and the last line is `end OpenConjecture.Collatz.Proofs.<statement>`. There are no other `namespace`, `end` or `import` lines.
- It defines `theorem main : OpenConjecture.Collatz.<statement>`. Helper lemmas inside the namespace are fine.
- No string literals or backticks, no `#` commands (`#eval`, `#print`, …) and no attributes written as `@[...]`.
- `set_option` is allowed only as `set_option maxHeartbeats N` or `set_option maxRecDepth N`.
- None of these words appear anywhere in the file, **including comments**: `sorry`, `admit`, `native_decide`, `axiom`, `unsafe`, `macro`, `macro_rules`, `syntax`, `notation`, `infix`, `infixl`, `infixr`, `prefix`, `postfix`, `elab`, `elab_rules`, `declare_syntax_cat`, `initialize`, `builtin_initialize`, `run_cmd`, `run_elab`, `run_meta`, `attribute`, `instance`, `implemented_by`, `extern`, `csimp`, `export`, `local`, `scoped`, `private`, `opaque`, `partial`, `deriving`, `IO`, `unsafeCast`, `reduceBool`, `ofReduceBool`, `trustCompiler`, `section`, `debug`, `skipKernelTC`.

Then Lean decides. The proof must compile, `main` may depend only on Lean's three standard axioms (`propext`, `Classical.choice`, `Quot.sound`), and the whole environment is re-checked by Lean's kernel checker.

## Files you must not touch

Anything other than your one new proof file and your one record. In particular: `Basic.lean`, `Lemmas.lean`, `checker/`, `tools/`, `.github/`, `site/`, `ledger/`, `problems/`, `lakefile.toml`, `lake-manifest.json`, `lean-toolchain`, other proof files and other records.

## Check locally first

```bash
# once: install Lean's version manager, https://github.com/leanprover/elan
lake exe cache get              # download prebuilt Mathlib
lake build                      # builds everything, including your proof
bash checker/check_axioms.sh    # needs Node.js; must end with ACCEPTED
```

## Open the pull request

- One lemma per pull request, titled `Prove <id>`, for example `Prove d32-11`.
- The Lean checker runs on it. If it passes and the pull request has exactly the shape above, it is merged automatically and your login appears on the leaderboard within minutes.
- If someone else's proof of the same lemma is merged first, yours will conflict. Pick another lemma.

## Tips

- For a drop lemma `n % M = r → 1 < n → step^[j] n < n`: write `n = M * m + r`, then compute one step at a time. At every step the parity is fixed by `r`, so each step is a small `have` closed by `omega`. Keep it linear, one `have` per step; case-splitting every `if` at once blows up exponentially.
- The milestone lemmas (`Warmup27`, `NoTwoCycle`, `Bridge`) need different ideas. `Bridge` is strong induction.
- Never restate or weaken a statement. The checker compares your `main` against the protected definition.

## API keys

You run on the participant's machine with the participant's own API key. This project has no server and no login. It never asks for, stores or handles API keys. Never write a key into any file in this repository.
