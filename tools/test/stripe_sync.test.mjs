// Run: node --test tools/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SYNC = join(ROOT, "tools", "stripe_sync.mjs");
const SALT = "test-salt-not-a-secret";
const KEY = "rk_test_fake_read_only";

// Mock Stripe: serves /v1/checkout/sessions newest-first with cursor pagination, like the real API.
function startMock(sessions, { failPage = 0 } = {}) {
  const state = { requests: [] };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    state.requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization });
    if (url.pathname !== "/v1/checkout/sessions" || req.headers.authorization !== `Bearer ${KEY}`) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":{"message":"unauthorized"}}');
    }
    const limit = Number(url.searchParams.get("limit"));
    const after = url.searchParams.get("starting_after");
    let start = 0;
    if (after) {
      const idx = sessions.findIndex((s) => s.id === after);
      start = idx + 1;
    }
    const page = Math.floor(start / limit) + 1;
    if (failPage && page === failPage) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end('{"error":{"message":"boom"}}');
    }
    const data = sessions.slice(start, start + limit);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data, has_more: start + limit < sessions.length }));
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => ok({ server, state, api: `http://127.0.0.1:${server.address().port}` })),
  );
}

let seq = 0;
function session({ email = "a@example.com", amount = 500, currency = "usd", paid = true, created = 1767225600, name, tagline, link, id } = {}) {
  seq++;
  const custom_fields = [];
  const add = (key, value) => custom_fields.push({ key, type: "text", text: { value: value ?? null } });
  if (name !== undefined) add("display_name", name);
  if (tagline !== undefined) add("tagline", tagline);
  if (link !== undefined) add("link", link);
  return {
    id: id || `cs_test_${String(seq).padStart(6, "0")}`,
    object: "checkout.session",
    status: "complete",
    payment_status: paid ? "paid" : "unpaid",
    currency,
    amount_total: amount,
    created,
    customer_details: { email },
    custom_fields,
  };
}

const keyOf = (email) => createHmac("sha256", SALT).update(email.toLowerCase()).digest("hex").slice(0, 16);

function runSync({ api, dir, key = KEY, salt = SALT }) {
  const env = { ...process.env };
  for (const k of ["STRIPE_KEY", "LEDGER_SALT", "STRIPE_API", "LEDGER_DIR"]) delete env[k];
  if (key) env.STRIPE_KEY = key;
  if (salt) env.LEDGER_SALT = salt;
  if (api) env.STRIPE_API = api;
  if (dir) env.LEDGER_DIR = dir;
  return new Promise((ok) => {
    const child = spawn(process.execPath, [SYNC], { env, cwd: tmpdir() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => ok({ code, stdout, stderr }));
  });
}

const readLedger = (dir) => JSON.parse(readFileSync(join(dir, "supporters.json"), "utf8"));
const readProcessed = (dir) => JSON.parse(readFileSync(join(dir, "processed.json"), "utf8"));

function snapshot(dir) {
  if (!existsSync(dir)) return null;
  const out = {};
  for (const f of readdirSync(dir)) out[f] = readFileSync(join(dir, f), "utf8");
  return out;
}

async function withEnv(fn) {
  const base = mkdtempSync(join(tmpdir(), "stripe-sync-"));
  const dir = join(base, "ledger");
  mkdirSync(dir);
  try {
    return await fn({ base, dir });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("pagination follows has_more and starting_after across pages", async () => {
  const sessions = [];
  for (let i = 0; i < 250; i++) sessions.push(session({ email: `user${i}@example.com`, id: `cs_page_${String(i).padStart(3, "0")}`, name: `U${i}` }));
  const mock = await startMock(sessions.slice().reverse()); // Stripe lists newest first
  try {
    await withEnv(async ({ dir }) => {
      const r = await runSync({ api: mock.api, dir });
      assert.equal(r.code, 0, r.stderr);
      const cursors = mock.state.requests.map((q) => q.query.starting_after || null);
      assert.deepEqual(cursors, [null, "cs_page_150", "cs_page_050"]);
      assert.ok(mock.state.requests.every((q) => q.query.limit === "100" && q.query.status === "complete"));
      assert.equal(readLedger(dir).length, 250);
      assert.equal(readProcessed(dir).length, 250);
    });
  } finally {
    mock.server.close();
  }
});

test("unpaid and non-usd sessions are ignored", async () => {
  const paidUsd = session({ email: "ok@example.com", name: "Ok" });
  const unpaid = session({ email: "unpaid@example.com", name: "Unpaid", paid: false });
  const eur = session({ email: "eur@example.com", name: "Euro", currency: "eur" });
  const mock = await startMock([paidUsd, unpaid, eur]);
  try {
    await withEnv(async ({ dir }) => {
      const r = await runSync({ api: mock.api, dir });
      assert.equal(r.code, 0, r.stderr);
      const ledger = readLedger(dir);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].name, "Ok");
      assert.deepEqual(readProcessed(dir), [paidUsd.id]);
    });
  } finally {
    mock.server.close();
  }
});

test("two payments by the same email merge and sum, with latest date and name", async () => {
  const first = session({ email: "Ann@Example.com", amount: 500, created: 1767225600, name: "Ann Old", tagline: "first" });
  const second = session({ email: "ann@example.com", amount: 1250, created: 1769904000, name: "Ann New" });
  const mock = await startMock([second, first]);
  try {
    await withEnv(async ({ dir }) => {
      const r = await runSync({ api: mock.api, dir });
      assert.equal(r.code, 0, r.stderr);
      const ledger = readLedger(dir);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].amount, 17.5);
      assert.equal(ledger[0].date, "2026-02-01");
      assert.equal(ledger[0].name, "Ann New");
      assert.equal(ledger[0].tagline, "first", "tagline kept when the latest payment did not provide one");
      assert.equal(ledger[0].key, keyOf("ann@example.com"));
    });
  } finally {
    mock.server.close();
  }
});

