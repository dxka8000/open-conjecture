import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auditLinks } from "../linkcheck.mjs";

test("the link audit finds missing files, missing anchors and bad library links, and ignores external links", () => {
  const d = mkdtempSync(join(tmpdir(), "linkcheck-"));
  try {
    mkdirSync(join(d, "p"));
    mkdirSync(join(d, "library"));
    writeFileSync(join(d, "index.html"), `<a href="p/a.html#top">ok</a><a href="p/a.html#nope">bad anchor</a><a href="missing.html">gone</a>
<a href="https://example.org/x">external</a><a href="mailto:x@example.org">mail</a><a href="#here">self</a><span id="here"></span>
<script>var s='<a href="never-checked.html">';</script>`);
    writeFileSync(join(d, "p", "a.html"), `<h1 id="top">A</h1><a href="../index.html">home</a><a href="../">root</a>`);
    writeFileSync(join(d, "library", "library.json"), JSON.stringify({ entries: [
      { id: "ph:a", page: "p/a.html", links: [{ url: "p/a.html#top" }] },
      { id: "fc:b", page: "lib/b.html", links: [{ url: "https://example.org" }] },
    ] }));
    writeFileSync(join(d, "agent.md"), "# rules");
    const r = auditLinks(d);
    assert.deepEqual(r.broken.sort(), [
      'index.html: p/a.html#nope (no id "nope")',
      "index.html: missing.html (no such file)",
      "library.json fc:b: lib/b.html (no such file)",
    ].sort());
  } finally { rmSync(d, { recursive: true, force: true }); }
});
