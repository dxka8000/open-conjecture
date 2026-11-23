// Full local simulation of The Collatz Climb, with no accounts and no network.
//
// What is REAL here: the record/file gate (checker/gen_verified.mjs), the auto-merge program
// (tools/automerge.mjs), the task desk (desk/server.mjs with desk/src/logic.mjs), the site build
// (site/build.mjs) and the sponsor sync (tools/stripe_sync.mjs, if present).
// What is SIMULATED: GitHub (an in-memory mock of the REST endpoints the programs call), Stripe
// (a mock of checkout sessions), the outside agents (scripted), and Lean itself: the gate runs for
// real, but whether a proof "compiles" is decided by the scenario, because Lean + Mathlib only run
// in GitHub's CI. Nothing here touches the real repository, GitHub or Stripe.
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
const GH_PORT = 8790, DESK_PORT = 8787, SITE_PORT = 4174, STRIPE_PORT = 8791;
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
function automerge(mode, pr, conclusion) {
  const env = { ...process.env, GITHUB_API: `http://127.0.0.1:${GH_PORT}`, GH_TOKEN: "simulated", REPO, MODE: mode,
    HEAD_SHA: pr ? pr.head.sha : "", CONCLUSION: conclusion || "", RUN_URL: "http://sim/run" };
  const r = spawnSync(process.execPath, ["tools/automerge.mjs"], { cwd: WS, encoding: "utf8", env });
  if (r.status !== 0) throw new Error("automerge crashed: " + r.stderr);
  return r.stdout;
}
// What GitHub CI does for a pull request: the real gate on the PR's tree, then (simulated) Lean.
function ciCheck(pr, leanAccepts) {
  const dir = join(tmpdir(), `collatz-sim-pr${pr.number}`);
  rmSync(dir, { recursive: true, force: true });
  for (const d of ["records", "OpenConjecture", "checker"]) cpSync(join(WS, d), join(dir, d), { recursive: true });
  for (const [f, text] of Object.entries(pr.contents)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); }
  const g = gate(dir);
  rmSync(dir, { recursive: true, force: true });
  const conclusion = g.status !== 0 ? "failure" : leanAccepts ? "success" : "failure";
  gh.runs.set(pr.head.sha, conclusion);
  automerge("run", pr, conclusion);
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
function proposalFiles(author, id, name, parent, def, sketch, extraFiles = {}) {
  return {
    [`OpenConjecture/Collatz/Proposals/${name}.lean`]: `import OpenConjecture.Collatz.Lemmas\n\nnamespace OpenConjecture.Collatz\n\ndef ${name} : Prop :=\n  ${def}\n\nend OpenConjecture.Collatz\n`,
    [`records/collatz/${id}.json`]: JSON.stringify({ id, kind: "step", parent, statement: name, difficulty: 120,
      title_en: `Simulated step ${id}`, title_zh: `模拟步骤 ${id}`, status: "open",
      sketch: `SIMULATION. ${sketch}`, proposed_by: author }, null, 2) + "\n",
    ...extraFiles,
  };
}
function resultFiles(author, recId, statement, refute = false, body = "  simulated_proof_term", provedBy = author) {
  const rec = wsJson(`records/collatz/${recId}.json`);
  const name = refute ? `Refute_${statement}` : statement;
  const imp = statement.startsWith("Step_") ? `import OpenConjecture.Collatz.Proposals.${statement}` : "import OpenConjecture.Collatz.Lemmas";
  return {
    [`OpenConjecture/Collatz/Proofs/${name}.lean`]: `${imp}\n\nnamespace OpenConjecture.Collatz.Proofs.${name}\n\ntheorem main : ${refute ? "¬ " : ""}OpenConjecture.Collatz.${statement} := by\n${body}\n\nend OpenConjecture.Collatz.Proofs.${name}\n`,
    [`records/collatz/${recId}.json`]: JSON.stringify({ ...rec, status: refute ? "refuted" : "verified", proved_by: provedBy, model: "Simulated Agent 1", verified_at: today }, null, 2) + "\n",
  };
}
function review(pr, login, state) { pr.reviews.push({ user: { login }, state, commit_id: pr.head.sha }); }

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
  check("board has only open problems at start", open0.length > 0 && open0.every((r) => r.kind === "program" && r.status === "open"), `${open0.length} open problems`);

  // ---- 1. Thinkers split open problems
  log("\n== Round 1: thinkers propose steps");
  const c1 = await next("sim-carol", "&role=think");
  check("desk gives a thinker an open problem", c1.status === 200 && c1.body.gap?.kind === "program" && c1.body.gap.role === "think", c1.body.gap?.id);
  const d1 = await next("sim-dave", "&role=think");
  check("second thinker gets a task too (thinkers may share)", d1.status === 200 && !!d1.body.gap, d1.body.gap?.id);
  const s0 = await next("sim-carol", "&role=summit");
  check("unknown role is refused", s0.status === 400);

  const pA = openPr({ author: "sim-carol", title: "Propose step-sim-a", files: proposalFiles("sim-carol", "step-sim-a", "Step_SimA", c1.body.gap.id,
    "∀ n : ℕ, n < 2 ^ 10 → 0 < n → Reaches n", "A finite case of the parent, to test the method.") });
  check("proposal A passes the gate and waits for review", ciCheck(pA, true).conclusion === "success" && /Waiting for review/.test(lastComment(pA)));
  await release("sim-carol", c1.body.lease.id, "submitted");

  const pB = openPr({ author: "sim-dave", title: "Propose step-sim-b", files: proposalFiles("sim-dave", "step-sim-b", "Step_SimB", d1.body.gap.id,
    "∀ n : ℕ, 0 < n → n < 7", "Deliberately false, for the red team to refute.") });
  check("proposal B passes the gate and waits", ciCheck(pB, true).conclusion === "success" && /Waiting for review/.test(lastComment(pB)));
  await release("sim-dave", d1.body.lease.id, "submitted");

  // attacks on the proposal path
  const pX = openPr({ author: "sim-mallory", title: "Propose step-evil", files: proposalFiles("sim-mallory", "step-evil", "Step_Evil", "open-density-one",
    "by run_tac pure ()", "attack") });
  const rx = ciCheck(pX, true);
  check("metaprogramming in a proposal is rejected by the gate", rx.conclusion === "failure" && /REJECTED/.test(lastComment(pX)), rx.gateOut.slice(0, 90));
  const pY = openPr({ author: "sim-mallory", title: "Propose step-sneaky", files: proposalFiles("sim-mallory", "step-sneaky", "Step_Sneaky", "open-density-one",
    "True", "also edits the board", { "OpenConjecture/Collatz/Lemmas.lean": wsRead("OpenConjecture/Collatz/Lemmas.lean") + "\n-- changed\n" }) });
  ciCheck(pY, true);
  check("a pull request touching three files is never merged", gh.prs.get(pY.number).state === "open" && /exactly two files/.test(lastComment(pY)));
  const pZ = openPr({ author: "sim-mallory", title: "Propose step-summit-child", files: proposalFiles("sim-mallory", "step-summit-child", "Step_SummitChild", "summit-collatz", "True", "parent is a summit") });
  check("a step hung directly on a summit is rejected", ciCheck(pZ, true).conclusion === "failure");

  // ---- 2. Reviewers
  log("\n== Round 2: reviewers");
  const e1 = await next("sim-erin", "&role=review");
  check("desk hands a reviewer an open proposal", e1.status === 200 && e1.body.gap?.role === "review" && /^pr-\d+$/.test(e1.body.gap.id), e1.body.gap?.id);
  const c2 = await next("sim-carol", "&role=review");
  check("a proposer is not handed their own proposal first", c2.body.gap?.pr !== pA.number, c2.body.gap?.id);
  review(pA, "sim-carol", "APPROVED"); // self-approval, must not count
  review(pA, "sim-mallory", "APPROVED"); // account 12 days old, must not count
  review(pA, "sim-erin", "APPROVED");
  automerge("sweep");
  check("self-approval and a 12-day-old account do not count (1 qualified approval: not merged)", gh.prs.get(pA.number).state === "open");
  review(pA, "sim-frank", "APPROVED");
  review(pB, "sim-trent", "APPROVED");
  review(pB, "sim-erin", "APPROVED");
  review(pB, "sim-sybil", "CHANGES_REQUESTED"); // unqualified, ignored
  automerge("sweep");
  check("two qualified approvals merge proposal A", gh.prs.get(pA.number).state === "merged" && existsSync(join(WS, "records/collatz/step-sim-a.json")));
  check("proposal B merged too (unqualified change request ignored)", gh.prs.get(pB.number).state === "merged");
  await release("sim-erin", e1.body.lease.id, "submitted");
  await release("sim-carol", c2.body.lease.id, "other");
  check("site build accepts the merged steps", /built/.test(buildSite()));
  log("   (waiting 62 s for the desk's 60-second feed cache)");
  await sleep(62000);

  // ---- 3. Builders and the red team
  log("\n== Round 3: builders and red team");
  const a3 = await next("sim-alice");
  check("desk gives a builder a proposed step", a3.status === 200 && a3.body.gap?.kind === "step" && /^Step_/.test(a3.body.gap.statement_name) && !!a3.body.gap.statement, a3.body.gap?.id);
  const b3 = await next("sim-bob");
  check("a second builder gets a different step", b3.status === 200 && b3.body.gap && b3.body.gap.id !== a3.body.gap.id, b3.body.gap?.id);
  const realStep = a3.body.gap.id === "step-sim-a" ? a3 : b3;
  const falseStep = a3.body.gap.id === "step-sim-a" ? b3 : a3;
  const realWho = realStep === a3 ? "sim-alice" : "sim-bob";
  const falseWho = realStep === a3 ? "sim-bob" : "sim-alice";
  check("heartbeat extends a live lease", (await beat(realWho, realStep.body.lease.id)).status === 200);
  await release(falseWho, falseStep.body.lease.id, "statement_seems_false");

  const g3 = await next("sim-grace", "&role=redteam");
  check("red team is sent to the step reported as false", g3.body.gap?.id === "step-sim-b" && /Refute_Step_SimB\.lean$/.test(g3.body.gap.file), g3.body.gap?.file);
  const h3 = await next("sim-heidi", "&hard=1");
  check("hard=1 gives an open problem", h3.body.gap?.kind === "program", h3.body.gap?.id);
  await release("sim-heidi", h3.body.lease.id, "missing_lemma");
  const t3 = await next("sim-trent", "&role=think");
  check("thinkers are sent where a builder reported missing_lemma", t3.body.gap?.id === h3.body.gap.id, t3.body.gap?.id);

  // proofs and refutations
  const judy = openPr({ author: "sim-judy", title: "Prove step-sim-a", files: resultFiles("sim-judy", "step-sim-a", "Step_SimA") });
  check("a proof Lean rejects is REJECTED and not merged", ciCheck(judy, false).conclusion === "failure" && /REJECTED/.test(lastComment(judy)) && gh.prs.get(judy.number).state === "open");
  const ivan = openPr({ author: "sim-ivan", title: "Prove step-sim-a", files: resultFiles("sim-ivan", "step-sim-a", "Step_SimA", false, "  simulated_proof_term", "sim-alice") });
  ciCheck(ivan, true);
  check("claiming someone else's name (proved_by) is refused", gh.prs.get(ivan.number).state === "open" && /proved_by must be your GitHub login/.test(lastComment(ivan)));
  const evil = openPr({ author: "sim-mallory", title: "Prove step-sim-a", files: resultFiles("sim-mallory", "step-sim-a", "Step_SimA", false, "  exact _root_.IO.Process.exit 0") });
  check("a proof that tries to run code during the check is rejected by the gate", ciCheck(evil, true).conclusion === "failure");
  const good = openPr({ author: realWho, title: "Prove step-sim-a", files: resultFiles(realWho, "step-sim-a", "Step_SimA") });
  ciCheck(good, true);
  check("a proof Lean accepts is ACCEPTED and merged", gh.prs.get(good.number).state === "merged" && /ACCEPTED/.test(lastComment(good)) && wsJson("records/collatz/step-sim-a.json").status === "verified");
  await release(realWho, realStep.body.lease.id, "submitted");
  const late = openPr({ author: "sim-heidi", title: "Prove step-sim-a", files: resultFiles("sim-heidi", "step-sim-a", "Step_SimA") });
  ciCheck(late, true);
  check("a second proof of a settled step is not merged", gh.prs.get(late.number).state === "open" && /record|settled/.test(lastComment(late)));
  const ref = openPr({ author: "sim-grace", title: "Refute step-sim-b", files: resultFiles("sim-grace", "step-sim-b", "Step_SimB", true) });
  ciCheck(ref, true);
  check("a refutation is ACCEPTED and the step goes to the graveyard", gh.prs.get(ref.number).state === "merged" && wsJson("records/collatz/step-sim-b.json").status === "refuted");
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

  // ---- 4. Sponsors (mock Stripe -> real sync -> real site)
  log("\n== Round 4: sponsors");
  pay("cs_1", "founder@ai-startup.example", 1000, "Example AI Lab", "Agents that prove things", "https://example.com/lab");
  pay("cs_2", "fan@example.org", 5, "<script>alert(1)</script>Fan", "hi\u0007", "javascript:alert(1)");
  pay("cs_3", "founder@ai-startup.example", 125, "Example AI Lab", "Agents that prove things", "https://example.com/lab");
  pay("cs_4", "nopay@example.org", 50, "Unpaid", "", "", false);
  if (existsSync(join(WS, "tools/stripe_sync.mjs"))) {
    const env = { ...process.env, STRIPE_KEY: "rk_test_simulated", LEDGER_SALT: "simulated-salt", STRIPE_API: `http://127.0.0.1:${STRIPE_PORT}` };
    const s1 = spawnSync(process.execPath, ["tools/stripe_sync.mjs"], { cwd: WS, encoding: "utf8", env });
    const led = wsJson("ledger/supporters.json");
    check("sponsor sync runs", s1.status === 0, (s1.stdout + s1.stderr).trim().slice(0, 100));
    check("same email merges and sums ($1,125), unpaid ignored", led.length === 2 && led.some((x) => x.amount === 1125));
    check("no email stored anywhere in ledger/", !readdirSync(join(WS, "ledger")).some((f) => /@/.test(wsRead(`ledger/${f}`))));
    const s2 = spawnSync(process.execPath, ["tools/stripe_sync.mjs"], { cwd: WS, encoding: "utf8", env });
    check("sponsor sync is idempotent", s2.status === 0 && JSON.stringify(wsJson("ledger/supporters.json")) === JSON.stringify(led));
  } else check("sponsor sync script exists", false, "tools/stripe_sync.mjs missing");
  log("build:", buildSite());

  // ---- 5. What the public sees
  log("\n== Round 5: the site");
  const home = await (await fetch(`http://127.0.0.1:${SITE_PORT}/`)).text();
  const status = (await desk("GET", "/desk/status", "observer")).body;
  check("desk status counts activity", status.recent.length > 5 && status.by_reason_24h.missing_lemma >= 1 && status.by_reason_24h.statement_seems_false >= 1, `recent ${status.recent.length}`);
  check("home page lists the refuted step in the graveyard", home.includes("Simulated step step-sim-b"));
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
