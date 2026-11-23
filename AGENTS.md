# Instructions for AI agents

You are helping someone take part in Open Conjecture. This file tells you exactly what a valid submission is.

## What this project is

Each problem below is a famous, unsolved conjecture. None of them is close to being solved, and nothing you do here should claim otherwise. Each problem has a **ladder**: a list of fixed, finite statements called rungs (for example, "Goldbach holds for every even number up to 1,000"). Your job is to prove one open rung in Lean 4. The Lean checker in this repository is the only judge.

## Find an open rung

Open rungs are the files `records/<problem>/<bound>.json` whose `status` is `"open"`.

| Problem | Folder | Lean namespace |
|---|---|---|
| Collatz conjecture | `records/collatz/` | `OpenConjecture.Collatz` |
| Goldbach's conjecture | `records/goldbach/` | `OpenConjecture.Goldbach` |
| Twin prime conjecture | `records/twin-primes/` | `OpenConjecture.TwinPrimes` |

## What a rung means

A rung with bound `B` means: prove `Target B`, where `Target` is defined in the problem's protected `Basic.lean`.

```lean
-- OpenConjecture/Collatz/Basic.lean
def Target (B : ℕ) : Prop := ∀ n : ℕ, 0 < n → n ≤ B → Reaches n

-- OpenConjecture/Goldbach/Basic.lean
def Target (B : ℕ) : Prop := ∀ n : ℕ, 2 < n → n ≤ B → Even n → IsSumOfTwoPrimes n

-- OpenConjecture/TwinPrimes/Basic.lean
def Target (B : ℕ) : Prop := ∃ p : ℕ, B < p ∧ p.Prime ∧ (p + 2).Prime
```

Read the whole `Basic.lean` for the definitions these use (`step`, `Reaches`, `IsSumOfTwoPrimes`).

## What a submission contains

One pull request proves one rung. It changes exactly two things:

1. **A new Lean file** at `OpenConjecture/<Namespace>/Proofs/<Name>.lean` that proves a theorem whose type is `Target <bound>`. Follow the existing examples, such as `OpenConjecture/Goldbach/Proofs/Le10.lean`:

   ```lean
   import OpenConjecture.Goldbach.Basic

   namespace OpenConjecture.Goldbach

   theorem goldbach_le_100 : Target 100 := by
     ...

   end OpenConjecture.Goldbach
   ```

2. **The rung's record** `records/<problem>/<bound>.json`, changed to:

   ```json
   {
     "id": "goldbach/100",
     "problem": "goldbach",
     "bound": 100,
     "status": "verified",
     "lean_name": "OpenConjecture.Goldbach.goldbach_le_100",
     "file": "OpenConjecture/Goldbach/Proofs/Le100.lean",
     "proved_by": "your-github-login",
     "model": "the model you are, self-reported",
     "verified_at": "2026-11-24"
   }
   ```

The checker rejects a record unless all of these hold:

- `id`, `problem`, `bound` and the file name agree (`goldbach/100`, `goldbach`, `100`, `100.json`).
- `status` is `open` or `verified`, and no other fields are present.
- `file` is under `OpenConjecture/<Namespace>/Proofs/` and ends in `.lean`.
- `lean_name` is `OpenConjecture.<Namespace>.<identifier>`.
- `proved_by` is a GitHub login (letters, digits and `-`, at most 39 characters).
- `model` uses only letters, digits, spaces and `._-`, at most 40 characters.
- `verified_at` is a date in the form `YYYY-MM-DD`.

## Files you must not touch

Do not change any of these. A pull request that does will be rejected.

- any `Basic.lean`
- `checker/`, `.github/`, `problems/`, `site/`, `ledger/`
- `lakefile.toml`, `lake-manifest.json`, `lean-toolchain`
- other people's proof files and other rungs' records

## Rules for proof files

Write plain theorems inside a `namespace` block. Proof files may not contain any of these words or commands:

`sorry`, `admit`, `native_decide`, `axiom`, `unsafe`, `macro`, `macro_rules`, `syntax`, `notation`, `infix`, `infixl`, `infixr`, `prefix`, `postfix`, `elab`, `elab_rules`, `declare_syntax_cat`, `initialize`, `builtin_initialize`, `run_cmd`, `run_elab`, `run_meta`, `attribute`, `instance`, `implemented_by`, `extern`, `csimp`, `set_option`, `open`, `export`, `local`, `scoped`, `private`, `protected`, `opaque`, `partial`, `deriving`, `IO`, `unsafeCast`, `reduceBool`, `ofReduceBool`, `trustCompiler`, `#eval`, `#exit`, `#print`, `#check`, `#reduce`, and attributes written as `@[...]`.

The check is a plain word match, so these words are also rejected inside comments and names. Use fully qualified names such as `Nat.Prime` instead of `open`.

Your theorem may depend only on Lean's three standard axioms: `propext`, `Classical.choice` and `Quot.sound`.

You may add helper definitions and lemmas in your file. They count only through the final theorem.

## Check locally before opening the pull request

```bash
# install Lean's version manager once: https://github.com/leanprover/elan
lake exe cache get      # download prebuilt Mathlib
lake build              # build everything, including your proof
bash checker/check_axioms.sh
```

The last command must print `ACCEPTED`.

## Open the pull request

- One rung per pull request.
- Title: `Prove <problem> <bound>`, for example `Prove goldbach 100`.
- The same checker runs on your pull request. If it passes, a maintainer merges it and the site lists the result under `proved_by`.

## Proof tips

- `decide` works only for small bounds. Larger bounds need real structure: induction, splitting the range, or a certificate-style proof in which you supply witnesses and Lean checks them.
- For Goldbach, supplying the two primes for each even number and checking primality with `norm_num` is a valid approach, but it gets large quickly. Think about how to keep the proof term small.
- For twin primes, one explicit witness `p` above the bound is enough. The work is proving that `p` and `p + 2` are prime.
- Never weaken, restate or redefine the target. The checker compares against the protected `Target` and will reject anything else.

## API keys

You run on the participant's machine, with the participant's own API key. This project has no server and no login, and it never asks for, stores or handles API keys. Never put a key in any file in this repository.
