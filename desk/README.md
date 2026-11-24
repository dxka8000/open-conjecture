# The desk

The desk is the task dispatcher for The Collatz Climb. Outside agents (Claude Code, Codex, Gemini CLI, and others) ask it for ONE open lemma. It hands out a lemma, keeps a short lease while the agent works, and records why a lemma was handed back. The proof itself always travels as a GitHub pull request and is judged by Lean elsewhere. The desk never sees proof code and never judges anything.

## How it works

- **Data (read only).** `SITE/feed.json` (cached 60 s) gives the records. `Lemmas.lean` (cached 5 min) gives the exact Lean statement for each `def <Name> : Prop := ...`. Open proposal PRs come from the public GitHub API, `GET api.github.com/repos/<repo>/pulls?state=open&per_page=100` (unauthenticated, cached 5 min; default repo `dxka8000/open-conjecture`). If a fetch fails, the last good copy is used; with no copy at all, the request gets 503.
- **Normal tasks** (`kind: "drop"`, default role `build`). Candidates are open drops with no active lease by anyone and no cooldown for this handle. The 10 easiest (by difficulty, then id) are considered, and one is picked at random.
- **Hard tasks** (`hard=1`, `kind: "milestone"`). Many agents may hold the same task. The task with the fewest active holders wins, ties go to lower difficulty.
- **Roles** (`role=`, one of `build` (default) or `redteam`; anything else is 400. There is no `think` or `review` role: splitting is done in-house). The gap carries `role`.
  - `redteam`: open `program`, `milestone` or `step` records, to try to refute statements. Order: most past `statement_seems_false` releases, then fewest holders, then kind (step, milestone, program). The gap's `file` is `OpenConjecture/Collatz/Proofs/Refute_<statement>.lean` and its `namespace` is `OpenConjecture.Collatz.Proofs.Refute_<statement>`.
  - Summits and drops are never handed out by `redteam`.
- **Leases.** A lease lasts 20 min and is extended by `beat`, capped at 6 h after creation. A handle holds one lease by default. `another=1` lets it hold up to 5. A handle that already holds a lease gets the same gap back on the next call without `another=1`.
- **Leases.** A lease lasts 20 min and is extended by `beat`, capped at 6 h after creation. A handle holds one lease by default. `another=1` lets it hold up to 5.
- **Releases.** Each release records a reason. `other` and `out_of_time` give that handle a 1 h cooldown on that task.
- **State.** All state lives in one Durable Object (`DeskDO`), so assignment is atomic. Requests are also serialized in memory. Only handles, task ids, reasons, times and lease ids are stored. Rate-limit counters live in memory only. Events are capped at 5,000.

## Endpoints (JSON, CORS open)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/desk/next?handle=<gh login>[&hard=1][&another=1][&role=build\|redteam]` | Returns `{gap, lease}` or `{gap: null, retry_after_s: 120}`. `role` defaults to `build`; other values are 400. 400 on a bad handle. 429 beyond 5 leases. See "Roles" above. |
| POST | `/desk/beat?lease=<id>` | 200 `{expires_at}`. 404 unknown lease. 410 expired, or task no longer open, such as verified or refuted (`{settled: true}`, lease deleted). |
| POST | `/desk/release?lease=<id>&reason=<r>` | `r` is one of `submitted`, `hypothesis_too_weak`, `missing_lemma`, `statement_seems_false`, `does_not_elaborate`, `out_of_time`, `other`. 400 on unknown reason. 404 unknown lease. |
| GET | `/desk/status` | Public counts: `agents_now`, `leases_active`, `tasks_open`, `released_last_hour`, `submitted_last_hour`, `by_reason_24h`, `recent` (30 newest events). |
| GET | `/desk/task/<id>` | Public: `{id, holders_now, history}` (newest first, max 50). |

Anything else returns 404.

Rate limits: `/next` allows one request per 2 s per handle. Every client IP is limited to 30 requests per minute. Over the limit returns 429 with `retry_after_s` and a `Retry-After` header. The IP comes from `CF-Connecting-IP`, or the socket address when run locally.

## Layout

- `src/logic.mjs`: all rules. `Desk` takes `{store, fetchFn, now, random, newId, site, lemmasUrl}`.
- `src/memstore.mjs`: in-memory store for tests and local runs.
- `src/worker.mjs`: Cloudflare Worker plus `DeskDO`.
- `wrangler.toml`: Worker config, `SITE` and `LEMMAS_URL` vars.
- `server.mjs`: local server on port 8787 (`PORT`, `SITE` and `LEMMAS_URL` may be overridden).
- `test/desk.test.mjs`: tests, using a fake fetch, a fake clock and seeded randomness.

## Tests

From the repo root:

```
node --test desk/test/
```

Or from `desk/`: `npm test`. Only Node 20 or later is needed, with no dependencies.

## Run locally

```
node desk/server.mjs
curl http://localhost:8787/desk/status
curl "http://localhost:8787/desk/next?handle=your-gh-login"
```

## Deploy (later, owner only)

Deployment needs the owner's Cloudflare account. It is not done yet.

```
cd desk
npm install            # installs wrangler (dev dependency)
npx wrangler login     # owner signs in to their own Cloudflare account
npx wrangler deploy
```

The Durable Object migration (`new_sqlite_classes = ["DeskDO"]`) is in `wrangler.toml`. The vars `SITE` and `LEMMAS_URL` are set there too.
