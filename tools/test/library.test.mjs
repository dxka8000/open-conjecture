import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { libFolder, readLibrary } from "../../checker/library.mjs";
import { scoreEvents, scoringConfig, leaderboardRows } from "../scoring.mjs";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("library ids are unique, and every library problem gets a distinct, legal notes folder", () => {
  const entries = JSON.parse(readFileSync(`${ROOT}/site/library/library.json`, "utf8")).entries;
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length, "library ids are unique");
  const lib = readLibrary(ROOT);
  assert.equal(lib.size, entries.filter((e) => !e.id.startsWith("ph:")).length);
  const lower = new Set();
  for (const [folder, e] of lib) {
    assert.match(folder, /^lib-[a-z0-9-]{1,55}$/, e.id);
    assert.ok(folder.length <= 60, folder);
    assert.ok(!lower.has(folder), `${folder} repeats`);
    lower.add(folder);
  }
});

test("libFolder is stable, readable and keeps ids apart that differ only in case or symbols", () => {
  assert.equal(libFolder("fc:erdos_10"), "lib-erdos-10-6b4d2d");
  assert.equal(libFolder("ph:open-density-one"), "open-density-one");
  assert.notEqual(libFolder("fc:Foo.bar"), libFolder("fc:foo_bar"));
  assert.match(libFolder("fc:moment_isEquiv₃"), /^lib-moment-isequiv3-[0-9a-f]{6}$/);
  assert.match(libFolder("fc:" + "x".repeat(200)), /^lib-x{44}-[0-9a-f]{6}$/);
});

test("a research note on a library problem scores 10 (weight 1), and can be cited", () => {
  const S = scoringConfig({});
  const lib = new Map([["lib-erdos-10-6b4d2d", { id: "fc:erdos_10", folder: "lib-erdos-10-6b4d2d" }]]);
  const notes = [
    { record: "lib-erdos-10-6b4d2d", who: "nina", date: "2026-11-24", path: "notes/lib-erdos-10-6b4d2d/nina-a.md", file: "nina-a.md", text: "" },
    { record: "lib-erdos-10-6b4d2d", who: "omar", date: "2026-11-25", path: "notes/lib-erdos-10-6b4d2d/omar-b.md", file: "omar-b.md",
      text: "builds on https://proofhive.github.io/notes/lib-erdos-10-6b4d2d/nina-a.html" },
    { record: "lib-unknown-000000", who: "pete", date: "2026-11-25", path: "notes/lib-unknown-000000/pete-c.md", file: "pete-c.md", text: "" },
  ];
  const ev = scoreEvents([], S, notes, lib);
  const rows = leaderboardRows(ev);
  assert.equal(rows.find((r) => r.who === "nina").points, 15);
  assert.equal(rows.find((r) => r.who === "omar").points, 10);
  assert.equal(rows.find((r) => r.who === "pete"), undefined, "a note on an unknown folder scores nothing");
  assert.equal(ev.find((e) => e.kind === "note" && e.who === "nina").rule_en, "research note: 10 × weight 1.0");
});
