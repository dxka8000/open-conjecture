// Stripe -> ledger/supporters.json sync for the sponsor wall. Zero dependencies (Node 20+).
// Env: STRIPE_KEY (restricted read-only key; absent = no-op), LEDGER_SALT (required with STRIPE_KEY),
// STRIPE_API (default https://api.stripe.com), LEDGER_DIR (default ledger/).
// Payment Link custom fields read: display_name, tagline, link.
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Same pattern as site/build.mjs (SUPPORTER_URL_RE). Keep them in step.
const SUPPORTER_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~/-]*)?$/;
const NAME_MAX = 40;
const TAG_MAX = 80;
const URL_MAX = 2048;
const MAX_PAGES = 20;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

const clean = (value, max) =>
  Array.from(String(value ?? "").replace(CONTROL_RE, "").trim()).slice(0, max).join("").trim();

const fieldText = (session, key) => {
  const field = (session.custom_fields || []).find((f) => f && f.key === key);
  const value = field && field.text ? field.text.value : null;
  return typeof value === "string" ? value : "";
};

const readJsonFile = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);

// Write through a temp file and rename, so a crash never leaves a half-written ledger.
function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

async function fetchCompleteSessions(api, key) {
  const base = api.replace(/\/+$/, "");
  const sessions = [];
  let startingAfter = null;
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages of sessions; refusing a partial sync`);
    const url = new URL(`${base}/v1/checkout/sessions`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("status", "complete");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Stripe API returned HTTP ${res.status}`);
    const body = await res.json();
    if (!body || !Array.isArray(body.data)) throw new Error("unexpected response from Stripe");
    sessions.push(...body.data);
    if (body.has_more !== true || body.data.length === 0) break;
    startingAfter = body.data[body.data.length - 1].id;
  }
  return sessions;
}

async function main() {
  const env = process.env;
  const STRIPE_KEY = env.STRIPE_KEY || "";
  if (!STRIPE_KEY) {
    console.log("no STRIPE_KEY, nothing to do");
    return;
  }
  const salt = env.LEDGER_SALT || "";
  if (!salt) throw new Error("LEDGER_SALT is required when STRIPE_KEY is set");
  const api = env.STRIPE_API || "https://api.stripe.com";
  const dir = resolve(ROOT, env.LEDGER_DIR || "ledger");
  const supportersPath = join(dir, "supporters.json");
  const processedPath = join(dir, "processed.json");

  const sessions = await fetchCompleteSessions(api, STRIPE_KEY);
  const paid = sessions
    .filter((s) => s && s.payment_status === "paid" && s.currency === "usd")
    .sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // oldest first, so later payments win

  // Existing ledger. Amounts are kept in integer cents while merging.
  const existing = readJsonFile(supportersPath, []);
  if (!Array.isArray(existing)) throw new Error("ledger/supporters.json must be an array");
  const entries = existing.map((e) => ({
    n: Number(e.n),
    name: String(e.name ?? ""),
    cents: Math.round(Number(e.amount) * 100),
    date: String(e.date ?? ""),
    tagline: String(e.tagline ?? ""),
    url: typeof e.url === "string" ? e.url : null,
    key: typeof e.key === "string" ? e.key : undefined,
  }));
  const processedList = readJsonFile(processedPath, []);
  if (!Array.isArray(processedList)) throw new Error("ledger/processed.json must be an array");
  const processed = new Set(processedList);

  const byKey = new Map(entries.filter((e) => e.key).map((e) => [e.key, e]));
  let nextN = entries.reduce((m, e) => Math.max(m, e.n), 0) + 1;
  let newPayments = 0;
  let newSupporters = 0;
  let skipped = 0;

  for (const s of paid) {
    if (processed.has(s.id)) continue;
    const email = s.customer_details && s.customer_details.email;
    const cents = s.amount_total;
    const date = Number.isFinite(s.created) ? new Date(s.created * 1000).toISOString().slice(0, 10) : "";
    if (typeof email !== "string" || !email.trim() || !Number.isInteger(cents) || cents <= 0 || !date) {
      skipped++;
      continue;
    }
    // Pseudonymous identity. The email itself is never stored or printed.
    const key = createHmac("sha256", salt).update(email.toLowerCase()).digest("hex").slice(0, 16);
    const name = clean(fieldText(s, "display_name"), NAME_MAX);
    const tagline = clean(fieldText(s, "tagline"), TAG_MAX);
    const link = clean(fieldText(s, "link"), URL_MAX);

    let e = byKey.get(key);
    if (!e) {
      e = { n: nextN++, name: "", cents: 0, date, tagline: "", url: null, key };
      entries.push(e);
      byKey.set(key, e);
      newSupporters++;
    }
    e.cents += cents;
    e.date = date; // oldest first, so this is the latest payment date
    if (name) e.name = name;
    if (tagline) e.tagline = tagline;
    if (SUPPORTER_URL_RE.test(link)) e.url = link;
    e.name = e.name || "Anonymous";
    processed.add(s.id);
    processedList.push(s.id);
    newPayments++;
  }

  const supportersOut = JSON.stringify(
    entries.map((e) => ({
      n: e.n,
      name: e.name || "Anonymous",
      amount: e.cents / 100,
      date: e.date,
      tagline: e.tagline,
      url: e.url,
      ...(e.key ? { key: e.key } : {}),
    })),
    null,
    2,
  ) + "\n";
  const processedOut = JSON.stringify(processedList, null, 2) + "\n";

  const supportersChanged = !existsSync(supportersPath) || readFileSync(supportersPath, "utf8") !== supportersOut;
  const processedChanged = !existsSync(processedPath) || readFileSync(processedPath, "utf8") !== processedOut;

  if (!supportersChanged && !processedChanged) {
    console.log(`stripe sync: no changes (${paid.length} paid usd sessions checked)`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  if (supportersChanged) writeAtomic(supportersPath, supportersOut);
  if (processedChanged) writeAtomic(processedPath, processedOut);
  console.log(
    `stripe sync: ${newPayments} new payments, ${newSupporters} new supporters, ` +
      `${entries.length} supporters total${skipped ? `, ${skipped} skipped` : ""}`,
  );
}

main().catch((err) => {
  console.error(`stripe sync failed: ${err.message}`);
  process.exitCode = 1;
});