test("the email never appears in any output file or in the console output", async () => {
  const email = "Secret.Person@Example.org";
  const mock = await startMock([session({ email, name: "Sam" })]);
  try {
    await withEnv(async ({ dir }) => {
      const r = await runSync({ api: mock.api, dir });
      assert.equal(r.code, 0, r.stderr);
      for (const [file, text] of Object.entries(snapshot(dir))) {
        assert.ok(!text.toLowerCase().includes("secret.person"), `${file} contains the email`);
        assert.ok(!text.includes("@example.org"), `${file} contains the email`);
      }
      assert.ok(!r.stdout.toLowerCase().includes("secret.person") && !r.stderr.toLowerCase().includes("secret.person"));
      assert.ok(!r.stdout.includes(KEY) && !r.stdout.includes(SALT));
    });
  } finally {
    mock.server.close();
  }
});

test("re-running is idempotent: no change, no double counting", async () => {
  const mock = await startMock([session({ email: "rep@example.com", amount: 300, name: "Rep" })]);
  try {
    await withEnv(async ({ dir }) => {
      const first = await runSync({ api: mock.api, dir });
      assert.equal(first.code, 0, first.stderr);
      const before = snapshot(dir);
      const second = await runSync({ api: mock.api, dir });
      assert.equal(second.code, 0, second.stderr);
      assert.match(second.stdout, /no changes/);
      assert.deepEqual(snapshot(dir), before);
      assert.equal(readLedger(dir)[0].amount, 3);
    });
  } finally {
    mock.server.close();
  }
});

test("a new supporter gets max existing n plus one, and n is never reused", async () => {
  await withEnv(async ({ dir }) => {
    // Existing ledger with a gap: n=7 is the highest, so the next supporter must be 8.
    writeFileSync(
      join(dir, "supporters.json"),
      JSON.stringify([{ n: 3, name: "Old", amount: 5, date: "2025-01-01", tagline: "", url: null, key: "0123456789abcdef" },
        { n: 7, name: "Seven", amount: 9, date: "2025-02-01", tagline: "", url: null, key: "fedcba9876543210" }]),
    );
    const mock = await startMock([session({ email: "new@example.com", name: "New" })]);
    try {
      const r = await runSync({ api: mock.api, dir });
      assert.equal(r.code, 0, r.stderr);
      const ledger = readLedger(dir);
      assert.deepEqual(ledger.map((e) => e.n), [3, 7, 8]);
      assert.equal(ledger[2].name, "New");
    } finally {
      mock.server.close();
    }
  });
});

test("malicious name, tagline and url are sanitised", async () => {
  const mock = await startMock([
    session({
      email: "evil@example.com",
      name: `<img src=x onerror=alert(1)>\u0007Bo\u0000b\u001b\n${"N".repeat(500)}`,
      tagline: `<b>hi</b>\r\n\u0008${"t".repeat(200)}`,
      link: "javascript:alert(1)",
    }),
    session({ email: "two@example.com", name: "Two", link: "https://example.com/x_y~z" }),
    session({ email: "three@example.com", name: "Three", link: "https://evil.example/<script>" }),
  ]);
  try {
    await withEnv(async ({ dir }) => {
      const r = await runSync({ api: mock.api, dir });
      assert.equal(r.code, 0, r.stderr);
      const [evil, two, three] = readLedger(dir);
      assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(evil.name), "control chars in name");
      assert.ok(evil.name.length <= 40, `name too long: ${evil.name.length}`);
      assert.ok(evil.name.startsWith("<img src=x"), "name is kept as text, the site escapes it");
      assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(evil.tagline));
      assert.ok(evil.tagline.length <= 80);
      assert.equal(evil.url, null);
      assert.equal(two.url, "https://example.com/x_y~z");
      assert.equal(three.url, null);
      assert.equal(evil.n, 1);
    });
  } finally {
    mock.server.close();
  }
});

