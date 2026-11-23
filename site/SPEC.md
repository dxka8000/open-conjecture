# Site generator spec

Build a static site generator: `node site/build.mjs` (Node 20+, ES module, ZERO npm dependencies, no framework).
It reads data from the repo and writes a complete static site into `dist/`. Do not modify anything outside `site/`.

## Inputs
- `problems/*.json` — one per problem. Fields: slug, order, tier ("legend" | "challenge" | "warmup"), name_en, name_zh,
  statement_en, statement_zh, status_en, status_zh, ladder_en, ladder_zh, lean_file.
- `records/<problem-slug>/*.json` — one per lemma ("rung"). Fields: id, problem, tier, lean_name, file, bound (number, may be
  missing), summary_en, summary_zh, status ("verified" | "open"), proved_by (GitHub login, may be missing), model (string,
  self-reported, may be missing), verified_at (ISO date, may be missing), statement_review.
- `ledger/supporters.json` — array of {n (ordinal), name, date, problem (slug), url (optional GitHub profile)}. May be empty.
- `site/config.json` — repo_url, sponsor_url (empty string means support is not open yet), site_name.

## Output pages (all links RELATIVE so the site works under a sub-path like /open-conjecture/)
1. `index.html` — home. Above the fold, ONLY:
   - one sentence: "Famous open problems in mathematics, open to everyone's AI. A machine is the only judge."
   - one live line: "N results verified by Lean · M names in the record"
   - the single latest verified result (summary, who, date)
   - two buttons: "Send your AI" (→ join.html) and "Put your name in the record" (→ names.html#support)
   Below: one card per problem (tier badge, name, one-sentence statement, the ladder figure = highest verified bound,
   supporter count). Nothing else. No jargon.
2. `p/<slug>.html` — problem page: name, plain statement, status line, a sober note "This conjecture is unsolved. The results
   below are finite checks and small steps, not a proof.", the ladder (all rungs sorted by bound; verified ones show who /
   model (self-reported) / date / link to the Lean file on GitHub; open ones show "Open — send your AI" linking to join.html),
   the names that back this problem, and a "Back this problem" button.
3. `names.html` — "The record": wall of supporters, newest first, each with ordinal (#1, #2…), name, date, problem, and its own
   anchor (`#n-12`) plus a "copy link" button. Section `#support` explains: from $5, one-time, pick a problem, your name is
   written into this repository's history permanently; not tax-deductible; this is not a charity. If `sponsor_url` is empty
   show "Support opens soon" instead of a button. Also list contributors (people with verified results) with counts.
   Empty states must look intentional ("Be the first name here").
4. `join.html` — "Send your AI": 3 steps (pick an open rung, have your AI write the Lean proof, open a pull request; the Lean
   checker decides). A "Pick one for me" button that randomly highlights an open rung (data embedded as JSON in the page).
   Copy-to-clipboard for the clone command. State clearly: you use your own AI and your own API key on your own machine;
   this project has no server and no login and never asks for, stores or handles API keys. Link to AGENTS.md in the repo.
5. `about.html` — how it works (Lean is the only judge; no sorry; only Lean's three standard axioms), what this is NOT
   (not a claim that any conjecture is near solved; model names are self-reported), security & trust (static site, no
   backend, open source, how to verify), licence, link to the repo.
6. `feed.json` — all records and supporters as JSON.

## Design rules
- Simple and focused: one idea per screen, lots of whitespace, large readable type, max content width ~720px for text.
- No external resources at all: system font stack
  (`system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`), inline CSS, inline
  JS, no images from other hosts, no analytics.
- Add `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src
  'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">` to every page.
- Light and dark themes via CSS variables and `prefers-color-scheme`; explicit body background.
- Mobile first; 16px side gutters; no horizontal scroll at 375px.
- Bilingual: every visible string exists in English and Chinese. A toggle (EN / 中文) in the header switches language
  client-side using `data-i18n` keys and one dictionary object; default from `navigator.language` (zh* → Chinese);
  remember the choice in localStorage inside try/catch; update `<html lang>`. Data fields ending in _en/_zh are rendered
  as paired spans and toggled the same way.
- SECURITY: HTML-escape every value that comes from JSON (names, summaries, logins, model strings). Never output raw HTML
  from data. Only allow `https://github.com/` URLs for supporter links; otherwise render no link.
- Never use the words "donation" / "捐款". Use "support" / "支持".
- Footer on every page: repo link, "Results count only when Lean accepts them.", and the build commit (read from env
  `GITHUB_SHA` if present, else "local").
- Numbers such as bounds are formatted with thousands separators.

## Also write
- `site/README.md`: how to build and preview locally.

## Done when
`node site/build.mjs` exits 0 with the current repo data and with an empty `ledger/supporters.json`, and all six outputs exist.
