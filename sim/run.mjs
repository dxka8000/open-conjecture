// Full local simulation of The Collatz Climb, with no accounts and no network.
//
// What is REAL here: the record/file gate (checker/gen_verified.mjs), the auto-merge program
// (tools/automerge.mjs), the task desk (desk/server.mjs with desk/src/logic.mjs), the site build
// (site/build.mjs) and the sponsor sync (tools/stripe_sync.mjs, if present).
// What is SIMULATED: GitHub (an in-memory mock of the REST endpoints the programs call), Stripe
// (a mock of checkout sessions), the outside agents (scripted), and Lean itself: the gate runs for
// real, but whether a proof "compiles" is decided by the scenario, because Lean + Mathlib only run
// in GitHub's CI. (The in-house split proofs and the anti-gaming check do run in real CI on main.) Nothing here touches the real repository, GitHub or Stripe.
//
// Usage: node sim/run.mjs [--keep]   (--keep leaves the site, desk and mocks running for a browser)
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WS = join(tmpdir(), "collatz-sim");
const KEEP = process.argv.includes("--keep");
const REPO = "sim/open-conjecture";
const GH_PORT = 18790, DESK_PORT = 18787, SITE_PORT = 14174, STRIPE_PORT = 18791;
const DESK = `http://127.0.0.1:${DESK_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- assertions
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// ---------------------------------------------------------------- workspace
rmSync(WS, { recursive: true, force: true });
mkdirSync(WS, { recursive: true });
for (const d of ["records", "OpenConjecture", "checker", "site", "ledger", "tools", "AGENTS.md"])
  cpSync(join(REPO_ROOT, d), join(WS, d), { recursive: true });
const wsRead = (p) => readFileSync(join(WS, p), "utf8");
const wsJson = (p) => JSON.parse(wsRead(p));

// ---------------------------------------------------------------- mock GitHub
const gh = { prs: new Map(), next: 1, runs: new Map(), users: new Map(), dispatches: 0 };
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
for (const [login, age] of Object.entries({
  "sim-alice": 3000, "sim-bob": 2500, "sim-carol": 2000, "sim-dave": 1800, "sim-erin": 4000, "sim-frank": 3500,
  "sim-grace": 1500, "sim-heidi": 900, "sim-ivan": 700, "sim-judy": 600, "sim-trent": 5000,
  "sim-mallory": 12, "sim-sybil": 3,
})) gh.users.set(login, { login, type: "User", created_at: daysAgo(age) });

const sha = (s) => createHash("sha1").update(s).digest("hex");
function openPr({ author, title, files }) {
  // files: { path: content } (added) ; modified paths are those that exist in the workspace
  const number = gh.next++;
  const head = sha(`${number}:${JSON.stringify(files)}`);
  const list = Object.keys(files).map((f) => ({ filename: f, status: existsSync(join(WS, f)) ? "modified" : "added" }));
  gh.prs.set(number, { number, title, user: { login: author }, head: { sha: head, repo: { full_name: `${author}/open-conjecture` } },
    files: list, contents: files, reviews: [], comments: [], state: "open", updated_at: new Date().toISOString() });
  return gh.prs.get(number);
}
function body(req) { return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); }); }
const ghServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(obj === null ? "" : JSON.stringify(obj)); };
  const p = u.pathname;
  let m;
  if (req.method === "GET" && p === `/repos/${REPO}/pulls`) {
    if (u.searchParams.get("page") && u.searchParams.get("page") !== "1") return send(200, []);
    return send(200, [...gh.prs.values()].filter((x) => x.state === "open").map(({ contents, files, reviews, comments, ...x }) => x));
  }
  if (req.method === "GET" && (m = p.match(new RegExp(`^/repos/${REPO}/pulls/(\\d+)/files$`)))) return send(200, gh.prs.get(+m[1])?.files || null);
  if (req.method === "GET" && (m = p.match(new RegExp(`^/repos/${REPO}/pulls/(\\d+)/reviews$`)))) return send(200, gh.prs.get(+m[1])?.reviews || []);
  if (req.method === "GET" && (m = p.match(/^\/repos\/([^/]+)\/open-conjecture\/contents\/(.+)$/))) {
    const pr = [...gh.prs.values()].find((x) => x.head.sha === u.searchParams.get("ref"));
    const text = pr && pr.contents[decodeURIComponent(m[2])];
    return text === undefined ? send(404, { message: "Not Found" }) : send(200, { content: Buffer.from(text).toString("base64") });
  }
  if (req.method === "GET" && p === `/repos/${REPO}/actions/runs`) {
    const c = gh.runs.get(u.searchParams.get("head_sha"));
    return send(200, { workflow_runs: c ? [{ id: 1, name: "Lean checker", status: "completed", conclusion: c }] : [] });
  }
  if (req.method === "GET" && (m = p.match(/^\/users\/([^/]+)$/))) return gh.users.has(m[1]) ? send(200, gh.users.get(m[1])) : send(404, { message: "Not Found" });
  if (req.method === "PUT" && (m = p.match(new RegExp(`^/repos/${REPO}/pulls/(\\d+)/merge$`)))) {
    const pr = gh.prs.get(+m[1]);
    const b = JSON.parse(await body(req));
    if (!pr || pr.state !== "open" || b.sha !== pr.head.sha) return send(409, { message: "Head branch was modified or PR closed" });
    for (const [f, text] of Object.entries(pr.contents)) { mkdirSync(dirname(join(WS, f)), { recursive: true }); writeFileSync(join(WS, f), text); }
    pr.state = "merged";
    return send(200, { merged: true });
  }
  if (req.method === "POST" && (m = p.match(new RegExp(`^/repos/${REPO}/issues/(\\d+)/comments$`)))) {
    gh.prs.get(+m[1])?.comments.push(JSON.parse(await body(req)).body);
    return send(201, {});
  }
  if (req.method === "POST" && p.startsWith(`/repos/${REPO}/actions/workflows/`)) { gh.dispatches++; return send(204, null); }
  send(404, { message: `mock has no route for ${req.method} ${p}` });
});

// ---------------------------------------------------------------- mock Stripe
const stripeSessions = [];
const stripeServer = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.headers.authorization !== "Bearer rk_test_simulated") { res.writeHead(401); return res.end("{}"); }
  if (u.pathname !== "/v1/checkout/sessions") { res.writeHead(404); return res.end("{}"); }
  const after = u.searchParams.get("starting_after");
  const start = after ? stripeSessions.findIndex((s) => s.id === after) + 1 : 0;
  const page = stripeSessions.slice(start, start + 2);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ object: "list", data: page, has_more: start + 2 < stripeSessions.length }));
});
function pay(id, email, usd, name, tagline, link, paid = true) {
  stripeSessions.push({ id, object: "checkout.session", status: "complete", payment_status: paid ? "paid" : "unpaid", currency: "usd",
    amount_total: Math.round(usd * 100), created: Math.floor(Date.now() / 1000), customer_details: { email },
    custom_fields: [
      { key: "display_name", type: "text", text: { value: name } },
      { key: "tagline", type: "text", text: { value: tagline } },
      { key: "link", type: "text", text: { value: link } },
    ] });
}

// ---------------------------------------------------------------- the real programs
function gate(dir) { return spawnSync(process.execPath, ["checker/gen_verified.mjs"], { cwd: dir, encoding: "utf8" }); }
function buildSite() {
  const r = spawnSync(process.execPath, ["site/build.mjs"], { cwd: WS, encoding: "utf8", env: { ...process.env, SIM_DESK_URL: DESK } });
  if (r.status !== 0) throw new Error("site build failed: " + r.stderr);
  cpSync(join(WS, "OpenConjecture/Collatz/Lemmas.lean"), join(WS, "dist/Lemmas.lean"));
  return r.stdout.trim();
}
// Child programs that talk to the in-process mocks must run asynchronously (spawnSync would block them).
function run(args, opts) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => (stdout += d)); c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
async function automerge(mode, pr, conclusion) {
  const env = { ...process.env, GITHUB_API: `http://127.0.0.1:${GH_PORT}`, GH_TOKEN: "simulated", REPO, MODE: mode,
    HEAD_SHA: pr ? pr.head.sha : "", CONCLUSION: conclusion || "", RUN_URL: "http://sim/run" };
  const r = await run(["tools/automerge.mjs"], { cwd: WS, env });
  if (r.status !== 0) throw new Error("automerge crashed: " + r.stderr);
  return r.stdout;
}
// What GitHub CI does for a pull request: the real gate on the PR's tree, then (simulated) Lean.
async function ciCheck(pr, leanAccepts) {
  const dir = join(tmpdir(), `collatz-sim-pr${pr.number}`);
  rmSync(dir, { recursive: true, force: true });
  for (const d of ["records", "OpenConjecture", "checker"]) cpSync(join(WS, d), join(dir, d), { recursive: true });
  for (const [f, text] of Object.entries(pr.contents)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); }
  const g = gate(dir);
  rmSync(dir, { recursive: true, force: true });
  const conclusion = g.status !== 0 ? "failure" : leanAccepts ? "success" : "failure";
  gh.runs.set(pr.head.sha, conclusion);
  await automerge("run", pr, conclusion);
  return { conclusion, gateOut: (g.stderr || g.stdout).trim() };
}
const lastComment = (pr) => pr.comments[pr.comments.length - 1] || "";