test("missing display_name falls back to Anonymous", async () => {
  const mock = await startMock([session({ email: "anon@example.com", name: "   \u0001  " })]);
  try {
    await withEnv(async ({ dir }) => {
      const r = await runSync({ api: mock.api, dir });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(readLedger(dir)[0].name, "Anonymous");
    });
  } finally {
    mock.server.close();
  }
});

test("Dashboard-made fields are matched by derived key or by label", async () => {
  const s = session({ email: "dash@example.com" });
  s.custom_fields = [
    { key: "displayname", type: "text", label: { type: "custom", custom: "Display name" }, text: { value: "Ada" } },
    { key: "abc123", type: "text", label: { type: "custom", custom: "Tagline" }, text: { value: "Hello" } },
    { key: "link", type: "text", label: { type: "custom", custom: "Link" }, text: { value: "https://example.com" } },
  ];
  const mock = await startMock([s]);
  try {
    await withEnv(async ({ dir }) => {
      const r = await runSync({ api: mock.api, dir });
      assert.equal(r.code, 0, r.stderr);
      const [e] = readLedger(dir);
      assert.equal(e.name, "Ada");
      assert.equal(e.tagline, "Hello");
      assert.equal(e.url, "https://example.com");
    });
  } finally {
    mock.server.close();
  }
});

test("HTTP 500 mid-pagination exits 1 and writes nothing", async () => {
  const sessions = [];
  for (let i = 0; i < 150; i++) sessions.push(session({ email: `p${i}@example.com`, name: `P${i}` }));
  const mock = await startMock(sessions, { failPage: 2 });
  try {
    await withEnv(async ({ dir }) => {
      writeFileSync(join(dir, "supporters.json"), "[]\n");
      const before = snapshot(dir);
      const r = await runSync({ api: mock.api, dir });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /HTTP 500/);
      assert.deepEqual(snapshot(dir), before);
    });
    // Also: a total outage with no existing files must not create any.
    const dead = await startMock([], { failPage: 1 });
    try {
      await withEnv(async ({ dir }) => {
        const r = await runSync({ api: dead.api, dir });
        assert.equal(r.code, 1);
        assert.deepEqual(readdirSync(dir), []);
      });
    } finally {
      dead.server.close();
    }
  } finally {
    mock.server.close();
  }
});

test("missing STRIPE_KEY exits 0 and changes nothing", async () => {
  await withEnv(async ({ dir }) => {
    const r = await runSync({ api: "http://127.0.0.1:9", dir, key: null });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /no STRIPE_KEY, nothing to do/);
    assert.deepEqual(readdirSync(dir), []);
  });
});

test("STRIPE_KEY without LEDGER_SALT fails closed", async () => {
  await withEnv(async ({ dir }) => {
    const r = await runSync({ api: "http://127.0.0.1:9", dir, salt: null });
    assert.equal(r.code, 1);
    assert.deepEqual(readdirSync(dir), []);
  });
});

test("the generated supporters.json is accepted by site/build.mjs", async () => {
  const mock = await startMock([
    session({ email: "b1@example.com", amount: 2500, name: "Build <i>One</i>", tagline: "hello", link: "https://example.com/one" }),
    session({ email: "b2@example.com", amount: 1000, name: "Two" }),
  ]);
  const copy = mkdtempSync(join(tmpdir(), "stripe-build-"));
  try {
    for (const d of ["site", "records"]) cpSync(join(ROOT, d), join(copy, d), { recursive: true });
    cpSync(join(ROOT, "AGENTS.md"), join(copy, "AGENTS.md"));
    mkdirSync(join(copy, "tools"), { recursive: true });
    cpSync(join(ROOT, "tools", "scoring.mjs"), join(copy, "tools", "scoring.mjs"));
    mkdirSync(join(copy, "checker"), { recursive: true });
    cpSync(join(ROOT, "checker", "notes.mjs"), join(copy, "checker", "notes.mjs"));
    const r = await runSync({ api: mock.api, dir: join(copy, "ledger") });
    assert.equal(r.code, 0, r.stderr);
    const built = await new Promise((ok) => {
      const child = spawn(process.execPath, [join(copy, "site", "build.mjs")], { cwd: copy, env: { ...process.env, GITHUB_SHA: "" } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => ok({ code, stdout, stderr }));
    });
    assert.equal(built.code, 0, built.stderr);
    assert.match(built.stdout, /2 supporters/);
    const html = readFileSync(join(copy, "dist", "index.html"), "utf8");
    assert.ok(html.includes("Build &lt;i&gt;One&lt;/i&gt;"), "build escapes names");
    assert.ok(!html.includes("<i>One</i>"));
  } finally {
    mock.server.close();
    rmSync(copy, { recursive: true, force: true });
  }
});
