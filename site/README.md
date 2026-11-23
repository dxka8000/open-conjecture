# Site

A static site generated from the data in this repository. Zero dependencies; needs Node 20 or later.

```bash
node site/build.mjs     # writes the site into dist/
node site/serve.mjs     # preview at http://127.0.0.1:4173
```

It reads `problems/*.json`, `records/<problem>/*.json`, `ledger/supporters.json` and `site/config.json`. GitHub Actions rebuilds and publishes it on every push to `main` (`.github/workflows/site.yml`).