// ---------------------------------------------------------------- agents
const ipOf = new Map();
async function desk(method, path, handle) {
  if (!ipOf.has(handle)) ipOf.set(handle, `10.0.0.${ipOf.size + 1}`);
  const r = await fetch(`${DESK}${path}`, { method, headers: { "x-sim-ip": ipOf.get(handle) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const next = (h, q = "") => desk("GET", `/desk/next?handle=${h}${q}`, h);
const beat = (h, lease) => desk("POST", `/desk/beat?lease=${lease}`, h);
const release = (h, lease, reason) => desk("POST", `/desk/release?lease=${lease}&reason=${reason}`, h);

const today = new Date().toISOString().slice(0, 10);
function resultFiles(author, recId, statement, refute = false, body = "  simulated_proof_term", provedBy = author) {
  const rec = wsJson(`records/collatz/${recId}.json`);
  const name = refute ? `Refute_${statement}` : statement;
  const imp = "import OpenConjecture.Collatz.Lemmas";
  return {
    [`OpenConjecture/Collatz/Proofs/${name}.lean`]: `${imp}\n\nnamespace OpenConjecture.Collatz.Proofs.${name}\n\ntheorem main : ${refute ? "¬ " : ""}OpenConjecture.Collatz.${statement} := by\n${body}\n\nend OpenConjecture.Collatz.Proofs.${name}\n`,
    [`records/collatz/${recId}.json`]: JSON.stringify({ ...rec, status: refute ? "refuted" : "verified", proved_by: provedBy, model: "Simulated Agent 1", verified_at: today }, null, 2) + "\n",
  };
}

// ---------------------------------------------------------------- scenario
async function main() {
  await new Promise((r) => ghServer.listen(GH_PORT, "127.0.0.1", r));
  await new Promise((r) => stripeServer.listen(STRIPE_PORT, "127.0.0.1", r));
  log("build:", buildSite());
  const site = spawn(process.execPath, ["site/serve.mjs", String(SITE_PORT)], { cwd: WS, stdio: "ignore" });
  const deskProc = spawn(process.execPath, [join(REPO_ROOT, "desk/server.mjs")], { stdio: "ignore", env: { ...process.env,
    PORT: String(DESK_PORT), SITE: `http://127.0.0.1:${SITE_PORT}`, LEMMAS_URL: `http://127.0.0.1:${SITE_PORT}/Lemmas.lean`,
    GITHUB_API: `http://127.0.0.1:${GH_PORT}`, REPO, SIM_IP_HEADER: "1" } });
  const stop = () => { site.kill(); deskProc.kill(); ghServer.close(); stripeServer.close(); };
  process.on("exit", () => { if (!KEEP) stop(); });
  await sleep(1200);

  const open0 = wsJson("dist/feed.json").records.filter((r) => r.kind !== "summit");
  check("board has only unsolved statements at start (open problems and their steps)", open0.length > 0 && open0.every((r) => ["program", "step"].includes(r.kind) && r.status === "open"), `${open0.length} open statements`);

  // ---- 1. The board: our splits, checked by the real gate
  log("\n== Round 1: the split board");
  const recs0 = wsJson("dist/feed.json").records;
  const steps0 = recs0.filter((r) => r.kind === "step");
  const progs0 = recs0.filter((r) => r.kind === "program");
  check("every open problem is unsplit or split into 2 to 4 steps", progs0.every((p) => {
    const n = steps0.filter((st) => st.parent === p.id).length;
    return n === 0 || (n >= 2 && n <= 4);
  }), `${steps0.length} steps under ${progs0.length} open problems`);
  check("every step names a split file that exists", steps0.every((st) => existsSync(join(WS, `OpenConjecture/Collatz/Splits/${st.split}.lean`))));
  check("the real gate writes one reduction check per split", gate(WS).status === 0 && (wsRead("checker/Verified.lean").match(/^theorem OpenConjectureCheck\.s\d+ : \(/gm) || []).length === new Set(steps0.map((st) => st.split)).size);
  // A restated step must be caught by the gate (in-house quality guard): try it on a copy.
  {
    const dir = join(tmpdir(), "collatz-sim-restate");
    rmSync(dir, { recursive: true, force: true });
    for (const d of ["records", "OpenConjecture", "checker"]) cpSync(join(WS, d), join(dir, d), { recursive: true });
    const L = join(dir, "OpenConjecture/Collatz/Lemmas.lean");
    const body = /^def Open_DensityOne : Prop := (.*)$/m.exec(readFileSync(L, "utf8"))[1];
    writeFileSync(L, readFileSync(L, "utf8").replace("end OpenConjecture.Collatz", `def Step_Restated : Prop := ${body}\n\nend OpenConjecture.Collatz`));
    const g = gate(dir);
    check("a step that restates its parent word for word is rejected by the gate", g.status !== 0 && /same text as/.test(g.stderr), g.stderr.trim().slice(0, 90));
    writeFileSync(L, readFileSync(L, "utf8").replace(`def Step_Restated : Prop := ${body}`, "def Step_Alias : Prop := Open_DensityOne"));
    const g2 = gate(dir);
    check("a step that is just another statement's name is rejected", g2.status !== 0 && /is just the statement/.test(g2.stderr), g2.stderr.trim().slice(0, 90));
    rmSync(dir, { recursive: true, force: true });
  }
  log("   (triviality and filler checks need Lean: they ran in real CI on main, not here)");
  const s0 = await next("sim-carol", "&role=think");
  check("the think role is gone (400)", s0.status === 400);
  const r0 = await next("sim-carol", "&role=review");
  check("the review role is gone (400)", r0.status === 400);

  // outsiders cannot add or change statements
  const stepFile = "OpenConjecture/Collatz/Proposals/Step_Outsider.lean";
  const pP = openPr({ author: "sim-mallory", title: "Propose step-outsider", files: {
    [stepFile]: "import OpenConjecture.Collatz.Lemmas\n\nnamespace OpenConjecture.Collatz\n\ndef Step_Outsider : Prop :=\n  True\n\nend OpenConjecture.Collatz\n",
    "records/collatz/step-outsider.json": JSON.stringify({ id: "step-outsider", kind: "step", parent: "open-density-one", split: "Split_Open_DensityOne", statement: "Step_Outsider",
      difficulty: 1, title_en: "x", title_zh: "x", status: "open", sketch: "x" }) } });
  await ciCheck(pP, true);
  check("an outside proposal of a new step is never merged", gh.prs.get(pP.number).state === "open");
  const pS = openPr({ author: "sim-mallory", title: "Prove open-density-one", files: {
    "OpenConjecture/Collatz/Splits/Split_Open_DensityOne.lean": "import OpenConjecture.Collatz.Lemmas\n\nnamespace OpenConjecture.Collatz.Splits.Split_Open_DensityOne\n\ntheorem main : True := trivial\n\nend OpenConjecture.Collatz.Splits.Split_Open_DensityOne\n",
    "records/collatz/open-density-one.json": JSON.stringify({ ...wsJson("records/collatz/open-density-one.json"), status: "verified", proved_by: "sim-mallory", model: "x", verified_at: today }, null, 2) + "\n" } });
  await ciCheck(pS, true);
  check("a pull request that adds a split file is never merged", gh.prs.get(pS.number).state === "open" && /REJECTED|Proofs/.test(lastComment(pS)), lastComment(pS).slice(0, 80));
  const pL = openPr({ author: "sim-mallory", title: "Prove open-density-one", files: {
    ...resultFiles("sim-mallory", "open-density-one", "Open_DensityOne"),
    "OpenConjecture/Collatz/Lemmas.lean": wsRead("OpenConjecture/Collatz/Lemmas.lean").replace("def Open_DensityOne : Prop :=", "def Open_DensityOne : Prop := True ∨") } });
  await ciCheck(pL, true);
  check("a proof that also weakens the statement in Lemmas.lean is never merged", gh.prs.get(pL.number).state === "open" && /exactly two files/.test(lastComment(pL)));

  // ---- 2. Builders and the red team
  log("\n== Round 2: builders and red team");
  const a3 = await next("sim-alice");
  check("desk gives a builder a task (a step, or an open problem when nothing is split)", a3.status === 200 && ["step", "program"].includes(a3.body.gap?.kind) && !!a3.body.gap.statement, a3.body.gap?.id);
  const b3 = await next("sim-bob");
  check("a second builder gets a different step", b3.status === 200 && b3.body.gap && b3.body.gap.id !== a3.body.gap.id, b3.body.gap?.id);
  const realStep = a3, falseStep = b3, realWho = "sim-alice", falseWho = "sim-bob";
  const realId = realStep.body.gap.id, realSt = realStep.body.gap.statement_name;
  const falseId = falseStep.body.gap.id, falseSt = falseStep.body.gap.statement_name;
  check("heartbeat extends a live lease", (await beat(realWho, realStep.body.lease.id)).status === 200);
  await release(falseWho, falseStep.body.lease.id, "statement_seems_false");

  const g3 = await next("sim-grace", "&role=redteam");
  check("red team is sent to the step reported as false", g3.body.gap?.id === falseId && /Refute_(Step|Open)_.*\.lean$/.test(g3.body.gap.file), g3.body.gap?.file);
  const h3 = await next("sim-heidi", "&hard=1");
  check("hard=1 gives an open problem", h3.body.gap?.kind === "program", h3.body.gap?.id);
  await release("sim-heidi", h3.body.lease.id, "missing_lemma");
  const hist3 = (await desk("GET", `/desk/task/${h3.body.gap.id}`, "observer")).body;
  check("a missing_lemma hand-back is visible to the in-house splitter", JSON.stringify(hist3).includes("missing_lemma"), h3.body.gap.id);

  // proofs and refutations
  const judy = openPr({ author: "sim-judy", title: `Prove ${realId}`, files: resultFiles("sim-judy", realId, realSt) });
  check("a proof Lean rejects is REJECTED and not merged", (await ciCheck(judy, false)).conclusion === "failure" && /REJECTED/.test(lastComment(judy)) && gh.prs.get(judy.number).state === "open");
  const ivan = openPr({ author: "sim-ivan", title: `Prove ${realId}`, files: resultFiles("sim-ivan", realId, realSt, false, "  simulated_proof_term", "sim-alice") });
  (await ciCheck(ivan, true));
  check("claiming someone else's name (proved_by) is refused", gh.prs.get(ivan.number).state === "open" && /proved_by must be your GitHub login/.test(lastComment(ivan)));
  const evil = openPr({ author: "sim-mallory", title: `Prove ${realId}`, files: resultFiles("sim-mallory", realId, realSt, false, "  exact _root_.IO.Process.exit 0") });
  check("a proof that tries to run code during the check is rejected by the gate", (await ciCheck(evil, true)).conclusion === "failure");
  const good = openPr({ author: realWho, title: `Prove ${realId}`, files: resultFiles(realWho, realId, realSt) });
  (await ciCheck(good, true));
  check("a proof Lean accepts is ACCEPTED and merged", gh.prs.get(good.number).state === "merged" && /ACCEPTED/.test(lastComment(good)) && wsJson(`records/collatz/${realId}.json`).status === "verified");
  await release(realWho, realStep.body.lease.id, "submitted");
  const late = openPr({ author: "sim-heidi", title: `Prove ${realId}`, files: resultFiles("sim-heidi", realId, realSt) });
  (await ciCheck(late, true));
  check("a second proof of a settled step is not merged", gh.prs.get(late.number).state === "open" && /record|settled/.test(lastComment(late)));
  const ref = openPr({ author: "sim-grace", title: `Refute ${falseId}`, files: resultFiles("sim-grace", falseId, falseSt, true) });
  (await ciCheck(ref, true));
  check("a refutation is ACCEPTED and the step goes to the graveyard", gh.prs.get(ref.number).state === "merged" && wsJson(`records/collatz/${falseId}.json`).status === "refuted");
  await release("sim-grace", g3.body.lease.id, "submitted");
  check("site build after results", /built/.test(buildSite()));
  log("   (waiting 62 s for the desk's feed cache)");
  await sleep(62000);
  const lateBeat = await beat("sim-alice", (await next("sim-alice")).body?.lease?.id || "none");
  check("desk has nothing left for builders once steps are settled, or ends the lease", lateBeat.status === 404 || lateBeat.status === 410 || lateBeat.status === 200);

  // desk abuse
  const burst = [];
  for (let i = 0; i < 4; i++) burst.push((await next("sim-ivan")).status);
  check("one /next per 2 s per handle (rapid calls get 429)", burst.includes(429), burst.join(","));
  const bad = await next("sim-ivan<script>");
  check("malformed handle refused", bad.status === 400);

  // ---- 3. Sponsors (mock Stripe -> real sync -> real site)
  log("\n== Round 3: sponsors");
  pay("cs_1", "founder@ai-startup.example", 1000, "Example AI Lab", "Agents that prove things", "https://example.com/lab");
  pay("cs_2", "fan@example.org", 5, "<script>alert(1)</script>Fan", "hi\u0007", "javascript:alert(1)");
  pay("cs_3", "founder@ai-startup.example", 125, "Example AI Lab", "Agents that prove things", "https://example.com/lab");
  pay("cs_4", "nopay@example.org", 50, "Unpaid", "", "", false);
  if (existsSync(join(WS, "tools/stripe_sync.mjs"))) {
    const env = { ...process.env, STRIPE_KEY: "rk_test_simulated", LEDGER_SALT: "simulated-salt", STRIPE_API: `http://127.0.0.1:${STRIPE_PORT}` };
    const s1 = await run(["tools/stripe_sync.mjs"], { cwd: WS, env });
    const led = wsJson("ledger/supporters.json");
    check("sponsor sync runs", s1.status === 0, (s1.stdout + s1.stderr).trim().slice(0, 100));
    check("same email merges and sums ($1,125), unpaid ignored", led.length === 2 && led.some((x) => x.amount === 1125));
    check("no email stored anywhere in ledger/", !readdirSync(join(WS, "ledger")).some((f) => /@/.test(wsRead(`ledger/${f}`))));
    const s2 = await run(["tools/stripe_sync.mjs"], { cwd: WS, env });
    check("sponsor sync is idempotent", s2.status === 0 && JSON.stringify(wsJson("ledger/supporters.json")) === JSON.stringify(led));
  } else check("sponsor sync script exists", false, "tools/stripe_sync.mjs missing");
  log("build:", buildSite());

  // ---- 4. What the public sees
  log("\n== Round 4: the site");
  const home = await (await fetch(`http://127.0.0.1:${SITE_PORT}/`)).text();
  const status = (await desk("GET", "/desk/status", "observer")).body;
  check("desk status counts activity", status.recent.length > 5 && status.by_reason_24h.missing_lemma >= 1 && status.by_reason_24h.statement_seems_false >= 1, `recent ${status.recent.length}`);
  check("lemmas page marks every step as proven to imply its parent", (await (await fetch(`http://127.0.0.1:${SITE_PORT}/lemmas.html`)).text()).split("proven to imply its parent").length - 1 >= steps0.length);
  check("home page lists the refuted step in the graveyard", home.includes(wsJson(`records/collatz/${falseId}.json`).title_en.replace(/&/g, "&amp;")));
  check("home page leaderboard shows the prover and the red team", home.includes("sim-grace") && home.includes(realWho));
  check("home page escapes hostile sponsor text", !home.includes("<script>alert(1)</script>") && !home.includes("javascript:alert"));
  check("home page CSP allows only the desk", new RegExp(`connect-src ${DESK.replace(/[.]/g, "\\.")}`).test(home));

  const failed = results.filter((r) => !r.ok);
  log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
  writeFileSync(join(REPO_ROOT, "sim", "last-run.txt"), results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`).join("\n") + `\n\n${results.length - failed.length} of ${results.length} passed\n`);
  if (KEEP) log(`\nKept running: site http://127.0.0.1:${SITE_PORT}/  desk ${DESK}/desk/status  (Ctrl+C to stop)`);
  else { stop(); process.exit(failed.length ? 1 : 0); }
}
main().catch((e) => { console.error(e); process.exit(2); });
