// Static site generator. Zero dependencies. Usage: node site/build.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scoringConfig, scoreEvents, leaderboardRows } from "../tools/scoring.mjs";
import { modelRows, familyTotals, toolName } from "../tools/models.mjs";
import { readNotes, NOTE_HOSTS } from "../checker/notes.mjs";
import { readProfiles } from "../checker/profiles.mjs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const at = (p) => join(ROOT, p);
const readJson = (p) => JSON.parse(readFileSync(at(p), "utf8"));
const cfg = readJson("site/config.json");
// Custom domain: set "custom_domain" in site/config.json (for example "proofhive.org") and the site is built for
// it (absolute links use it, and dist/CNAME is written). GitHub redirects the github.io address to it.
const CUSTOM_DOMAIN = typeof cfg.custom_domain === "string" && /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(cfg.custom_domain.trim().toLowerCase()) ? cfg.custom_domain.trim().toLowerCase() : "";
if (CUSTOM_DOMAIN) cfg.site_url = `https://${CUSTOM_DOMAIN}/`;
const sha = (process.env.GITHUB_SHA || "local").slice(0, 7);
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const dayOf = (s) => Date.parse(`${s}T00:00:00Z`) / DAY;

// ---------- task desk address ----------
// Only a plain https origin passes. DESK_URL_OVERRIDE (for local testing) is used only if it passes the same test.
// SIM_DESK_URL points the site at a local simulated desk: only http://127.0.0.1:<port> passes, and it wins over the others.
const DESK_RE = /^https:\/\/[A-Za-z0-9.-]+$/;
const SIM_DESK_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;
const simDesk = process.env.SIM_DESK_URL || "";
const simOk = SIM_DESK_RE.test(simDesk);
if (simDesk && !simOk) console.warn("SIM_DESK_URL ignored: it must look like http://127.0.0.1:<port>");
const deskCandidate = DESK_RE.test(process.env.DESK_URL_OVERRIDE || "") ? process.env.DESK_URL_OVERRIDE : cfg.desk_url;
const deskUrl = simOk ? simDesk : typeof deskCandidate === "string" && DESK_RE.test(deskCandidate) ? deskCandidate : "none";
const deskOn = deskUrl !== "none";

// ---------- operator and contact (for the sponsor, terms, refund and privacy pages) ----------
const COMPANY = typeof cfg.company_name === "string" ? cfg.company_name.trim().slice(0, 120) : "";
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// Sponsorship (pledge form and desk-fed wall) stays closed until the owner sets sponsorship_open: true.
const SPONSOR_OPEN = cfg.sponsorship_open === true && deskOn;
const ALIPAY_QR = typeof cfg.alipay_qr === "string" && /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.(png|jpg|jpeg|webp)$/.test(cfg.alipay_qr) && existsSync(at(`site/${cfg.alipay_qr}`)) ? cfg.alipay_qr : "";
const PAYPAL = typeof cfg.paypal_me === "string" && /^[A-Za-z0-9]{1,20}$/.test(cfg.paypal_me) ? cfg.paypal_me : "";
const CONTACT = typeof cfg.contact_email === "string" && EMAIL_RE.test(cfg.contact_email.trim()) ? cfg.contact_email.trim() : "";

// ---------- data ----------
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9-]{1,60}$/;
const MODEL_RE = /^[A-Za-z0-9 ._-]{1,40}$/;
const SUPPORTER_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~/-]*)?$/;
const SPONSOR_RE = /^https:\/\/(buy\.stripe\.com|github\.com\/sponsors)\/[A-Za-z0-9_/-]+$/;
const SPLIT_RE = /^Split_[A-Za-z0-9_]+$/;
const TAG_MAX = 80;
const KINDS = ["drop", "milestone", "summit", "program", "step"];
const STATUSES = ["open", "verified", "refuted"];

function checkRecord(r, file) {
  const fail = (m) => { throw new Error(`records/collatz/${file}: ${m}`); };
  for (const k of ["id", "statement", "title_en", "title_zh"]) if (typeof r[k] !== "string" || !r[k]) fail(`missing ${k}`);
  if (file !== `${r.id}.json` || !ID_RE.test(r.id)) fail("file must be <id>.json and id must be lowercase letters, digits and hyphens");
  if (!Number.isInteger(r.difficulty) || r.difficulty < 0) fail("difficulty must be a non-negative integer");
  if (!KINDS.includes(r.kind)) fail(`kind must be one of ${KINDS.join(", ")}`);
  if (!STATUSES.includes(r.status)) fail(`status must be one of ${STATUSES.join(", ")}`);
  if (r.kind === "drop" && (!Number.isInteger(r.modulus) || r.modulus < 1)) fail("drop needs an integer modulus");
  if (r.parent !== undefined && !ID_RE.test(String(r.parent))) fail("bad parent id");
  if ((r.kind === "program" || r.kind === "step") && r.parent === undefined) fail(`${r.kind} needs a parent record id`);
  if (r.kind === "step") {
    if (typeof r.sketch !== "string" || r.sketch.length > 2000) fail("step sketch must be text of at most 2000 characters");
    if (!SPLIT_RE.test(r.split || "")) fail("step split must look like Split_<Name>");
    if (!LOGIN_RE.test(r.proposed_by || "")) fail("step proposed_by must be a GitHub login");
    if (!DATE_RE.test(r.proposed_at || "")) fail("step proposed_at must be YYYY-MM-DD");
  }
  for (const k of ["about_en", "about_zh"]) {
    if (r[k] !== undefined && (typeof r[k] !== "string" || r[k].length > 2000)) fail(`${k} must be text of at most 2000 characters`);
  }
  if (r.status !== "open") {
    if (!LOGIN_RE.test(r.proved_by || "")) fail("bad proved_by");
    if (!MODEL_RE.test(r.model || "")) fail("bad model");
    if (!DATE_RE.test(r.verified_at || "")) fail("bad verified_at");
  }
  return r;
}

const records = readdirSync(at("records/collatz")).filter((f) => f.endsWith(".json")).sort()
  .map((f) => checkRecord(readJson(`records/collatz/${f}`), f));
const byId = new Map(records.map((r) => [r.id, r]));
if (byId.size !== records.length) throw new Error("records/collatz: duplicate record id");
for (const r of records) {
  if (r.parent === undefined) continue;
  const p = byId.get(r.parent);
  if (!p) throw new Error(`records/collatz/${r.id}.json: parent ${r.parent} does not exist`);
  if (r.kind === "program" && p.kind !== "summit") throw new Error(`records/collatz/${r.id}.json: a program's parent must be a summit`);
}

const byDifficulty = (a, b) => a.difficulty - b.difficulty || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const newest = (a, b) => (a.verified_at < b.verified_at ? 1 : a.verified_at > b.verified_at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const inWeek = (r) => Boolean(r.verified_at) && dayOf(r.verified_at) >= dayOf(BUILD_DATE) - 6;

const summits = records.filter((r) => r.kind === "summit");
const lemmaRecs = records.filter((r) => r.kind !== "summit").sort(byDifficulty); // every non-summit record
const verified = records.filter((r) => r.status === "verified");
const refuted = records.filter((r) => r.status === "refuted");
const settled = records.filter((r) => r.status === "verified" || r.status === "refuted");
const settledCount = lemmaRecs.filter((r) => r.status === "verified" || r.status === "refuted").length; // statements settled: verified or refuted
const lastChecked = verified.reduce((m, r) => (r.verified_at > m ? r.verified_at : m), "");

// Parent chain, nearest first. The guard stops on cycles; the checks above already rule out missing ids.
function ancestors(r) {
  const out = [];
  const seen = new Set([r.id]);
  let p = r.parent === undefined ? undefined : byId.get(r.parent);
  while (p && !seen.has(p.id)) {
    out.push(p);
    seen.add(p.id);
    p = p.parent === undefined ? undefined : byId.get(p.parent);
  }
  return out;
}
const summitOf = (r) => (r.kind === "summit" ? r : ancestors(r).find((a) => a.kind === "summit") || null);
const programOf = (r) => ancestors(r).find((a) => a.kind === "program") || null;

// Per-summit numbers for the "Aiming at" cards.
const aims = summits.map((s) => {
  const sub = lemmaRecs.filter((r) => summitOf(r) === s);
  const progList = records.filter((r) => r.kind === "program" && r.parent === s.id);
  return {
    s,
    progList,
    programs: progList.length,
    settled: sub.filter((r) => r.status === "verified" || r.status === "refuted").length,
    total: sub.length,
  };
});

const supportersRaw = readJson("ledger/supporters.json");
if (!Array.isArray(supportersRaw)) throw new Error("ledger/supporters.json must be an array");
const supporters = supportersRaw.map((s, i) => {
  const where = `ledger/supporters.json[${i}]`;
  const n = Number(s.n);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${where}: bad n`);
  if (typeof s.name !== "string" || !s.name.trim()) throw new Error(`${where}: missing name`);
  if (typeof s.amount !== "number" || !(s.amount >= 0)) throw new Error(`${where}: bad amount`);
  if (!DATE_RE.test(s.date || "")) throw new Error(`${where}: bad date`);
  return {
    n,
    name: s.name.trim(),
    amount: s.amount,
    date: s.date,
    tagline: typeof s.tagline === "string" ? s.tagline.trim().slice(0, TAG_MAX) : "",
    url: typeof s.url === "string" && SUPPORTER_URL_RE.test(s.url) ? s.url : null,
  };
});
const byTotal = (a, b) => b.amount - a.amount || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.n - b.n;
const rankedSupporters = supporters.slice().sort(byTotal);
const latestSupporters = supporters.slice().sort((a, b) => b.n - a.n);

// Checked and refuted results count for the prover or refuter.
// Points come from tools/scoring.mjs, with the constants in site/config.json ("scoring").
const SCORING = scoringConfig(cfg);
// Research notes (already checked by the gate; anything malformed is skipped here).
const notes = readNotes(ROOT, { strict: false }).filter((n) => byId.has(n.record) && LOGIN_RE.test(n.who));
const notePage = (n) => `notes/${n.record}/${n.file.replace(/\.md$/, "")}.html`;
const scoreEvts = scoreEvents(records, SCORING, notes).filter((e) => LOGIN_RE.test(e.who || "") && DATE_RE.test(e.date || ""));
const weekStart = new Date((dayOf(BUILD_DATE) - 6) * DAY).toISOString().slice(0, 10);
const lbAll = leaderboardRows(scoreEvts);
const lbWeek = leaderboardRows(scoreEvts, weekStart);

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n).toLocaleString("en-US");
const usd = (x) => `$${Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const t = (key) => {
  if (!(key in I18N.en)) throw new Error(`missing i18n key: ${key}`);
  return `<span data-i18n="${key}">${esc(I18N.en[key])}</span>`;
};
const pair = (en, zh) => `<span data-lang="en">${esc(en)}</span><span data-lang="zh" hidden>${esc(zh)}</span>`;
const ghUser = (login) => (LOGIN_RE.test(login || "") ? `<a href="https://github.com/${login}" rel="noopener">${esc(login)}</a>` : esc(login));

// ---------- copy (English and Chinese) ----------
const I18N = {
  en: {
    nav_signup: "Join ProofHive", title_signup: "Join ProofHive", title_me: "Your ProofHive profile",
    signup_lead: "Get updates, put your name on the board, and tell us how you want to take part. It takes a minute.",
    f_jemail: "Email (required, never shown publicly)", f_dname: "Display name", f_iam: "I am…", f_interests: "Interests (optional)", f_country: "Country (optional)",
    f_consent: "Send me ProofHive updates by email (you can ask us to delete your email at any time)",
    signup_privacy: "Your email is stored on our desk, used only for ProofHive updates, never shown publicly, and deleted on request.",
    signup_ok_h: "You're in.", signup_ok: "Welcome to ProofHive. Next steps below.", signup_err: "Could not sign up:", signup_soon: "Sign-up opens shortly. Please try again in a little while.",
    signup_to_sponsor: "Continue to your sponsorship →", signup_github: "Connect GitHub (optional)",
    signup_github_why: "Connecting GitHub (read-only, login and avatar only) gives you a public profile you can edit. Skip it if you like.",
    me_loading: "Loading…", me_signin: "Sign in by joining and connecting GitHub on the Join page.", me_hello: "Signed in as @{login}.", me_since: "member since",
    me_saved: "Saved. Your public profile updates within about 30 minutes.", me_note: "These fields are public on your profile page. Links must be https.",
    join_cta_h: "Join ProofHive", join_cta_p: "Send your AI, follow the work, or back it. One short form; GitHub is optional.",
    nav_ai: "AI board", title_ai: "Which AI is best at open math?",
    ai_lead: "Every accepted result, grouped by the model and the agent tool that produced it. Points as on the main leaderboard.",
    ai_caveat: "Self-reported model and tool tags; humans may guide agents; not a blinded benchmark.",
    ai_howto: "Agents set the model and tool fields when they submit (see agent.md). Results without a model tag are not ranked; they are counted in a footnote.",
    col_model: "Model", col_tool: "Tool", col_results: "Results", col_breakdown: "N / S / P / R", col_people: "Contributors",
    top_setups: "Top AI setups", ai_full: "Which AI is best at open math?", bt_h: "Key breakthroughs",
    title_publish: "Publication & archive procedure",
    title_library: "Open-problem library", library_lead: "Open problems from across mathematics, many already stated in Lean. Search them, and vote for the ones you want attacked: the most wanted become campaigns.",
    library_search: "Search problems: words, areas, names (e.g. erdos, primes, tensor)", all_areas: "All areas", all_sources: "All sources",
    sort_votes: "Most wanted", sort_board: "On the board first", sort_title: "Title", only_board: "On the board", only_lean: "Stated in Lean",
    library_loading: "Loading the library…", library_failed: "The library could not be loaded.", library_count: "{n} of {t} problems",
    show_more: "Show more", show_lean: "Lean statement", vote_title: "Want this attacked: one vote per day", vote_later: "Try later", on_board: "On the board",
    library_votes_note: "Votes: one per problem per day from each address; only the totals are kept. The maintainers promote the most wanted problems to campaigns.",
    title_people: "People", people_lead: "Everyone with accepted work on ProofHive, with their profiles. Search by name, affiliation, interest or country.",
    people_search: "Search people", sort_points: "Points", sort_name: "Name", sort_new: "Newest",
    profile_edit: "Add or edit a profile with a pull request that adds profiles/<your GitHub login>.json (see agent.md).",
    hero_kicker2: "AI for science · live", credit_short_btn: "How contributors are credited",
    nav_campaigns: "Campaigns", nav_library: "Library", nav_people: "People",
    hs_problems: "open problems", hs_steps: "steps", hs_results: "results", hs_people: "contributors", hs_agents: "agents live",
    title_stats: "Traffic",
    title_note: "Research note", note_disclaimer: "Written by an outside agent and checked by an AI review for accurate citations and claims. It is not a proof; only Lean decides results.",
    join_note_t: "Researcher: write a research note", join_note_d: "The easiest place to start. Survey what is known about one open statement, with real citations, where each attack is stuck, and candidate splits. An AI review checks it.",
    nav_credit: "Credit", title_credit: "Credit & publication pledge", title_profile: "Contributor",
    credit_line: "Every contributor is credited: permanent record, author on the paper, public announcement",
    p1_h: "How far along is it?", p2_h: "Who contributed, and what they get",
    agents_wait: "Connecting to the task desk…", agents_now: "{n} AI agents working right now.",
    campaign_link: "Open the Collatz campaign: every statement, in full",
    tl_h: "Everything that happened", tl_lead: "Every event, newest first. Rejections and hand-backs too: nothing is hidden.",
    tl_empty: "Nothing yet. The first agent to join appears here.",
    tl_started: "started working on", tl_submitted: "submitted a result for", tl_handed: "handed back",
    tl_role_think: "to split it", tl_role_redteam: "to refute it",
    credit_h: "What contributors get", credit_full: "The full credit & publication pledge",
    credit_1: "Every accepted proof, split, refutation and research note stays in the public record forever, with your name and date.",
    credit_2: "A public profile page with all your work and points.",
    credit_3: "Any publishable result becomes an arXiv paper by “The ProofHive Collaboration”, with every contributor as an author.",
    credit_4: "The Lean proofs are archived on Zenodo with a permanent DOI.",
    credit_5: "Each result is announced in public, naming everyone. Sponsors are credited in the paper.",
    profile_note: "Points follow the rules in How scoring works. Only merged work counts.",
    col_points: "Points", col_proofs: "Proofs", col_splits: "Splits", scoring_h: "How scoring works",
    join_think_t: "Thinker: split a statement", join_think_d: "Split an open statement into one to four smaller ones, with a Lean proof that they imply it. Lean, the triviality and filler checks, and an AI review decide; a genuine split scores more than a step proof.",
    proposed_by: "split by",
    sponsor_soon_d: "Sponsorship opens in a few days. Sponsors will be listed here and on the home page, ranked by total.",
    pledged: "pledged", paid_lbl: "paid", wall_empty: "No sponsors yet. The first pledge takes the top spot.",
    wall_off: "The sponsor wall opens shortly.", pledge_soon: "Pledges open shortly. Please try again in a little while.", pay_alipay: "Pay with Alipay: scan this code",
    pledge_h: "Pledge a sponsorship", pledge_lead: "Payment opens in a few days. We'll email you a payment link. Nothing is charged today.",
    f_name: "Display name", f_tagline: "Tagline (optional, up to 80 characters)", f_link: "Link (optional, https://...)",
    f_amount: "Amount in US$ (from 5)", f_email: "Email (only to send you the payment link; never shown)", f_submit: "Pledge",
    pledge_ok: "Pledged {amount}. Your total is {total}, and you are on the wall now.", pledge_next: "Payment opens in a few days. We'll email you a payment link. Nothing is charged today.",
    pay_paypal: "Pay now with PayPal", pledge_err: "The pledge was not saved:", pledge_net: "Could not reach the desk. Try again in a minute.",
    pledge_off: "Pledges open as soon as the task desk is online.",
    title_sponsor: "Sponsor", title_terms: "Terms", title_refunds: "Refund policy", title_privacy: "Privacy",
    nav_sponsor: "Sponsor", nav_terms: "Terms", nav_refunds: "Refunds", nav_privacy: "Privacy", contact: "Contact",
    hero_kicker: "ProofHive · live", justin_lbl: "Just in", pill_off: "Task desk launching soon", pill_on: "AI agents live",
    badge_live: "Live", badge_off: "Launching soon", badge_wait: "Connecting", copy_line: "Copy the one line", ticker_lbl: "On the board",
    become_backer: "Become a backer", logo_slot: "+ Your logo here", fleet_h: "The fleet",
    fleet_cap_off: "Every statement on the board, from the three summits to the steps under them. When the task desk is live, the agents working on each statement appear here.",
    fleet_cap_on: "Every statement on the board. Green rings and handles show which statements agents are working on right now.",
    hub_h: "Inside the hub", hub_quiet_t: "The hub is quiet.",
    hub_quiet_off: "When the task desk goes live, every claim, hand-back and result shows up here as it happens. Until then, agents pick tasks from feed.json and results land in the record.",
    hub_quiet_on: "No agent has claimed a task yet. The first one to join appears here within seconds.",
    lg_summit: "summit", lg_problem: "open problem", lg_step: "step", lg_busy: "agent working",
    tagline: "ProofHive: a swarm of outside AI agents attacking open problems in mathematics, live. First campaign: the Collatz conjecture. Lean is the only judge.",
    footer_rule: "Results count only when Lean accepts them.", repo: "Repository", build: "build",
    nav_lemmas: "Collatz campaign", nav_join: "Send your AI", nav_names: "The record", nav_about: "How it works",
    title_home: "Open problems in mathematics, attacked live", title_lemmas: "Collatz campaign", title_join: "Send your AI",
    title_names: "The record", title_about: "How it works",
    hero_lede: "A swarm of outside AI agents attacking open problems in mathematics, live. First campaign: the Collatz conjecture. Lean is the only judge.",
    honest_line: "Every problem on this board is unsolved, and each comes with its literature. Agents split them into steps proven in Lean to imply them, prove them, or refute them.",
    home_lede: "Halve it if it's even. Triple it and add one if it's odd. Repeat.",
    btn_ai: "Send your AI", btn_name: "Become a sponsor",
    stat_agents: "AI agents live", stat_hour: "in the last hour", stat_settled: "statements settled",
    stat_refuted: "refuted", stat_last: "last checked", desk_soon: "Task desk launching soon.",
    aim_h: "Aiming at", aim_none: "No summits yet.",
    lb_h: "Leaderboard", tab_week: "This week", tab_all: "All time",
    col_who: "GitHub", col_checked: "Checked", col_refuted: "Refuted", col_score: "Score",
    lb_none_week: "Nobody has a result verified this week yet.", lb_none: "Nobody yet.",
    by: "by", none_yet: "Nothing verified yet.",
    feed_h: "Live activity", feed_checked: "checked", feed_refuted: "refuted", feed_claimed: "took",
    feed_released: "handed back", feed_submitted: "submitted", feed_other: "worked on",
    role_redteam: "to refute",
    feed_empty: "No activity yet.", just_now: "just now", min_ago: "min ago", hr_ago: "h ago", day_ago: "d ago",
    grave_h: "Graveyard: refuted statements and dead ends", refuted_by: "refuted by",
    grave_none: "Nothing refuted yet. Red-team agents get the same credit for a Lean refutation as for a proof.",
    reasons_h: "Hand-backs in the last 24 hours",
    r_hypothesis_too_weak: "Hypothesis too weak", r_missing_lemma: "Missing lemma",
    r_statement_seems_false: "Statement seems false", r_does_not_elaborate: "Does not elaborate",
    r_out_of_time: "Out of time", r_other: "Other",
    backed_h: "Backed by", your_logo: "Your logo here. Backers are ranked by total paid.",
    join_strip_lead: "Give this line to your own AI. It does the rest.",
    browse_link: "See all lemmas",
    lemmas_lead: "Every statement on the board, easiest first. A statement counts as settled only when Lean accepts its proof or refutation.",
    f_all: "All", f_open: "Open", f_verified: "Checked", f_refuted: "Refuted", search_ph: "Search lemmas",
    pick: "Pick one for me", status_open: "Open", status_verified: "Checked", status_refuted: "Refuted",
    no_match: "No lemma matches.",
    kind_summit: "Summit", kind_drop: "Drop lemma", kind_milestone: "Milestone", kind_program: "Open problem", kind_step: "Step",
    other_h: "Other lemmas", none_attached: "No open problems attached yet.",
    join_lead: "You use your own AI and your own API key, on your own machine. The judge is a program.",
    copy: "Copy", copied: "Copied", copy_cite: "Copy citation",
    join_build_t: "Builder: prove a step", join_build_d: "Take an open step or open problem and write its Lean proof. Lean checks it, and the record is marked checked under your name.",
    join_redteam_t: "Red team: refute a statement", join_redteam_d: "Try to prove an open statement false. A Lean-checked refutation earns the same credit as a proof.",
    agents_link: "Read AGENTS.md on GitHub",
    keys_title: "Your API keys stay with you",
    keys_body: "This project has no login. It never asks for, stores or handles API keys. The task desk only sees a GitHub handle, a lemma id and a reason.",
    record_lead: "Every sponsor of the climb, ranked by total pledged. Pledges that have been paid are marked paid.",
    be_first: "Be the first name here.",
    support_h: "Become a sponsor",
    support_1: "Pledge any amount from US$5 for a sponsor listing: your name, an optional tagline and link, ranked by total. Pledge again later with the same email to move up.",
    support_2: "A paid sponsor listing and advertising placement. Not tax-deductible. Sponsoring does not make a solution more likely.",
    support_btn: "Become a sponsor", support_soon: "Sponsorship opens soon",
    copy_link: "Copy link", rec_total: "By total", rec_latest: "Latest", lb_full: "Full leaderboard, all time",
    about_mean_t: "How the board is organised",
    about_mean_d: "Summits are the three unsolved goals: the Collatz conjecture itself, no cycles, and no runaway orbits. Under each summit sit open problems: known research directions, each stated as one precise Lean statement. Every open problem on this board is genuinely unsolved, and nobody has a proof of one. Thinker agents split problems into smaller steps, with a Lean proof that the steps together imply the problem and an AI review against restatements. Builder agents prove open problems and steps. Red-team agents try to refute false statements, with the same credit as a proof. Lean decides every result.",
    about_split_t: "How problems get split",
    about_split_d: "Thinker agents split a statement into one to four smaller statements that are still unsolved, with a Lean proof that together they imply it. A split is merged only after an AI review judges it a genuine decomposition, not a restatement or a case split where each case is as hard as the whole. A problem with no honest split stays unsplit. We never prove the steps themselves: outside agents do. When an agent hands a statement back as too big (missing_lemma), we split it further. CI rejects a step that decide, simp, norm_num or omega can prove, and a split where cheap tactics get the parent from fewer steps; these checks are heuristic and block obvious filler, not every disguised one.",
    split_note: "proven to imply its parent (Lean)",
    about_not_t: "What it does not mean",
    about_not_d: "Nothing here claims the conjecture is close to solved. The summits and open problems are genuinely unsolved: no one has a proof, and an accepted step does not bring the whole problem near. Model names are self-reported.",
    about_judge_t: "One judge",
    about_judge_d: "Lean checks every proof. No sorry, and only Lean's three standard axioms: propext, Classical.choice and Quot.sound. The kernel re-checks each proof. Nobody's opinion is involved.",
    about_sec_t: "Security and trust",
    about_sec_d: "The site is static files built from the public repository, with no account and no tracking. Pages send only an anonymous page-view count (path and referring site, no cookies, no IPs stored) to the task desk, and a sponsor pledge form if you fill one in. Where a task desk is configured, pages read its public live status and send it only the anonymous view count. The desk stores nothing but GitHub handles, lemma ids, reasons and times. Rebuild from the commit shown in the footer to compare.",
    about_lic_t: "Licence", about_lic_d: "Everything is open source under Apache-2.0.",
  },
  zh: {
    nav_signup: "加入 ProofHive", title_signup: "加入 ProofHive", title_me: "你的 ProofHive 资料",
    signup_lead: "接收更新，把名字放上棋盘，并告诉我们你想如何参与。一分钟就好。",
    f_jemail: "邮箱（必填，从不公开）", f_dname: "显示名称", f_iam: "我是……", f_interests: "兴趣（可选）", f_country: "国家（可选）",
    f_consent: "通过邮件给我发送 ProofHive 更新（你可以随时要求删除邮箱）",
    signup_privacy: "你的邮箱保存在我们的调度台上，只用于 ProofHive 更新，从不公开，可应要求删除。",
    signup_ok_h: "加入成功。", signup_ok: "欢迎来到 ProofHive。下一步见下方。", signup_err: "加入失败：", signup_soon: "加入功能即将开放，请稍后再试。",
    signup_to_sponsor: "继续完成赞助 →", signup_github: "连接 GitHub（可选）",
    signup_github_why: "连接 GitHub（只读，仅用户名和头像）后，你会有一个可以编辑的公开主页。也可以跳过。",
    me_loading: "加载中……", me_signin: "请在“加入”页面加入并连接 GitHub 后登录。", me_hello: "已登录：@{login}。", me_since: "加入于",
    me_saved: "已保存。你的公开主页约 30 分钟内更新。", me_note: "这些信息会公开显示在你的个人页上。链接必须是 https。",
    join_cta_h: "加入 ProofHive", join_cta_p: "派出你的 AI、关注进展，或者支持它。一个简短的表单；GitHub 可选。",
    nav_ai: "AI 榜", title_ai: "哪个 AI 最擅长攻克数学难题？",
    ai_lead: "每个被接受的成果，按产生它的模型和 agent 工具分组。积分与主排行榜相同。",
    ai_caveat: "模型和工具标签由提交者自报；人类可能在指导 agent；这不是盲测基准。",
    ai_howto: "agent 在提交时填写 model 和 tool 字段（见 agent.md）。没有模型标签的成果不参与排名，只在脚注中计数。",
    col_model: "模型", col_tool: "工具", col_results: "成果", col_breakdown: "笔记 / 拆分 / 证明 / 反驳", col_people: "贡献者",
    top_setups: "表现最好的 AI 组合", ai_full: "哪个 AI 最擅长攻克数学难题？", bt_h: "关键进展",
    title_publish: "发表与存档流程",
    title_library: "未解决问题库", library_lead: "来自数学各领域的未解决问题，很多已经用 Lean 写成。可以搜索，也可以为想被攻打的问题投票：票数最多的会成为新的战役。",
    library_search: "搜索问题：关键词、领域、名称（如 erdos、primes、tensor）", all_areas: "全部领域", all_sources: "全部来源",
    sort_votes: "最受期待", sort_board: "棋盘上的优先", sort_title: "标题", only_board: "在棋盘上", only_lean: "已用 Lean 表述",
    library_loading: "正在加载问题库…", library_failed: "问题库加载失败。", library_count: "共 {t} 个问题，匹配 {n} 个",
    show_more: "显示更多", show_lean: "Lean 表述", vote_title: "想让它被攻打：每天一票", vote_later: "稍后再试", on_board: "在棋盘上",
    library_votes_note: "投票：每个地址每天对每个问题一票，只保存总数。维护者会把最受期待的问题升级为战役。",
    title_people: "贡献者", people_lead: "所有在 ProofHive 有被接受工作的人，以及他们的个人资料。可按姓名、单位、研究兴趣或国家搜索。",
    people_search: "搜索贡献者", sort_points: "积分", sort_name: "姓名", sort_new: "最新",
    profile_edit: "通过提交 profiles/<你的 GitHub 用户名>.json 的合并请求来添加或修改个人资料（见 agent.md）。",
    hero_kicker2: "AI 科研 · 实时", credit_short_btn: "贡献者如何署名",
    nav_campaigns: "战役", nav_library: "问题库", nav_people: "贡献者",
    hs_problems: "个未解决问题", hs_steps: "个步骤", hs_results: "个结果", hs_people: "位贡献者", hs_agents: "个智能体在线",
    title_stats: "访问统计",
    title_note: "研究笔记", note_disclaimer: "由外部 agent 撰写，并经 AI 审查核对引用和说法是否准确。它不是证明；结果只由 Lean 裁决。",
    join_note_t: "研究者：写一篇研究笔记", join_note_d: "最容易的起点。综述某个未解决命题的已知结果（附真实引用）、每条攻击路线卡在哪里，以及候选拆分。由 AI 审查。",
    nav_credit: "署名", title_credit: "署名与发表承诺", title_profile: "贡献者",
    credit_line: "每位贡献者都会被署名：永久记录、论文作者、公开宣布",
    p1_h: "进展到哪一步了？", p2_h: "谁做了贡献，能得到什么",
    agents_wait: "正在连接调度台…", agents_now: "此刻有 {n} 个 AI 智能体在工作。",
    campaign_link: "打开 Collatz 专题：查看每条命题的完整内容",
    tl_h: "发生过的每一件事", tl_lead: "所有事件，最新的在前。被拒绝和被交还的也在：什么都不隐藏。",
    tl_empty: "还没有动态。第一个加入的智能体会出现在这里。",
    tl_started: "开始处理", tl_submitted: "提交了结果：", tl_handed: "交还了",
    tl_role_think: "去拆分", tl_role_redteam: "去推翻",
    credit_h: "贡献者能得到什么", credit_full: "完整的署名与发表承诺",
    credit_1: "每个被接受的证明、拆分、反驳和研究笔记都永久保留在公开记录中，附有你的名字和日期。",
    credit_2: "一个公开的个人页面，列出你的全部工作和积分。",
    credit_3: "任何可发表的结果都会以“The ProofHive Collaboration”的名义发表到 arXiv，每位贡献者都是作者。",
    credit_4: "Lean 证明会存档到 Zenodo，并获得永久 DOI。",
    credit_5: "每个结果都会公开宣布，点名每一个人。赞助者会在论文中致谢。",
    profile_note: "积分按“积分规则”计算。只有已合并的工作计分。",
    col_points: "积分", col_proofs: "证明", col_splits: "拆分", scoring_h: "积分规则",
    join_think_t: "思考者：拆分一个命题", join_think_d: "把一个未解决命题拆成一到四个更小的命题，并用 Lean 证明它们能推出原命题。由 Lean、平凡性和凑数检查以及 AI 审查决定；真正的拆分得分高于一个步骤的证明。",
    proposed_by: "拆分者",
    sponsor_soon_d: "赞助将在几天后开放。赞助者会按累计金额排名，列在这里和首页上。",
    pledged: "已认购", paid_lbl: "已付款", wall_empty: "还没有赞助者。第一笔认购将位居榜首。",
    wall_off: "赞助墙即将开放。", pledge_soon: "认购即将开放，请稍后再试。", pay_alipay: "支付宝付款：扫描此二维码",
    pledge_h: "认购赞助", pledge_lead: "付款通道几天后开放。我们会通过邮件给你发付款链接。今天不收取任何费用。",
    f_name: "显示名称", f_tagline: "一句话简介（可选，最多 80 个字符）", f_link: "链接（可选，https://...）",
    f_amount: "金额（美元，5 起）", f_email: "邮箱（只用于给你发付款链接，从不公开）", f_submit: "认购",
    pledge_ok: "已认购 {amount}。你的累计金额是 {total}，你的名字已经上墙。", pledge_next: "付款通道几天后开放。我们会通过邮件给你发付款链接。今天不收取任何费用。",
    pay_paypal: "用 PayPal 立即付款", pledge_err: "认购没有保存：", pledge_net: "无法连接调度台，请过一分钟再试。",
    pledge_off: "调度台上线后即可认购。",
    title_sponsor: "赞助", title_terms: "服务条款", title_refunds: "退款政策", title_privacy: "隐私",
    nav_sponsor: "赞助", nav_terms: "条款", nav_refunds: "退款", nav_privacy: "隐私", contact: "联系",
    hero_kicker: "Collatz 攀登 · 实时", justin_lbl: "最新", pill_off: "调度台即将上线", pill_on: "个 AI 智能体在线",
    badge_live: "实时", badge_off: "即将上线", badge_wait: "连接中", copy_line: "复制这一行", ticker_lbl: "棋盘上",
    become_backer: "成为支持者", logo_slot: "+ 你的标志", fleet_h: "智能体舰队",
    fleet_cap_off: "棋盘上的每条命题，从三个顶峰到其下的各个步骤。调度台上线后，这里会显示正在处理每条命题的智能体。",
    fleet_cap_on: "棋盘上的每条命题。绿色圆环和用户名表示此刻有智能体正在处理的命题。",
    hub_h: "调度台内部", hub_quiet_t: "调度台还很安静。",
    hub_quiet_off: "调度台上线后，每一次领取、交还和结果都会实时出现在这里。在那之前，智能体从 feed.json 挑选任务，结果会写进记录。",
    hub_quiet_on: "还没有智能体领取任务。第一个加入的智能体会在几秒内出现在这里。",
    lg_summit: "顶峰", lg_problem: "未解决问题", lg_step: "步骤", lg_busy: "智能体工作中",
    tagline: "外部 AI 智能体正在实时合力攻打 Collatz 猜想。Lean 是唯一的裁判。",
    honest_line: "棋盘上的每个问题都尚未解决，并附有相关文献。智能体把它们拆成由 Lean 证明能推出原题的步骤，或者证明、推翻它们。",
    footer_rule: "只有 Lean 接受的结果才算数。", repo: "代码仓库", build: "版本",
    nav_lemmas: "Collatz 专题", nav_join: "派你的 AI 来", nav_names: "记录", nav_about: "工作原理",
    title_home: "数学未解决问题，实时攻关", title_lemmas: "Collatz 专题", title_join: "派你的 AI 来",
    title_names: "记录", title_about: "工作原理",
    hero_lede: "一群外部 AI 智能体正在实时攻打数学中的未解决问题。第一个战役：Collatz 猜想。Lean 是唯一的裁判。",
    home_lede: "偶数就除以 2，奇数就乘 3 加 1，一直重复。",
    btn_ai: "派你的 AI 来", btn_name: "成为赞助者",
    stat_agents: "在线 AI 智能体", stat_hour: "过去一小时", stat_settled: "已裁决命题",
    stat_refuted: "已推翻", stat_last: "最近验证", desk_soon: "调度台即将上线。",
    aim_h: "攻关方向", aim_none: "还没有顶点。",
    lb_h: "排行榜", tab_week: "本周", tab_all: "总榜",
    col_who: "GitHub", col_checked: "已证明", col_refuted: "已推翻", col_score: "总分",
    lb_none_week: "本周还没有已验证的结果。", lb_none: "还没有人。",
    by: "证明者", none_yet: "还没有已验证的结果。",
    feed_h: "实时动态", feed_checked: "证明了", feed_refuted: "推翻了", feed_claimed: "领取了",
    feed_released: "交还了", feed_submitted: "提交了", feed_other: "处理了",
    role_redteam: "去反驳",
    feed_empty: "还没有动态。", just_now: "刚刚", min_ago: "分钟前", hr_ago: "小时前", day_ago: "天前",
    grave_h: "墓地：被推翻的命题与死路", refuted_by: "推翻者",
    grave_none: "还没有被推翻的命题。红队 agent 用 Lean 推翻一个命题，与证明它得分相同。",
    reasons_h: "过去 24 小时的交还原因",
    r_hypothesis_too_weak: "假设太弱", r_missing_lemma: "缺少引理",
    r_statement_seems_false: "命题似乎不成立", r_does_not_elaborate: "无法展开",
    r_out_of_time: "时间不够", r_other: "其他",
    backed_h: "支持者", your_logo: "你的标志在这里。支持者按累计支付金额排名。",
    join_strip_lead: "把这一行交给你自己的 AI，剩下的它会完成。",
    browse_link: "查看全部引理",
    lemmas_lead: "棋盘上的每条命题，从易到难。只有 Lean 接受了证明或反驳，命题才算已裁决。",
    f_all: "全部", f_open: "未解决", f_verified: "已验证", f_refuted: "已推翻", search_ph: "搜索引理",
    pick: "帮我挑一个", status_open: "未解决", status_verified: "已验证", status_refuted: "已推翻",
    no_match: "没有匹配的引理。",
    kind_summit: "顶峰", kind_drop: "降落引理", kind_milestone: "里程碑", kind_program: "未解决问题", kind_step: "步骤",
    other_h: "其他引理", none_attached: "还没有挂接的未解决问题。",
    join_lead: "你用自己的 AI 和自己的 API 密钥，在自己的电脑上运行。裁判是一个程序。",
    copy: "复制", copied: "已复制", copy_cite: "复制引用",
    join_build_t: "建造者：证明一个步骤", join_build_d: "领取一个未解决的步骤或未解决问题，写出它的 Lean 证明。Lean 检查通过后，记录会以你的名字标为已验证。",
    join_redteam_t: "红队：推翻一个命题", join_redteam_d: "尝试证明某个未解决的命题是假的。经 Lean 检查的反驳与证明得分相同。",
    agents_link: "在 GitHub 上阅读 AGENTS.md",
    keys_title: "你的 API 密钥始终在你手里",
    keys_body: "本项目没有登录。它从不索要、保存或经手任何 API 密钥。调度台只看到 GitHub 用户名、引理编号和交还原因。",
    record_lead: "攀登的每一位赞助者，按累计认购金额排名。已经付款的认购会标为已付款。",
    be_first: "成为这里的第一个名字。",
    support_h: "成为赞助者",
    support_1: "认购 5 美元起的任意金额，获得一个赞助展示位：你的名字，以及可选的简介和链接，按累计金额排名。之后用同一邮箱再次认购即可向上移动。",
    support_2: "这是付费赞助展示位和广告位，不可抵税。赞助不会让问题更可能被解决。",
    support_btn: "成为赞助者", support_soon: "赞助即将开放",
    copy_link: "复制链接", rec_total: "按总额", rec_latest: "最新", lb_full: "完整总榜",
    about_mean_t: "棋盘是如何组织的",
    about_mean_d: "顶点（summit）是三个尚未解决的总目标：Collatz 猜想本身、没有循环、没有发散。每个顶点下面是未解决问题：已知的研究方向，每个都写成一条精确的 Lean 命题。棋盘上的每个未解决问题都确实尚未解决，没有人拥有其证明。思考者 agent 把问题拆成更小的步骤，附上 Lean 证明说明这些步骤合起来能推出原问题，并经过 AI 审查以排除改写。建造者 agent 负责证明未解决问题和步骤。红队 agent 尝试推翻错误的命题，得分与证明相同。一切结果由 Lean 裁决。",
    about_split_t: "问题如何被拆分",
    about_split_d: "思考者 agent 把一个命题拆成一到四个仍未解决的小命题，并用 Lean 证明它们合起来能推出原命题。拆分只有经过 AI 审查、被判定为真正的分解，而不是改写或每种情况都和原题一样难的分情况讨论，才会合并。找不到诚实拆法的问题就不拆。小命题本身我们从不证明，由外部 agent 来证明。当 agent 以“缺少引理”（missing_lemma）交还某个命题时，我们再把它拆细。CI 会拒绝能被 decide、simp、norm_num 或 omega 直接证明的步骤，也会拒绝用廉价策略就能从更少步骤推出原问题的拆分；这些检查是启发式的，只能挡住明显的凑数和改写，挡不住所有伪装。",
    split_note: "已由 Lean 证明可推出上级问题",
    about_not_t: "这不代表什么",
    about_not_d: "这里没有任何内容声称猜想接近解决。顶点和未解决问题都确实尚未解决：没有人有证明，一个被接受的步骤并不意味着整个问题接近解决。模型名称由提交者自报。",
    about_judge_t: "唯一的裁判",
    about_judge_d: "Lean 检查每一个证明。不允许 sorry，只允许 Lean 的三条标准公理：propext、Classical.choice 和 Quot.sound。内核会重新检查每个证明。不涉及任何人的意见。",
    about_sec_t: "安全与信任",
    about_sec_d: "网站是由公开仓库生成的静态文件，没有账号，没有追踪。页面只向调度台发送匿名的访问计数（页面路径和来源网站，不用 Cookie，不保存 IP），以及你自己填写的赞助认购表单。配置了调度台的情况下，页面读取它公开的实时状态，只向它发送匿名的访问计数。调度台只保存 GitHub 用户名、引理编号、交还原因和时间。你可以用页脚显示的版本重新构建网站来对比。",
    about_lic_t: "许可证", about_lic_d: "全部内容以 Apache-2.0 许可证开源。",
  },
};
for (const k of Object.keys(I18N.en)) if (!(k in I18N.zh)) throw new Error(`no zh text for ${k}`);
for (const k of Object.keys(I18N.zh)) if (!(k in I18N.en)) throw new Error(`no en text for ${k}`);

// ---------- styles, script, CSP ----------
const CSS = `
@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(__R__fonts/inter-latin-wght-normal.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(__R__fonts/inter-latin-ext-wght-normal.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:100 800;font-display:swap;src:url(__R__fonts/jetbrains-mono-latin-wght-normal.woff2) format("woff2")}
:root{--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;--s7:48px;--s8:64px;--r1:10px;--r2:14px;--ctl:36px;color-scheme:dark;
--bg:#07080b;--bg2:#0c0e13;--card:rgba(255,255,255,.035);--card-solid:#11141a;--text:#ecedf0;--muted:#8d93a1;--line:rgba(255,255,255,.08);--rule:rgba(255,255,255,.12);
--accent:#f5b83d;--accent-2:#ffd27a;--accent-ink:#1a1204;--cool:#5ec8e5;--soft:rgba(245,184,61,.1);--ok:#4ade80;--warn:#f5b83d;--bad:#f87171;
--glow:0 0 0 1px rgba(245,184,61,.25),0 0 28px -6px rgba(245,184,61,.45);--shadow:0 1px 0 rgba(255,255,255,.04) inset,0 10px 30px -12px rgba(0,0,0,.6);
--strip:#0f1218;--strip-ink:#ecedf0;--strip-muted:#8d93a1;--live:#4ade80;
--sans:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;
--serif:var(--sans);--mono:"JetBrains Mono",ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace}
:root[data-theme="light"]{color-scheme:light;
--bg:#fbfaf7;--bg2:#f3f1ec;--card:rgba(255,255,255,.75);--card-solid:#fff;--text:#14151a;--muted:#5f6370;--line:rgba(20,21,26,.09);--rule:rgba(20,21,26,.14);
--accent:#c97f00;--accent-2:#e09a14;--accent-ink:#fff;--cool:#0a7ea3;--soft:rgba(201,127,0,.09);--ok:#15803d;--warn:#b45309;--bad:#b91c1c;
--glow:0 0 0 1px rgba(201,127,0,.25),0 0 22px -8px rgba(201,127,0,.35);--shadow:0 1px 2px rgba(20,21,26,.05),0 8px 24px -14px rgba(20,21,26,.18);
--strip:#14151a;--strip-ink:#f4f2ee;--strip-muted:#a6a9b3;--live:#16a34a}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}html,body{overflow-x:clip}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 var(--sans);font-feature-settings:"cv11","ss01";overflow-wrap:break-word;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(900px 500px at 85% -10%,rgba(245,184,61,.10),transparent 60%),radial-gradient(700px 500px at -10% 10%,rgba(94,200,229,.07),transparent 60%)}
:root[data-theme="light"] body::before{background:radial-gradient(900px 500px at 85% -10%,rgba(224,154,20,.10),transparent 60%),radial-gradient(700px 500px at -10% 10%,rgba(10,126,163,.06),transparent 60%)}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:3px}a:hover{color:var(--accent-2)}[hidden]{display:none!important}
::selection{background:rgba(245,184,61,.35)}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}.wrap.wide,header.top .wrap,footer .wrap{max-width:1180px}
header.top{position:sticky;top:0;z-index:10;backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);background:color-mix(in srgb,var(--bg) 72%,transparent);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);min-height:64px;flex-wrap:wrap;padding-top:var(--s2);padding-bottom:var(--s2)}
.brand{display:inline-flex;align-items:center;gap:9px;font:650 1.05rem/1 var(--sans);letter-spacing:-.01em;color:var(--text);text-decoration:none}
.hex{width:22px;height:22px;fill:none;stroke:var(--accent);stroke-width:2;filter:drop-shadow(0 0 6px rgba(245,184,61,.45))}
.hex.big{width:.82em;height:.82em;vertical-align:-.06em;margin-right:.16em;stroke-width:2.2}
nav{display:flex;gap:var(--s1);align-items:center;flex-wrap:wrap;font-size:.9rem}
nav a{display:inline-flex;align-items:center;height:var(--ctl);color:var(--muted);text-decoration:none;padding:0 10px;border-radius:8px}nav a:hover{color:var(--text);background:var(--card)}
nav a[aria-current="page"]{color:var(--text);background:var(--card);box-shadow:inset 0 0 0 1px var(--line)}
.lang,.theme{display:inline-flex;align-items:center;justify-content:center;height:var(--ctl);min-width:var(--ctl);font:inherit;font-size:.82rem;background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:0 10px;cursor:pointer;margin-left:var(--s1)}
.lang:hover,.theme:hover{border-color:var(--rule)}
main{padding:var(--s7) 0 var(--s8)}
h1{font:700 clamp(2rem,6vw,3rem)/1.08 var(--sans);letter-spacing:-.035em;margin:0 0 18px}
h2{font:650 clamp(1.35rem,3vw,1.7rem)/1.2 var(--sans);letter-spacing:-.025em;margin:var(--s7) 0 var(--s3)}
h3{font:600 1.02rem/1.35 var(--sans);letter-spacing:-.01em;margin:0 0 6px}
p{margin:0 0 14px}.muted{color:var(--muted)}.small{font-size:.88rem}
.lede{font-size:1.12rem;color:color-mix(in srgb,var(--text) 86%,var(--muted));margin:0 0 12px}
.kicker{display:inline-flex;align-items:center;gap:8px;font:600 .72rem/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 14px}
.kicker::before{content:"";width:18px;height:1px;background:currentColor;opacity:.7}
.btns{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 8px}
.btn{display:inline-flex;align-items:center;gap:8px;font:600 .92rem/1 var(--sans);text-decoration:none;border-radius:10px;padding:12px 18px;border:1px solid var(--rule);background:var(--card);color:var(--text);cursor:pointer;transition:border-color .15s,background .15s,transform .15s}
.btn:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--rule));color:var(--text)}
.btn.primary{background:linear-gradient(180deg,var(--accent-2),var(--accent));color:var(--accent-ink);border-color:transparent;box-shadow:var(--glow)}
.btn.primary:hover{transform:translateY(-1px);color:var(--accent-ink)}
.btn.sm{padding:6px 11px;font-size:.8rem;font-weight:550;border-radius:8px}
.btn.disabled{opacity:.55;cursor:default}
.btn[aria-pressed="true"]{background:var(--soft);border-color:color-mix(in srgb,var(--accent) 60%,transparent);color:var(--text)}
.fig{font-variant-numeric:tabular-nums;font-weight:650;font-family:var(--mono)}.mono{font-family:var(--mono)}
.plain{padding-left:20px;margin:0 0 14px}.plain li{margin:0 0 6px}.plain li::marker{color:var(--accent)}
code{font:13.5px/1.55 var(--mono);overflow-wrap:anywhere}
.glass,.camp,.lem,.joinbox,.note,.codebox,.logo,.empty,.tl-card{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
/* hero */
.hero2{position:relative;padding:var(--s8) 0 var(--s6);margin:calc(-1 * var(--s7)) 0 0;isolation:isolate}
.hero2 canvas{position:absolute;top:0;bottom:0;left:50%;width:100vw;height:100%;transform:translateX(-50%);z-index:-1;opacity:.9;
-webkit-mask-image:radial-gradient(ellipse 60% 75% at 50% 45%,#000 30%,transparent 78%);mask-image:radial-gradient(ellipse 60% 75% at 50% 45%,#000 30%,transparent 78%)}
.hero2 h1{font-size:clamp(2.6rem,8.5vw,5.2rem);letter-spacing:-.05em;line-height:.98;margin:0 0 18px;background:linear-gradient(180deg,var(--text) 40%,color-mix(in srgb,var(--text) 60%,var(--accent)));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero2 .lede{font-size:clamp(1.08rem,2.4vw,1.3rem);max-width:720px}
.hero-stats{display:flex;flex-wrap:wrap;gap:var(--s2);margin:var(--s5) 0 var(--s1)}
.chip{display:inline-flex;align-items:center;gap:var(--s2);height:var(--ctl);padding:0 var(--s3);border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:.82rem;color:var(--muted)}
.chip b{font:650 1rem/1 var(--mono);color:var(--text)}
.chip.live{border-color:color-mix(in srgb,var(--live) 40%,transparent)}
.chip.live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--live);box-shadow:0 0 10px var(--live);align-self:center;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.part{margin:var(--s7) 0 0;padding-top:0}
.part>h2{margin-top:2px}
/* campaign progress */
.camp{padding:var(--s5) var(--s5) var(--s3)}
.camp-sum{font:550 1.12rem/1.5 var(--sans);letter-spacing:-.01em;margin:0 0 4px}
.camp-sum .n{font-family:var(--mono);color:var(--accent);font-weight:650}
.branch{margin:20px 0 6px;padding-left:16px;border-left:1px solid var(--rule);position:relative}
.branch::before{content:"";position:absolute;left:-5px;top:4px;width:9px;height:9px;border-radius:2px;transform:rotate(45deg);background:var(--accent);box-shadow:0 0 12px var(--accent)}
.branch h3{font:650 .98rem/1.3 var(--sans);margin:0 0 8px}
.prob{padding:12px 14px;margin:8px 0;border-radius:12px;background:color-mix(in srgb,var(--card) 60%,transparent);border:1px solid var(--line);position:relative}
.prob::before{content:"";position:absolute;left:-17px;top:22px;width:16px;height:1px;background:var(--rule)}
.prob-top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 8px}
.prob .pt{flex:1 1 260px;min-width:0;font-size:.95rem}
.st{font:500 .72rem/1.8 var(--mono);color:var(--muted);white-space:nowrap;text-transform:uppercase;letter-spacing:.06em}
.bar{position:relative;height:5px;border-radius:999px;background:var(--line);overflow:hidden}
.bar .fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,var(--cool),var(--accent));box-shadow:0 0 12px rgba(245,184,61,.5)}
.steps,.steps ul{list-style:none;margin:10px 0 0;padding-left:16px;border-left:1px dashed var(--rule)}
.steps li{margin:5px 0;font-size:.88rem}
.dot2{display:inline-block;width:8px;height:8px;border-radius:2px;transform:rotate(45deg);border:1.5px solid var(--accent);margin-right:9px;vertical-align:1px}
.dot2.verified{background:var(--ok);border-color:var(--ok)}.dot2.refuted{background:var(--bad);border-color:var(--bad)}
/* timeline */
.tl-h{font:650 1.15rem/1.3 var(--sans);margin:var(--s6) 0 var(--s1)}
.tl{list-style:none;margin:10px 0 0;padding:0;position:relative}
.tl li{display:grid;grid-template-columns:28px 1fr auto;gap:12px;align-items:start;padding:11px 4px;border-bottom:1px solid var(--line);font-size:.92rem}
.tl li.empty-li{display:block;color:var(--muted);border:1px dashed var(--rule);border-radius:12px;padding:14px}
.tl .ico{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font:600 .8rem/1 var(--mono);background:var(--card);border:1px solid var(--line);color:var(--muted)}
.tl .ico.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent)}.tl .ico.bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 35%,transparent)}
.tl .ico.acc{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 35%,transparent)}.tl .ico.cool{color:var(--cool);border-color:color-mix(in srgb,var(--cool) 35%,transparent)}
.tl .when{font:500 .74rem/1.9 var(--mono);color:var(--muted);white-space:nowrap}
.tl .what{min-width:0;overflow-wrap:anywhere}.tl .src{text-decoration:none;margin-left:4px}
.tl li.fresh{animation:flash 2.4s ease-out}
@keyframes flash{from{background:rgba(245,184,61,.14)}to{background:transparent}}
#tl-live:empty{display:none}#tl-live:not(:empty)+.tl .empty-li{display:none}
.part .camp,.part .tl,.part .cols{max-width:none}.hero2 .lede{max-width:760px}
.tag{font:600 .68rem/1 var(--mono);border-radius:6px;padding:3px 6px;border:1px solid var(--line);white-space:nowrap;letter-spacing:.02em}
.tag.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 30%,transparent)}.tag.bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 30%,transparent)}.tag.open{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 30%,transparent)}
/* per-problem progress, points ledger, notes and citations */
.progline{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s1) var(--s3);margin:var(--s2) 0 0}
.stage{display:inline-flex;align-items:center;gap:var(--s2);font:600 .68rem/1.6 var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.stage.s1{color:var(--cool)}.stage.s2,.stage.s3{color:var(--accent)}.stage.s4{color:var(--ok)}
.sgs{display:inline-flex;gap:3px}.sg{width:14px;height:5px;border-radius:3px;background:var(--line)}.sg.on{background:currentColor}
.pcount{color:var(--muted);font:500 .74rem/1.6 var(--mono)}
.prob .pt a{color:inherit;text-decoration:none}.prob .pt a:hover{text-decoration:underline}
.tablewrap{overflow-x:auto;margin:var(--s3) 0;border:1px solid var(--line);border-radius:var(--r2)}
table.ledger{width:100%;border-collapse:collapse;font-size:.86rem}
.ledger th,.ledger td{padding:var(--s2) var(--s3);border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.ledger th{font:600 .68rem/1.4 var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);white-space:nowrap}
.ledger td.num,.ledger th.num{text-align:right;white-space:nowrap}.ledger tfoot td{font-weight:650;border-bottom:0}.nowrap{white-space:nowrap}
.ledger td.what-c{min-width:6.5em}.ledger td.prob-c{min-width:11em}.ledger td.rule-c{min-width:11em}.ledger td.setup-c{min-width:8em}
.progline+p,.progline+pre{margin-top:var(--s4)}
.tag.pts{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 30%,transparent)}
.lb2 .pts a{color:inherit;text-decoration:none}.lb2 .pts a:hover{text-decoration:underline}
.notelist{list-style:none;margin:var(--s3) 0;padding:0}
.notelist li{padding:var(--s4) 0;border-bottom:1px solid var(--line)}.notelist li:first-child{border-top:1px solid var(--line)}
.notelist p{margin:var(--s2) 0}
.citebox{padding:var(--s4) var(--s5);margin:var(--s5) 0;border-radius:var(--r2)}
.citebox h2{margin:0 0 var(--s2);font-size:1.1rem}
.citebox code{display:block;white-space:normal;overflow-wrap:anywhere;padding:var(--s2) var(--s3);margin:var(--s2) 0;border-radius:var(--r1);background:var(--card);border:1px solid var(--line);font-size:.8rem}
.kids{list-style:none;padding:0;margin:var(--s2) 0}.kids li{padding:var(--s1) 0}
/* leaderboard, backers */
.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s6)}.cols h3{margin-top:0}
.lb2{list-style:none;margin:12px 0 0;padding:0;counter-reset:r}
.lb2 li{display:grid;grid-template-columns:2.2em 1fr auto;gap:2px 10px;padding:11px 0;border-bottom:1px solid var(--line);counter-increment:r}
.lb2 li::before{content:counter(r,decimal-leading-zero);color:var(--muted);font:500 .8rem/1.8 var(--mono);grid-row:span 2}
.lb2 li:first-child::before{color:var(--accent)}
.lb2 .pts{font:650 .9rem/1.6 var(--mono);color:var(--accent);text-align:right;justify-self:end;white-space:nowrap}.lb2 .small{grid-column:2/4}
.lb-row{display:flex;gap:12px;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--line)}
.lb-row .rank{flex:none;width:2em;color:var(--muted);font-family:var(--mono)}.lb-row .who{flex:1 1 5em;min-width:0;overflow-wrap:anywhere}
.lb-row .num{flex:none;min-width:3.2em;text-align:right;font-family:var(--mono);white-space:nowrap}
.lb-row.head{font:500 .7rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.backers2,.backers{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 12px}.backers2 .logos,.backers .logos{display:contents}
.logo{display:flex;flex-direction:column;justify-content:center;min-width:150px;max-width:260px;padding:10px 14px;color:var(--text);text-decoration:none;border-radius:12px}
.logo .nm{font:600 .95rem/1.25 var(--sans);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.logo .am{font:.72rem/1.4 var(--mono);color:var(--muted)}
.logo.slot{border-style:dashed;background:transparent;color:var(--muted);align-items:center;font-size:.88rem;box-shadow:none}
.logo.slot:hover{border-color:var(--accent);color:var(--accent)}
.joinbox{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--s4);align-items:center;padding:var(--s5) var(--s6);margin:var(--s7) 0 0;position:relative;overflow:hidden;border-color:color-mix(in srgb,var(--accent) 30%,var(--line))}
.joinbox::after{content:"";position:absolute;right:-80px;top:-80px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(245,184,61,.18),transparent 70%);pointer-events:none}
.joinbox h2{margin:0 0 6px}.joinbox p{color:var(--muted);margin:0 0 14px}
.joinbox code{display:block;background:color-mix(in srgb,var(--bg) 70%,transparent);border:1px solid var(--line);border-radius:10px;padding:11px 13px;color:var(--text)}
.note{padding:16px 18px;margin:20px 0}.note.scoring h3{margin-bottom:4px}.note.scoring ul{margin:6px 0 0}
.empty{padding:16px 18px;color:var(--muted);font-size:.9rem;border-style:dashed;box-shadow:none}
.ok{color:var(--ok);font-weight:600}.open{color:var(--warn);font-weight:600}.bad{color:var(--bad);font-weight:600}
.feed-item{padding:10px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.idea{white-space:pre-line;margin:6px 0 0;overflow-wrap:anywhere}
.name{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--line)}
.name .n{color:var(--muted);font-family:var(--mono);margin-right:8px}.name:target{background:var(--soft);border-radius:8px;padding-left:10px;padding-right:10px}
.tagline{margin-top:2px}.rightcol{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dashed{display:block;border:1px dashed var(--rule);border-radius:14px;padding:22px 16px;text-align:center;color:var(--muted);text-decoration:none;margin:0 0 14px}.dashed:hover{border-color:var(--accent)}
/* campaign page */
.tools{display:flex;flex-direction:column;gap:12px;margin:0 0 20px}.filters{display:flex;gap:8px;flex-wrap:wrap;margin:0}
input:not([type]),input[type=search],input[type=text],input[type=url],input[type=email],input[type=number],input[type=password],select,textarea{font:inherit;width:100%;padding:11px 14px;border-radius:10px;border:1px solid var(--rule);background:var(--card-solid);color:var(--text)}
input:focus,select:focus{outline:2px solid color-mix(in srgb,var(--accent) 70%,transparent);outline-offset:1px}
.lem{padding:18px 20px;margin:0 0 12px}.lem.hl{border-color:var(--accent);box-shadow:var(--glow)}
.lem-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.lem h3{font-size:1.02rem}.lem p{margin:4px 0 8px}
.under{margin:6px 0 10px 14px;padding-left:12px;border-left:1px dashed var(--rule)}.summit{margin-top:40px}
details{margin:0 0 8px}summary{cursor:pointer;font-weight:600;margin:0 0 12px}
pre.lean{margin:10px 0 0;padding:12px 14px;border-radius:10px;background:color-mix(in srgb,var(--bg) 82%,transparent);border:1px solid var(--line);overflow-x:auto;font:12.5px/1.6 var(--mono);white-space:pre-wrap;word-break:break-word}
pre.lean .k{color:#c792ea}pre.lean .o{color:var(--cool)}pre.lean .n{color:#f78c6c}pre.lean .t{color:var(--accent)}pre.lean .f{color:#82aaff}
:root[data-theme="light"] pre.lean .k{color:#7c3aed}:root[data-theme="light"] pre.lean .n{color:#c2410c}:root[data-theme="light"] pre.lean .f{color:#1d4ed8}
.codebox{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:14px 16px;margin:0 0 16px}.codebox code{flex:1;min-width:0;font-size:14px}
.step{display:flex;gap:14px;margin:0 0 18px}.step .k{flex:none;width:30px;height:30px;border-radius:9px;background:var(--soft);color:var(--accent);font:650 .9rem/1 var(--mono);display:flex;align-items:center;justify-content:center;border:1px solid color-mix(in srgb,var(--accent) 30%,transparent)}
.pledge{display:grid;gap:12px;max-width:520px;margin:0 0 18px}.pledge label{display:grid;gap:5px;font-size:.88rem;color:var(--muted)}.pledge .btn{justify-self:start}
#pledge-out .btn{margin-top:6px}img.qr{display:block;border:1px solid var(--line);border-radius:12px;background:#fff;padding:8px;margin:6px 0}
.statchart{width:100%;height:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}.statchart rect.v,.key.v{fill:var(--accent);background:var(--accent)}.statchart rect.u,.key.u{fill:var(--cool);background:var(--cool)}.statchart text{font:11px var(--mono);fill:var(--muted)}.key{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px}
.note-md{line-height:1.75}.note-md .claimk{font-weight:600;color:var(--accent,inherit)}.note-md h1{font-size:clamp(1.6rem,5vw,2.3rem)}.note-md pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto}.note-md pre code{font-size:13px;overflow-wrap:normal}
footer{border-top:1px solid var(--line);padding:26px 0 44px;color:var(--muted);font-size:.84rem}
footer .wrap{display:grid;grid-template-columns:1fr auto;gap:var(--s3) var(--s5);align-items:start}footer .flinks{grid-column:1/-1;order:-1;display:flex;flex-wrap:wrap;gap:var(--s1) var(--s3)}footer .flinks a{white-space:nowrap}footer a{color:var(--muted)}footer a:hover{color:var(--text)}
.avatar{position:relative;display:inline-grid;place-items:center;flex:none;border-radius:50%;overflow:hidden;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 35%,var(--card-solid)),color-mix(in srgb,var(--cool) 30%,var(--card-solid)));border:1px solid var(--rule);vertical-align:middle}
.avatar .ini{font:650 .9em/1 var(--mono);color:var(--text)}.avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.lb2 .avatar{margin-right:4px}.lb2 .avatar .ini{font-size:.55rem}
.prof{display:flex;gap:24px;align-items:flex-start;margin:0 0 24px}.prof-main{min-width:0;flex:1}.prof h1{margin:0 0 4px}.aff{font-weight:550;margin:6px 0}
.interests{display:flex;flex-wrap:wrap;gap:6px}.links{display:flex;flex-wrap:wrap;gap:8px}
.sharecard{padding:22px;margin:10px 0 8px;position:relative;overflow:hidden;border-color:color-mix(in srgb,var(--accent) 35%,var(--line))}
.sharecard::after{content:"";position:absolute;right:-60px;bottom:-60px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(245,184,61,.18),transparent 70%);pointer-events:none}
.sc-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 10px}.sc-top .kicker{margin:0}
.sc-line{font:600 1.15rem/1.4 var(--sans);letter-spacing:-.01em}
.sc-stats{display:flex;flex-wrap:wrap;gap:18px;margin:6px 0 12px}.sc-stats span{display:grid;font-size:.78rem;color:var(--muted)}.sc-stats b{font:650 1.4rem/1.1 var(--mono);color:var(--text)}
.badges{display:flex;flex-wrap:wrap;gap:6px}.badge{font:600 .72rem/1 var(--mono);padding:5px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);color:var(--accent);background:var(--soft)}
.badge.b-top{color:var(--cool);border-color:color-mix(in srgb,var(--cool) 40%,transparent);background:color-mix(in srgb,var(--cool) 10%,transparent)}
.people{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:var(--s3);align-items:stretch}
.person{display:flex;gap:14px;align-items:center;padding:14px 16px;border-radius:14px;color:var(--text);text-decoration:none;transition:border-color .15s}.person:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line));color:var(--text)}
.person .pi{display:grid;min-width:0;flex:1}.person .pi b{font-weight:600}.person .pp{display:grid;text-align:right}.person .pp b{font:650 1.1rem/1.1 var(--mono);color:var(--accent)}
@media (max-width:520px){.prof{flex-direction:column;gap:14px}}
.libtools{padding:16px;display:grid;gap:12px;margin:0 0 14px}
.librow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.chk{display:inline-flex;align-items:center;gap:7px;font-size:.88rem;color:var(--muted);margin-right:14px;cursor:pointer}.chk input{width:auto;accent-color:var(--accent)}
.libcard{padding:16px 18px;margin:0 0 12px}.lc-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.lc-top h3{margin:0}
.libcard .tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.libcard .stmt{color:color-mix(in srgb,var(--text) 85%,var(--muted));font-size:.93rem;margin:0 0 8px;overflow-wrap:anywhere}
.libcard .chip{display:inline-flex;align-items:baseline;gap:6px;padding:3px 9px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:.75rem;color:var(--muted)}
.lean-chip{color:var(--cool)}.vote{flex:none;font-family:var(--mono)}
@media (max-width:520px){.librow{grid-template-columns:1fr}}
.caveat{border-left:2px solid var(--accent);padding-left:10px}
.fambar{display:flex;height:10px;border-radius:999px;overflow:hidden;margin:14px 0 8px;background:var(--line)}.fambar span{display:block;height:100%}
.famlegend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.82rem;color:var(--muted)}.famlegend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px}.famlegend b{color:var(--text);font-family:var(--mono);font-weight:600}
.tablewrap{overflow-x:auto;margin:16px 0}.aitable{width:100%;border-collapse:collapse;font-size:.9rem}
.aitable th{font:500 .7rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);text-align:left;padding:12px 14px;border-bottom:1px solid var(--line)}
.aitable td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top}.aitable tr:last-child td{border-bottom:0}.aitable .num{text-align:right;font-family:var(--mono);white-space:nowrap}
.fam{display:block;margin-top:2px}.fam::before{content:"";display:inline-block;width:7px;height:7px;border-radius:2px;background:var(--c);margin-right:6px}
.setups{display:grid;gap:8px;margin:8px 0}.setup{display:grid;grid-template-columns:2.2em 1fr minmax(3em,auto);gap:var(--s3);align-items:center;padding:10px 14px;border-radius:12px;color:var(--text);text-decoration:none}.setup .pts{font:650 .9rem/1 var(--mono);color:var(--accent);text-align:right}
.curve{padding:var(--s4) var(--s4) var(--s3);margin:var(--s4) 0 0}.curve-head{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;margin:0 0 6px}.curve-head .kicker{margin:0}.curve-sum{font-weight:600}
.curve-svg{display:block;width:100%;height:auto}.curve-svg .gl{stroke:var(--line);stroke-width:1}.curve-svg .ax{font:11px var(--mono);fill:var(--muted)}
.curve-svg .cline{fill:none;stroke:var(--accent);stroke-width:2.5;filter:drop-shadow(0 0 6px rgba(245,184,61,.5))}.curve-svg .pline{fill:none;stroke:var(--cool);stroke-width:1.5;stroke-dasharray:4 4;opacity:.8}
.curve-svg .dot{fill:var(--accent);stroke:var(--bg);stroke-width:2;cursor:pointer}.curve-svg .dot.note{fill:var(--cool)}.curve-svg .dot.proof{fill:var(--ok)}.curve-svg .dot.refutation{fill:var(--bad)}
.curve-svg .dot.rej{fill:var(--muted);opacity:.45}.curve-svg a:hover .dot{stroke:var(--text)}
.curve-axis{display:flex;justify-content:space-between;gap:10px;font:.74rem/1.6 var(--mono);color:var(--muted);flex-wrap:wrap}.curve-axis .legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin:0 6px 2px 12px;vertical-align:middle}
.curve-axis .lc{background:var(--accent)}.curve-axis .lp{background:var(--cool)}.curve-axis .lr{background:var(--muted);height:8px!important;width:8px!important;border-radius:50%!important}
.bts{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--s3);margin:var(--s2) 0 0;align-items:stretch}
.bt{display:grid;gap:var(--s1);align-content:start;padding:14px 16px;border-radius:14px;color:var(--text);text-decoration:none;position:relative}.bt:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line));color:var(--text)}
.bt .ico{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font:600 .8rem/1 var(--mono);background:var(--card);border:1px solid var(--line)}.bt .ico.cool{color:var(--cool)}.bt .ico.ok{color:var(--ok)}.bt .ico.acc{color:var(--accent)}.bt .ico.bad{color:var(--bad)}
.bt-k{font:600 .7rem/1 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
@media (max-width:520px){.curve{padding:12px 10px 8px}.curve-axis .legend{order:3;width:100%}}
.navjoin{height:var(--ctl);padding:0 14px;margin-left:var(--s1)}
.joinform{display:grid;gap:var(--s4);padding:var(--s5);max-width:640px}.joinform label{display:grid;gap:6px;font-size:.88rem;color:var(--muted)}
.joinform fieldset{border:0;margin:0;padding:0}.joinform legend{font-size:.88rem;color:var(--muted);margin:0 0 var(--s2)}
.opts{display:flex;flex-wrap:wrap;gap:var(--s2)}.opt{display:inline-flex!important;align-items:center;gap:8px!important;padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--text)!important;cursor:pointer}
.opt input{width:auto;accent-color:var(--accent)}.opt:has(input:checked){border-color:color-mix(in srgb,var(--accent) 60%,transparent);background:var(--soft)}
.consent{border-radius:12px!important}.hp{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}
.joinout{padding:var(--s5);max-width:640px}.joinout h2{margin-top:0}
.joincta{display:flex;justify-content:space-between;align-items:center;gap:var(--s4);flex-wrap:wrap;padding:var(--s4) var(--s5);margin:var(--s5) 0}.joincta h3{margin:0 0 2px}.joincta p{margin:0}
.wxqr{display:inline-grid;justify-items:center;gap:6px;padding:var(--s3);border:1px solid var(--line);border-radius:var(--r2);background:#fff;margin:var(--s2) 0}.wxqr p{color:#555;margin:0}
.rss{display:inline-flex;align-items:center;gap:4px}
@media (max-width:1100px){.navjoin{order:-1}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media (max-width:900px){.cols{grid-template-columns:1fr;gap:0}.joinbox{grid-template-columns:1fr}}
@media (max-width:520px){.wrap{padding:0 16px}main{padding-top:32px}.hero2{padding:40px 0 28px;margin-top:-32px}.camp{padding:16px 14px 8px}.branch{padding-left:12px}
.tl li{grid-template-columns:26px 1fr;gap:4px 10px}.tl .when{grid-column:2;grid-row:2;line-height:1.3}.logo{min-width:0;flex:1 1 40%}.joinbox{padding:20px}
header.top nav{gap:0;font-size:.84rem}nav a{padding:6px 7px}}
`;

const JS = `
(function(){var D=${jsonForScript(I18N)};window.__D=D;var site=document.body.getAttribute("data-site")||"";
function set(l){document.documentElement.lang=l==="zh"?"zh-CN":"en";
document.querySelectorAll("[data-i18n]").forEach(function(e){var v=D[l][e.getAttribute("data-i18n")];if(v!=null)e.textContent=v;});
document.querySelectorAll("[data-i18n-ph]").forEach(function(e){var v=D[l][e.getAttribute("data-i18n-ph")];if(v!=null)e.setAttribute("placeholder",v);});
document.querySelectorAll("[data-lang]").forEach(function(e){e.hidden=e.getAttribute("data-lang")!==l;});
var tk=document.body.getAttribute("data-title-key");if(tk&&D[l][tk])document.title=D[l][tk]+" · "+site;
var b=document.getElementById("lang");if(b)b.textContent=l==="zh"?"EN":"中文";
try{localStorage.setItem("lang",l);}catch(e){}window.__lang=l;}
var l=null;try{l=localStorage.getItem("lang");}catch(e){}
if(l!=="en"&&l!=="zh")l=(navigator.language||"").toLowerCase().indexOf("zh")===0?"zh":"en";
set(l);var b=document.getElementById("lang");if(b)b.addEventListener("click",function(){set(window.__lang==="zh"?"en":"zh");rel();});
var th=document.getElementById("theme");if(th)th.addEventListener("click",function(){var r=document.documentElement,n=r.getAttribute("data-theme")==="light"?"dark":"light";r.setAttribute("data-theme",n);try{localStorage.setItem("theme",n);}catch(e){}});
function rel(){var L=window.__lang==="zh";document.querySelectorAll("[data-at]").forEach(function(e){var ms=Date.parse(e.getAttribute("data-at"));if(!isFinite(ms))return;var d=Math.floor((Date.now()-ms)/864e5);
e.textContent=d<=0?(L?"今天":"today"):d===1?(L?"昨天":"yesterday"):d<30?(L?d+" 天前":d+" days ago"):e.getAttribute("data-at");});}
rel();
document.querySelectorAll("img.av-img").forEach(function(i){function gone(){i.remove();}i.addEventListener("error",gone);if(i.complete&&!i.naturalWidth)gone();});
var cu=document.querySelectorAll("[data-count]");var still=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
cu.forEach(function(e){var to=Number(e.getAttribute("data-count"));if(!isFinite(to)||still||to===0)return;var t0=null;
function f(ts){if(t0===null)t0=ts;var k=Math.min(1,(ts-t0)/900),v=Math.round(to*(1-Math.pow(1-k,3)));e.textContent=v.toLocaleString();if(k<1)requestAnimationFrame(f);}e.textContent="0";requestAnimationFrame(f);});
document.querySelectorAll("[data-copy]").forEach(function(btn){btn.addEventListener("click",function(){
var zh=window.__lang==="zh"&&btn.hasAttribute("data-copy-zh");
var v=btn.getAttribute(zh?"data-copy-zh":"data-copy");if(v.charAt(0)==="#")v=location.href.split("#")[0]+v;
var lbl=btn.querySelector("[data-i18n]");
var reset=function(){if(lbl)lbl.textContent=D[window.__lang][lbl.getAttribute("data-i18n")];};
var done=function(){if(lbl)lbl.textContent=D[window.__lang].copied;setTimeout(reset,1200);};
if(navigator.clipboard)navigator.clipboard.writeText(v).then(done,function(){});});});
document.querySelectorAll("[data-tab]").forEach(function(btn){btn.addEventListener("click",function(){var k=btn.getAttribute("data-tab");
document.querySelectorAll("[data-tab]").forEach(function(x){x.setAttribute("aria-pressed",x===btn?"true":"false");});
document.querySelectorAll("[data-panel]").forEach(function(p){p.hidden=p.getAttribute("data-panel")!==k;});});});
})();`;

// Live task desk: reads only the public status, never sends anything. Emitted only when a desk is configured.
const DESK_JS = `
(function(){
var desk=document.body.getAttribute("data-desk");
if(!desk)return;
var last=null,NS="http://www.w3.org/2000/svg";
function lang(){return window.__lang==="zh"?"zh":"en";}
function tr(k){var d=window.__D;return d&&d[lang()]&&d[lang()][k]!=null?d[lang()][k]:k;}
function el(id){return document.getElementById(id);}
function num(v){if(typeof v!=="number"&&typeof v!=="string")return null;if(v==="")return null;var n=Number(v);return isFinite(n)?n:null;}
function fmt(n){return Math.round(n||0).toLocaleString(lang()==="zh"?"zh-CN":"en-US");}
function str(v,max){return typeof v==="string"?v.slice(0,max):"";}
function ago(at){var ms=Date.parse(str(at,40));if(!isFinite(ms))return "";var m=Math.max(0,Math.round((Date.now()-ms)/60000));
if(m<1)return tr("just_now");if(m<60)return m+" "+tr("min_ago");var h=Math.round(m/60);if(h<48)return h+" "+tr("hr_ago");return Math.round(h/24)+" "+tr("day_ago");}
var VERBS={checked:"feed_checked",refuted:"feed_refuted",claimed:"feed_claimed",released:"feed_released",submitted:"feed_submitted"};
var REASONS={hypothesis_too_weak:"r_hypothesis_too_weak",missing_lemma:"r_missing_lemma",statement_seems_false:"r_statement_seems_false",does_not_elaborate:"r_does_not_elaborate",out_of_time:"r_out_of_time",other:"r_other"};
var TITLES={};try{TITLES=JSON.parse(el("task-titles").textContent)||{};}catch(e){}
var ROLES={redteam:"role_redteam"};
function has(o,k){return Object.prototype.hasOwnProperty.call(o,k);}
function clear(n){while(n.firstChild)n.removeChild(n.firstChild);}
function node(tag,cls,s){var e=document.createElement(tag);if(cls)e.className=cls;e.textContent=s;return e;}
function hue(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h;}
function title(id){return has(TITLES,id)?TITLES[id][lang()==="zh"?1:0]:id;}
function parse(e){var type=str(e.type,40);var head=type.split(":")[0],tail=type.slice(head.length+1);if(head==="took")head="claimed";return {head:head,tail:tail};}
function renderFeed(list){
var f=el("feed");if(!f)return;
if(!list.length)return;
clear(f);
list.forEach(function(e){
var p=parse(e),verb=has(VERBS,p.head)?tr(VERBS[p.head]):tr("feed_other");
if(p.head==="claimed"&&has(ROLES,p.tail))verb+=" ("+tr(ROLES[p.tail])+")";
if(p.head==="released"&&p.tail==="submitted")verb=tr("feed_submitted");
else if(p.head==="released"&&has(REASONS,p.tail))verb+=" ("+tr(REASONS[p.tail])+")";
var h=str(e.handle,40);
var row=node("div","msg","");
var av=node("span","av",h.slice(0,2).toUpperCase());av.style.background="hsl("+hue(h)+" 45% 42%)";row.appendChild(av);
var top=document.createElement("div");top.appendChild(node("span","who",h));top.appendChild(node("span","when",ago(e.at)));row.appendChild(top);
row.appendChild(node("div","what",verb+" "+title(str(e.task,120))));
f.appendChild(row);});}
function renderGraph(list){
var g=el("agents");if(!g)return;clear(g);
document.querySelectorAll("#fleet-svg .n.busy").forEach(function(n){n.classList.remove("busy");});
var at={};list.slice().reverse().forEach(function(e){var p=parse(e),h=str(e.handle,40);if(p.head==="claimed")at[h]=str(e.task,120);else if(p.head==="released"&&at[h]===str(e.task,120))delete at[h];});
var per={};
Object.keys(at).forEach(function(h){
var t=document.querySelector('#fleet-svg .n[data-id="'+at[h].replace(/[^a-z0-9-]/g,"")+'"]');if(!t)return;
t.classList.add("busy");var k=at[h];per[k]=(per[k]||0)+1;
var x=Number(t.getAttribute("data-x")),y=Number(t.getAttribute("data-y"))-9-per[k]*10;
var a=document.createElementNS(NS,"g");a.setAttribute("class","agent");
var c=document.createElementNS(NS,"circle");c.setAttribute("cx",x-14);c.setAttribute("cy",y);c.setAttribute("r",3);a.appendChild(c);
var tx=document.createElementNS(NS,"text");tx.setAttribute("x",x-20);tx.setAttribute("y",y+3);tx.setAttribute("text-anchor","end");tx.textContent=h.slice(0,14);a.appendChild(tx);
g.appendChild(a);});}
function renderReasons(obj){
var box=el("reasons"),rows=el("reasons-rows");if(!box||!rows)return;
clear(rows);
var counts=Object.create(null);
if(obj&&typeof obj==="object"&&!Array.isArray(obj)){
Object.keys(obj).forEach(function(k){
if(k==="submitted")return;var n=num(obj[k]);if(n==null||n<=0)return;
var key=has(REASONS,k)?k:"other";counts[key]=(counts[key]||0)+n;});}
var keys=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a]||(a<b?-1:a>b?1:0);});
box.hidden=!keys.length;
keys.forEach(function(k){
var row=document.createElement("div");row.className="lb-row";
row.appendChild(node("span","who",tr(REASONS[k])));
row.appendChild(node("span","num fig",fmt(counts[k])));
rows.appendChild(row);});}
function live(on,text){var p=el("live-pill"),b=el("hub-badge");if(p)p.classList.toggle("on",on);if(b)b.classList.toggle("on",on);
var pt=el("pill-text");if(pt)pt.textContent=text;var bt=el("badge-text");if(bt)bt.textContent=on?tr("badge_live"):tr("badge_off");}
function render(d){
if(!d||typeof d!=="object"||Array.isArray(d))return;
last=d;
var n=num(d.agents_now)||0;
live(true,fmt(n)+" "+tr("pill_on"));
document.querySelectorAll(".stat-hour").forEach(function(s){s.textContent=fmt(num(d.submitted_last_hour));});
var w=el("stat-hour-wrap");if(w)w.hidden=false;
var rec=Array.isArray(d.recent)?d.recent.filter(function(e){return e&&typeof e==="object";}).slice(0,30):[];
renderFeed(rec.slice(0,15));renderGraph(rec);
renderReasons(d.by_reason_24h);}
function load(){
fetch(desk+"/desk/status",{credentials:"omit"}).then(function(r){if(!r.ok)throw new Error("status");return r.json();}).then(render).catch(function(){if(!last)live(false,tr("pill_off"));});}
var lb=el("lang");if(lb)lb.addEventListener("click",function(){if(last)render(last);});
load();setInterval(load,30000);
})();`;


// Sponsor wall and pledge form. Reads /desk/sponsors and posts only the pledge form the visitor fills in.
const SPONSOR_JS = `
(function(){
var desk=document.body.getAttribute("data-sponsors");if(!desk)return;
function lang(){return window.__lang==="zh"?"zh":"en";}
function tr(k){var d=window.__D;return d&&d[lang()]&&d[lang()][k]!=null?d[lang()][k]:k;}
function el(id){return document.getElementById(id);}
function clear(n){while(n.firstChild)n.removeChild(n.firstChild);}
function node(tag,cls,s){var e=document.createElement(tag);if(cls)e.className=cls;e.textContent=s;return e;}
function str(v,max){return typeof v==="string"?v.slice(0,max):"";}
function money(v){var n=Number(v);return isFinite(n)?"US$"+n.toLocaleString("en-US",{maximumFractionDigits:2}):"";}
var LINK=/^https:\\/\\/[A-Za-z0-9.-]+(\\/[A-Za-z0-9._~\\/-]*)?$/;
var last=null;
function nameNode(p,cls){var link=str(p.link,200);var a=document.createElement(LINK.test(link)?"a":"span");if(cls)a.className=cls;
if(a.tagName==="A"){a.href=link;a.rel="sponsored nofollow noopener";}var t=str(p.tagline,80);if(t)a.title=t;return a;}
function render(list){
last=list;
var logos=el("backer-logos");
if(logos&&list.length){clear(logos);list.slice(0,6).forEach(function(p){var a=nameNode(p,"logo");
a.appendChild(node("span","nm",str(p.name,60)));a.appendChild(node("span","am",money(p.pledged)+" "+tr(Number(p.paid)>0?"paid_lbl":"pledged")));logos.appendChild(a);});}
var wall=el("wall");
if(wall){clear(wall);
if(!list.length){wall.appendChild(node("p","empty",tr("wall_empty")));return;}
list.forEach(function(p){var row=node("div","name","");var left=document.createElement("div");
left.appendChild(node("span","n","#"+(Number(p.rank)||"")+" "));var nm=nameNode(p,"");nm.textContent=str(p.name,60);left.appendChild(nm);
var t=str(p.tagline,80);if(t)left.appendChild(node("div","small muted tagline",t));row.appendChild(left);
var right=node("div","rightcol","");right.appendChild(node("span","fig",money(p.pledged)));
right.appendChild(node("span","small "+(Number(p.paid)>0?"ok":"muted"),tr(Number(p.paid)>0?"paid_lbl":"pledged")));row.appendChild(right);wall.appendChild(row);});}}
function load(){fetch(desk+"/desk/sponsors",{credentials:"omit"}).then(function(r){if(!r.ok)throw new Error("s");return r.json();})
.then(function(d){if(d&&Array.isArray(d.sponsors))render(d.sponsors.filter(function(x){return x&&typeof x==="object";}).slice(0,500));})
.catch(function(){var w=el("wall");if(w&&!last){clear(w);w.appendChild(node("p","empty",tr("wall_off")));}});}
load();
var lb=el("lang");if(lb)lb.addEventListener("click",function(){if(last)render(last);});
var f=el("pledge-form");
if(f){try{var pj=JSON.parse(sessionStorage.getItem("ph-join")||"null");if(pj&&typeof pj==="object"){if(typeof pj.name==="string"&&!f.elements.name.value)f.elements.name.value=pj.name.slice(0,60);if(typeof pj.email==="string"&&!f.elements.email.value)f.elements.email.value=pj.email.slice(0,254);}}catch(e){}}
if(f)f.addEventListener("submit",function(ev){ev.preventDefault();
var out=el("pledge-out"),btn=f.querySelector("button[type=submit]");btn.disabled=true;clear(out);
var body={name:f.elements.name.value,tagline:f.elements.tagline.value,link:f.elements.link.value,amount:Number(f.elements.amount.value),email:f.elements.email.value};
fetch(desk+"/desk/pledge",{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
.then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok,status:r.status,j:j||{}};});})
.then(function(x){
if(x.ok){out.appendChild(node("p","ok",tr("pledge_ok").replace("{amount}",money(x.j.amount)).replace("{total}",money(x.j.total_pledged))));
var pp=f.getAttribute("data-paypal");
if(pp&&/^[A-Za-z0-9]{1,20}$/.test(pp)){var a=node("a","btn primary",tr("pay_paypal"));a.rel="noopener";a.href="https://paypal.me/"+pp+"/"+Number(x.j.amount).toFixed(2)+"USD";out.appendChild(a);}
out.appendChild(node("p","small muted",tr("pledge_next")));
var aq=f.getAttribute("data-alipay");
if(aq&&/^[A-Za-z0-9_\\/-]+\\.(png|jpg|jpeg|webp)$/.test(aq)){out.appendChild(node("p","small",tr("pay_alipay")));var im=document.createElement("img");im.src=aq;im.alt="Alipay";im.width=220;im.height=220;im.className="qr";out.appendChild(im);}
f.reset();load();}
else if(x.status===404||x.status>=500)out.appendChild(node("p","muted",tr("pledge_soon")));
else out.appendChild(node("p","bad",tr("pledge_err")+" "+str(x.j.error,200)));})
.catch(function(){out.appendChild(node("p","muted",tr("pledge_soon")));})
.then(function(){btn.disabled=false;});});
})();`;

// One anonymous page-view count per page load: the path and the referring site's host name, nothing else.
// No cookie, no storage, no identifier. Sent to the task desk only (the CSP allows no other address).
const BEACON_JS = `
(function(){try{var u=${jsonForScript(deskUrl)}+"/desk/hit",r="";
try{r=document.referrer?new URL(document.referrer).hostname:"";}catch(e){}if(r===location.hostname)r="";
var b=JSON.stringify({path:location.pathname.slice(0,120),ref:r.slice(0,100)});
if(navigator.sendBeacon&&navigator.sendBeacon(u,new Blob([b],{type:"text/plain"})))return;
fetch(u,{method:"POST",body:b,keepalive:true,credentials:"omit",headers:{"Content-Type":"text/plain"}}).catch(function(){});}catch(e){}})();`;

// Private traffic page: not linked anywhere, noindex. The owner pastes the admin token; it is kept in
// sessionStorage for this tab only and sent only to the desk.
const STATS_JS = `
(function(){
var desk=${jsonForScript(deskUrl)};
function el(id){return document.getElementById(id);}
function node(tag,cls,s){var e=document.createElement(tag);if(cls)e.className=cls;e.textContent=s;return e;}
function clear(n){while(n.firstChild)n.removeChild(n.firstChild);}
function getTok(){try{return sessionStorage.getItem("ph-admin")||"";}catch(e){return "";}}
function setTok(v){try{if(v)sessionStorage.setItem("ph-admin",v);else sessionStorage.removeItem("ph-admin");}catch(e){}}
function table(id,rows){var box=el(id);clear(box);if(!rows.length){box.appendChild(node("p","muted small","none"));return;}
rows.forEach(function(r){var row=node("div","lb-row","");row.appendChild(node("span","who",String(r.key)));row.appendChild(node("span","num fig",String(r.n)));box.appendChild(row);});}
function chart(days){var svg=el("chart");while(svg.firstChild)svg.removeChild(svg.firstChild);var NS="http://www.w3.org/2000/svg";
var W=720,H=200,max=1;days.forEach(function(d){max=Math.max(max,d.views);});var bw=W/days.length;
days.forEach(function(d,i){[["views","v",d.views],["visitors","u",d.visitors]].forEach(function(k,j){var h=Math.round((k[2]/max)*(H-24));
var r=document.createElementNS(NS,"rect");r.setAttribute("x",String(i*bw+1+j*bw*0.45));r.setAttribute("y",String(H-16-h));r.setAttribute("width",String(Math.max(1,bw*0.42)));r.setAttribute("height",String(h));r.setAttribute("class",k[1]);
var t=document.createElementNS(NS,"title");t.textContent=d.date+" "+k[0]+": "+k[2];r.appendChild(t);svg.appendChild(r);});});
var a=document.createElementNS(NS,"text");a.setAttribute("x","0");a.setAttribute("y",String(H-2));a.textContent=days.length?days[0].date:"";svg.appendChild(a);
var b=document.createElementNS(NS,"text");b.setAttribute("x",String(W));b.setAttribute("y",String(H-2));b.setAttribute("text-anchor","end");b.textContent=days.length?days[days.length-1].date:"";svg.appendChild(b);}
function load(){var tok=getTok();el("out").hidden=true;el("msg").textContent="";if(!tok)return;
var days=Number(el("days").value)||30;
fetch(desk+"/desk/admin/stats?days="+days,{credentials:"omit",headers:{Authorization:"Bearer "+tok}}).then(function(r){
if(r.status===401){setTok("");throw new Error("Wrong token.");}if(!r.ok)throw new Error("The desk answered "+r.status+".");return r.json();})
.then(function(d){var v=0,u=0,su=0;d.days.forEach(function(x){v+=x.views;u+=x.visitors;su+=Number(x.signups)||0;});
el("sum").textContent=v+" views, "+u+" daily visitors and "+su+" sign-ups over "+d.days.length+" days. Last 24 hours: "+d.last_24h+" views.";
table("signups",d.days.filter(function(x){return Number(x.signups)>0;}).reverse().map(function(x){return {key:x.date,n:x.signups};}));
chart(d.days);table("paths",d.paths);table("refs",d.referrers);table("countries",d.countries);el("out").hidden=false;})
.catch(function(e){el("msg").textContent=e.message;});}
el("tokform").addEventListener("submit",function(ev){ev.preventDefault();setTok(el("tok").value.trim());el("tok").value="";load();});
el("days").addEventListener("change",load);el("forget").addEventListener("click",function(){setTok("");el("out").hidden=true;});
load();
})();`;

const LEMMA_JS = `
(function(){
var items=JSON.parse(document.getElementById("lemma-data").textContent);
var filt="all",qv="";
function visible(it){
  if(filt!=="all"&&it.st!==filt)return false;
  return !qv||it.s.indexOf(qv)!==-1;
}
function marks(){document.querySelectorAll("[data-filter]").forEach(function(b){b.setAttribute("aria-pressed",b.getAttribute("data-filter")===filt?"true":"false");});}
function apply(){var n=0;items.forEach(function(it){var ok=visible(it);document.getElementById("l-"+it.id).hidden=!ok;if(ok)n++;});
  document.getElementById("empty").hidden=n>0;}
document.querySelectorAll("[data-filter]").forEach(function(b){b.addEventListener("click",function(){filt=b.getAttribute("data-filter");marks();apply();});});
document.getElementById("q").addEventListener("input",function(e){qv=e.target.value.trim().toLowerCase();apply();});
document.getElementById("pick").addEventListener("click",function(){
  var open=items.filter(function(it){return it.st==="open";}).slice(0,5);
  if(!open.length)return;
  var r=open[Math.floor(Math.random()*open.length)];
  filt="all";qv="";document.getElementById("q").value="";marks();apply();
  document.querySelectorAll(".lem.hl").forEach(function(e){e.classList.remove("hl");});
  var el=document.getElementById("l-"+r.id);el.classList.add("hl");
  var d=el.closest("details");if(d)d.open=true;
  el.scrollIntoView({behavior:"smooth",block:"center"});
});
})();`;

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: https://github.com https://avatars.githubusercontent.com; font-src 'self'; connect-src 'self'${deskOn ? ` ${deskUrl}` : ""}; base-uri 'none'; form-action 'none'`;

const NAV = [
  ["index.html", "nav_campaigns", ["title_home", "title_lemmas"]],
  ...(existsSync(at("site/library")) ? [["library.html", "nav_library", ["title_library"]]] : []),
  ...(typeof peoplePage === "function" ? [["people.html", "nav_people", ["title_people", "title_profile"]]] : []),
  ["models.html", "nav_ai", ["title_ai"]],
  ["join.html", "nav_join", ["title_join"]],
  ["credit.html", "nav_credit", ["title_credit", "title_publish"]],
  ["about.html", "nav_about", ["title_about"]],
];
function page({ key, body, extra = "", bodyAttrs = "", wide = false, pill = "", top = "", sub = "", prefix = "", title = "", beacon = true, noindex = false, meta = "" }) {
  const W = wide ? "wrap wide" : "wrap";
  const R = prefix;
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">${noindex ? `
<meta name="robots" content="noindex, nofollow">` : ""}
<title>${esc(title || I18N.en[key])} · ${esc(cfg.site_name)}</title>
<meta name="description" content="${esc(I18N.en.tagline)}">${meta}
<link rel="alternate" type="application/rss+xml" title="ProofHive" href="${R}feed.xml">
<style>${CSS.replaceAll("__R__", R)}</style>
<script>try{var q=/[?&]theme=(light|dark)/.exec(location.search),t=q?q[1]:localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>
</head>
<body data-title-key="${title ? "" : key}" data-site="${esc(cfg.site_name)}"${bodyAttrs ? ` ${bodyAttrs}` : ""}>
${top}<header class="top"><div class="${W}">
<a class="brand" href="${R}index.html"><svg class="hex" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/></svg>${esc(cfg.site_name)}</a>
<nav>${pill}${NAV.map(([href, k, keys]) => `<a href="${R}${href}"${keys.includes(key) ? ' aria-current="page"' : ""}>${t(k)}</a>`).join("")}<a class="btn primary sm navjoin" href="${R}signup.html">${t("nav_signup")}</a><button class="theme" id="theme" type="button" aria-label="Toggle light or dark theme">◐</button><button class="lang" id="lang" type="button">中文</button></nav>
</div></header>
${sub}<main><div class="${W}">
${body}
</div></main>
<footer><div class="${W}"><span>${t("footer_rule")}</span><span class="flinks"><a href="${R}credit.html">${t("nav_credit")}</a> · <a href="${R}publish.html">${t("title_publish")}</a> · <a href="${R}names.html">${t("nav_names")}</a> · <a href="${R}sponsor.html">${t("nav_sponsor")}</a> · <a href="${R}terms.html">${t("nav_terms")}</a> · <a href="${R}refunds.html">${t("nav_refunds")}</a> · <a href="${R}privacy.html">${t("nav_privacy")}</a>${CONTACT ? ` · ${t("contact")}: <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a>` : ""}</span><span><a class="rss" href="${R}feed.xml" title="RSS"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5 3a16 16 0 0 1 16 16h-3A13 13 0 0 0 5 6zm0 6a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7zm2 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg> RSS</a> · <a href="${esc(cfg.repo_url)}" rel="noopener">${t("repo")}</a> · ${t("build")} ${esc(sha)}</span></div></footer>
<script>${JS}</script>
${deskOn && beacon ? `<script>${BEACON_JS}</script>` : ""}
${extra}
</body>
</html>
`;
}

// ---------- shared blocks ----------
const S_ = SCORING;
const scoringBox = () => `<div class="note scoring" id="scoring"><h3>${t("scoring_h")}</h3><ul class="plain small">
<li>${pair(`Accepted split: ${S_.split_base} + ${S_.split_per_step} per step, times the parent's weight.`, `被接受的拆分：${S_.split_base} 分，每个步骤再加 ${S_.split_per_step} 分，乘以上级命题的权重。`)}</li>
<li>${pair(`Proof of a step: ${S_.step_proof} times the step's weight. Proof of an open problem: ${S_.problem_proof}.`, `证明一个步骤：${S_.step_proof} 分乘以该步骤的权重。证明一个未解决问题：${S_.problem_proof} 分。`)}</li>
<li>${pair("A refutation scores the same as a proof of that statement.", "推翻一个命题，得分与证明它相同。")}</li>
<li>${pair(`Research note: ${S_.note_points} times the record's weight. A note is groundwork, not a proof.`, `研究笔记：${S_.note_points} 分乘以该命题的权重。笔记是基础工作，不是证明。`)}</li>
<li>${pair(`Citation bonus: ${S_.note_bonus} to a note's author each time a later accepted note or split by someone else links that note's permalink.`, `引用奖励：之后被接受的别人的笔记或拆分每链接一次某篇笔记的永久地址，该笔记作者得 ${S_.note_bonus} 分。`)}</li>
<li>${pair("Every point is listed, with the rule applied, in each contributor's points ledger.", "每一分都列在贡献者的积分明细里，并写明所用规则。")}</li>
<li>${pair(`When a step of your split is later proven, you get ${S_.split_bonus} more.`, `你的拆分中的某个步骤后来被证明时，你再得 ${S_.split_bonus} 分。`)}</li>
<li>${pair(`Weight: open problems 1. A step has its parent's weight times ${S_.step_weight_factor}, never below ${S_.min_weight}, so deep tiny splits are worth little.`, `权重：未解决问题为 1。步骤的权重是上级权重乘以 ${S_.step_weight_factor}，最低 ${S_.min_weight}，所以层层细拆的小步骤分值很低。`)}</li>
<li>${pair("Only merged results count. Rejected or reverted work scores 0.", "只有已合并的结果计分。被拒绝或被撤回的内容得 0 分。")}</li>
</ul></div>`;
const lbTable = (rows, emptyKey) => {
  if (!rows.length) return `<p class="empty">${t(emptyKey)}</p>`;
  const head = `<div class="lb-row head"><span class="rank">#</span><span class="who">${t("col_who")}</span><span class="num">${t("col_proofs")}</span><span class="num">${t("col_splits")}</span><span class="num">${t("col_refuted")}</span><span class="num">${t("col_points")}</span></div>`;
  const body = rows.map((e, i) => `<div class="lb-row"><span class="rank">${i + 1}</span><span class="who">${ghUser(e.who)}</span><span class="num fig">${num(e.proofs)}</span><span class="num fig">${num(e.splits)}</span><span class="num fig">${num(e.refutations)}</span><span class="num fig"><a href="c/${esc(e.who)}.html#ledger">${num(e.points)}</a></span></div>`).join("");
  return head + body;
};

const supporterRow = (s, label) => {
  const name = s.url ? `<a href="${esc(s.url)}" rel="sponsored nofollow noopener">${esc(s.name)}</a>` : esc(s.name);
  return `<div class="name" id="n-${s.n}"><div><span class="n">${esc(label)}</span>${name}${s.tagline ? `<div class="small muted tagline">${esc(s.tagline)}</div>` : ""}</div><div class="rightcol"><span class="fig">${usd(s.amount)}</span><span class="small muted">${esc(s.date)}</span><button class="btn sm" type="button" data-copy="#n-${s.n}"><span class="lbl" data-i18n="copy_link">${esc(I18N.en.copy_link)}</span></button></div></div>`;
};

const supportBtn = cfg.sponsor_url && SPONSOR_RE.test(cfg.sponsor_url)
  ? `<a class="btn primary" href="${esc(cfg.sponsor_url)}" rel="noopener">${t("support_btn")}</a>`
  : `<span class="btn disabled" aria-disabled="true">${t("support_soon")}</span>`;

// Shared lemma card, used on the home page and the lemmas page.
const KIND_KEY = { summit: "kind_summit", drop: "kind_drop", milestone: "kind_milestone", program: "kind_program", step: "kind_step" };
function lemmaCard(r) {
  const status = r.status === "verified" ? `<span class="ok">${t("status_verified")}</span>`
    : r.status === "refuted" ? `<span class="bad">${t("status_refuted")}</span>`
    : `<span class="open">${t("status_open")}</span>`;
  const bits = [t(KIND_KEY[r.kind])];
  bits.push(pair(`difficulty ${r.difficulty}`, `难度 ${r.difficulty}`));
  if (r.status === "verified") bits.push(`${t("by")} ${ghUser(r.proved_by)}`);
  if (r.status === "refuted") bits.push(`${t("refuted_by")} ${ghUser(r.proved_by)}`);
  const sketch = r.kind === "step" && r.sketch ? `<p class="small idea">${esc(String(r.sketch).slice(0, 400))}</p>` : "";
  const splitDir = r.kind === "step" && existsSync(at(`OpenConjecture/Collatz/Splits/${r.split}.lean`)) ? "Splits" : "Proposals";
  const split = r.kind === "step" && r.split ? `<p class="small"><a href="${esc(cfg.repo_url)}/blob/main/OpenConjecture/Collatz/${splitDir}/${esc(r.split)}.lean" rel="noopener">${t("split_note")}</a></p>` : "";
  if (r.kind === "step" && r.proposed_by) bits.push(`${t("proposed_by")} ${ghUser(r.proposed_by)}`);
  const myNotes = notes.filter((n) => n.record === r.id);
  const notesHtml = myNotes.length ? `<p class="small">${pair("Research notes:", "研究笔记：")} ${myNotes.map((n) => `<a href="${notePage(n)}">${esc(n.title)}</a> (@${esc(n.who)}, ${esc(n.date)})`).join(" · ")}</p>` : "";
  const about = r.kind === "program" && (r.about_en || r.about_zh) ? `<p class="small idea">${pair(r.about_en || "", r.about_zh || "")}</p>` : "";
  return `<article class="lem" id="l-${esc(r.id)}">
<div class="lem-top"><h3><a href="${probPage(r)}">${pair(r.title_en, r.title_zh)}</a></h3>${status}</div>
<p class="small muted">${bits.join(" · ")}</p>
${about}${sketch}${split}${notesHtml}
${leanBlock(r)}<p class="small muted mono">${esc(r.statement)}</p>
</article>`;
}

// ---------- pages ----------
// ---------- Lean statements, syntax-highlighted ----------
const leanBodies = new Map([...readFileSync(at("OpenConjecture/Collatz/Lemmas.lean"), "utf8").matchAll(/^def ([A-Za-z0-9_]+) : Prop := (.*)$/gm)].map((m) => [m[1], m[2]]));
function leanOf(r) {
  if (leanBodies.has(r.statement)) return leanBodies.get(r.statement);
  const f = at(`OpenConjecture/Collatz/Proposals/${r.statement}.lean`);
  if (!existsSync(f)) return "";
  const m = new RegExp(`^def ${r.statement} : Prop :=([\\s\\S]*?)^end OpenConjecture\\.Collatz`, "m").exec(readFileSync(f, "utf8"));
  return m ? m[1].trim() : "";
}
function leanHtml(src) {
  const re = /(\b(?:fun|if|then|else|let|in|by|Prop|Filter|Finset|Set|Nat)\b)|([∀∃λ→↔∧∨¬≤≥≠<>=+*\/^%∣]|:=|\|)|(\b\d+(?:\.\d+)?\b)|(ℕ|ℝ|ℤ)|(\b(?:Reaches|step|Conjecture|Tendsto|ncard|iterate|card|filter|range)\b)/g;
  let out = "", last = 0;
  for (const m of src.matchAll(re)) {
    out += esc(src.slice(last, m.index));
    const cls = m[1] ? "k" : m[2] ? "o" : m[3] ? "n" : m[4] ? "t" : "f";
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}
const leanBlock = (r) => { const b = leanOf(r); return b ? `<pre class="lean"><code>${leanHtml(b)}</code></pre>` : ""; };

// ---------- home page: two parts only ----------
// Part 1: how far along each campaign is, and a public timeline of every event.
// Part 2: who contributed and what they get (leaderboard, credit pledge, backers, one join line).
const statusWord = (r) => r.status === "verified" ? pair("solved", "已解决") : r.status === "refuted" ? pair("refuted", "已推翻") : pair("open", "未解决");
const kidsOf = (id) => lemmaRecs.filter((r) => r.parent === id);
const subtree = (r) => { const out = []; const walk = (x) => kidsOf(x.id).forEach((k) => { out.push(k); walk(k); }); walk(r); return out; };
const linkRecord = (r) => `${cfg.repo_url}/blob/main/records/collatz/${r.id}.json`;
const profile = (who, prefix = "") => LOGIN_RE.test(who || "") ? `<a href="${prefix}c/${esc(who)}.html">@${esc(who)}</a>` : esc(who);

// ---------- per-problem progress, the points ledger, problem pages ----------
// A research note is groundwork, not a proof: it moves a problem to "Surveyed", never further.
const STAGES = [["Not started", "未开始"], ["Surveyed", "已调研"], ["Split", "已拆分"], ["Steps proven", "步骤已证明"], ["Solved", "已解决"]];
const probPage = (r) => `p/${r.id}.html`;
function progressOf(p) {
  const ids = new Set([p.id, ...subtree(p).map((r) => r.id)]);
  const nNotes = notes.filter((n) => ids.has(n.record)).length;
  const nSplits = new Set(records.filter((r) => r.kind === "step" && r.split && ids.has(r.parent)).map((r) => r.split)).size;
  const nProofs = records.filter((r) => ids.has(r.id) && r.id !== p.id && r.status === "verified").length;
  const stage = p.status === "verified" ? 4 : nProofs ? 3 : nSplits ? 2 : nNotes ? 1 : 0;
  return { nNotes, nSplits, nProofs, stage };
}
const nWord = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function progressLine(p) {
  const g = progressOf(p);
  const segs = STAGES.slice(1).map(([en], i) => `<span class="sg${g.stage >= i + 1 ? " on" : ""}" title="${esc(en)}"></span>`).join("");
  return `<div class="progline"><span class="stage s${g.stage}" title="Surveyed → Split → Steps proven → Solved"><span class="sgs" aria-hidden="true">${segs}</span>${pair(STAGES[g.stage][0], STAGES[g.stage][1])}</span><span class="pcount">${pair(`${nWord(g.nNotes, "research note", "research notes")} · ${nWord(g.nSplits, "split", "splits")} · ${nWord(g.nProofs, "proof", "proofs")}`, `研究笔记 ${g.nNotes} · 拆分 ${g.nSplits} · 证明 ${g.nProofs}`)}</span></div>`;
}
const KIND_LABEL = { proof: ["Proof", "证明"], refutation: ["Refutation", "推翻"], split: ["Split", "拆分"], note: ["Research note", "研究笔记"], bonus: ["Bonus", "奖励"] };
function ledgerLink(e) {
  if (e.kind === "bonus" && e.sub === "cited") return e.by_kind === "note" ? String(e.by_ref).replace(/\.md$/, ".html") : `${cfg.repo_url}/blob/main/OpenConjecture/Collatz/Proposals/${e.by_ref}.lean`;
  if (e.kind === "bonus") return byId.has(e.id) ? linkRecord(byId.get(e.id)) : "";
  return eventLink(e);
}
function ledgerTable(evts, prefix = "", { who = true } = {}) {
  const rows = evts.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (!rows.length) return `<p class="empty">${pair("No points yet.", "还没有积分。")}</p>`;
  const total = Math.round(rows.reduce((a, e) => a + e.points, 0) * 10) / 10;
  const body = rows.map((e) => {
    const r = byId.get(e.record), link = ledgerLink(e), href = link && !/^https:/.test(link) ? prefix + link : link;
    return `<tr><td class="mono nowrap">${esc(e.date)}</td><td class="num fig">+${num(e.points)}</td>${who ? `<td>${profile(e.who, prefix)}</td>` : ""}<td class="what-c">${href ? `<a href="${esc(href)}" rel="noopener">${pair(...KIND_LABEL[e.kind])} ↗</a>` : pair(...KIND_LABEL[e.kind])}</td><td class="prob-c">${r ? `<a href="${prefix}${probPage(r)}" title="${esc(r.title_en)}">${pair(r.title_en.split(":")[0], r.title_zh.split("：")[0])}</a>` : esc(e.record || e.id)}</td><td class="small rule-c">${pair(e.rule_en || "", e.rule_zh || e.rule_en || "")}</td><td class="small muted setup-c">${e.kind === "bonus" ? "–" : esc(setupLabel(e))}</td></tr>`;
  }).join("");
  return `<div class="tablewrap"><table class="ledger"><thead><tr><th>${pair("Date", "日期")}</th><th class="num">${pair("Points", "积分")}</th>${who ? `<th>${pair("Who", "贡献者")}</th>` : ""}<th>${pair("What", "内容")}</th><th>${pair("Problem", "问题")}</th><th>${pair("Rule applied", "计分规则")}</th><th>${pair("Model · tool", "模型 · 工具")}</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td>${pair("Total", "合计")}</td><td class="num fig">${num(total)}</td><td colspan="${who ? 5 : 4}"></td></tr></tfoot></table></div>`;
}
// Notes as reusable work: a one-line summary, a permalink and a citation line.
function noteSummary(n) {
  const lines = String(n.text || "").split(/\r?\n/);
  const at0 = lines.findIndex((l) => /^## /.test(l));
  const para = [];
  for (const l of lines.slice(at0 + 1)) {
    if (/^## /.test(l)) break;
    if (!l.trim() || /^\s{4}/.test(l)) { if (para.length) break; continue; }
    para.push(l.trim().replace(/^[-*] /, ""));
  }
  const s = para.join(" ").replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  if (s.length <= 240) return s;
  const cut = s.slice(0, 240), dot = cut.lastIndexOf(". ");
  return dot > 60 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, "") + "…";
}
const noteUrl = (n) => `${cfg.site_url}${notePage(n)}`;
const citeLine = (n) => { const r = byId.get(n.record); return `@${n.who} (${n.date}). “${n.title}”. ProofHive research note on “${r ? r.title_en : n.record}”. ${noteUrl(n)}`; };
const citeBtns = (n) => `<div class="btns"><button class="btn sm" type="button" data-copy="${esc(noteUrl(n))}"><span class="lbl" data-i18n="copy_link">${esc(I18N.en.copy_link)}</span></button><button class="btn sm" type="button" data-copy="${esc(citeLine(n))}"><span class="lbl" data-i18n="copy_cite">${esc(I18N.en.copy_cite)}</span></button></div>`;
const citedBy = (n) => scoreEvts.filter((e) => e.sub === "cited" && e.path === n.path);
function noteItem(n, prefix) {
  const c = citedBy(n).length;
  return `<li><a href="${prefix}${notePage(n)}"><b>${esc(n.title)}</b></a>
<div class="small muted">${profile(n.who, prefix)} · ${esc(n.date)} · ${esc(setupLabel(n))}${c ? ` · ${pair(`cited ${nWord(c, "time", "times")}`, `被引用 ${c} 次`)}` : ""}</div>
<p class="small">${esc(noteSummary(n))}</p>${citeBtns(n)}</li>`;
}
function problemPage(r) {
  const pre = "../";
  const kids = kidsOf(r.id);
  const myNotes = notes.filter((n) => n.record === r.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const parent = byId.get(r.parent);
  const ids = new Set([r.id, ...subtree(r).map((x) => x.id)]);
  const pts = scoreEvts.filter((e) => ids.has(e.record));
  const splitFile = r.kind === "step" && r.split ? `${cfg.repo_url}/blob/main/OpenConjecture/Collatz/${existsSync(at(`OpenConjecture/Collatz/Splits/${r.split}.lean`)) ? "Splits" : "Proposals"}/${r.split}.lean` : "";
  return page({
    key: "title_note", prefix: pre, title: r.title_en,
    body: `<p class="kicker">${parent ? `<a href="${parent.kind === "summit" ? `${pre}index.html` : `${pre}${probPage(parent)}`}">${pair(parent.title_en.split(":")[0], parent.title_zh.split("：")[0])}</a>` : "ProofHive"} · ${t(KIND_KEY[r.kind])}</p>
<h1>${pair(r.title_en, r.title_zh)}</h1>
<p class="small muted">${statusWord(r)} · ${pair(`difficulty ${r.difficulty}`, `难度 ${r.difficulty}`)}${r.status !== "open" ? ` · ${r.status === "verified" ? t("by") : t("refuted_by")} ${profile(r.proved_by, pre)}` : ""}${r.proposed_by ? ` · ${t("proposed_by")} ${profile(r.proposed_by, pre)}` : ""}</p>
${progressLine(r)}
${r.kind === "program" && (r.about_en || r.about_zh) ? `<p>${pair(r.about_en || "", r.about_zh || "")}</p>` : ""}${r.sketch ? `<p class="idea">${esc(String(r.sketch).slice(0, 2000))}</p>` : ""}
${leanBlock(r)}<p class="small muted mono">${esc(r.statement)} · <a href="${esc(linkRecord(r))}" rel="noopener">${pair("record", "记录")}</a>${splitFile ? ` · <a href="${esc(splitFile)}" rel="noopener">${t("split_note")}</a>` : ""}</p>
${kids.length ? `<h2>${pair("Steps", "步骤")}</h2><ul class="kids">${kids.map((k) => `<li><span class="dot2 ${esc(k.status)}"></span><a href="${esc(k.id)}.html">${pair(k.title_en, k.title_zh)}</a> <span class="st">${statusWord(k)}</span></li>`).join("")}</ul>` : ""}
<h2>${pair("Research notes", "研究笔记")}</h2>
<p class="small muted">${pair("Notes are groundwork, not proofs: surveys of what is known and where it is stuck. Read them before you work on this problem, and cite the ones you build on by linking their permalink; the cited author gets a bonus.", "笔记是基础工作，不是证明：梳理已知结果和卡在哪里。动手之前先读，并通过链接永久地址引用你所依据的笔记；被引用的作者会得到奖励。")}</p>
${myNotes.length ? `<ul class="notelist">${myNotes.map((n) => noteItem(n, pre)).join("")}</ul>` : `<p class="empty">${pair("No research notes yet. Be the first: see agent.md.", "还没有研究笔记。来写第一篇：见 agent.md。")}</p>`}
<h2>${pair("Points awarded on this problem", "这个问题上发出的积分")}</h2>
${ledgerTable(pts, pre)}
<p class="small"><a href="${pre}about.html#scoring">${t("scoring_h")} →</a></p>`,
  });
}

// Timeline events from the records (merged work) and, when built in CI, from pull requests (open, rejected, closed).
const evPts = (kind, pred) => { const e = scoreEvts.find((x) => x.kind === kind && pred(x)); return e ? ` <span class="tag pts">+${num(e.points)} ${pair("pts", "分")}</span>` : ""; };
function recordEvents() {
  const ev = [];
  const splits = new Map();
  for (const r of records) {
    if (r.kind === "step" && r.split && r.proposed_by) {
      const g = splits.get(r.split) || { who: r.proposed_by, parent: byId.get(r.parent), n: 0, at: r.proposed_at, split: r.split };
      g.n += 1;
      splits.set(r.split, g);
    }
    if (r.status === "verified" || r.status === "refuted") {
      const v = r.status === "verified";
      ev.push({ at: r.verified_at, url: linkRecord(r), ico: v ? ["✓", "ok"] : ["✗", "bad"],
        html: `${profile(r.proved_by)} ${pair(v ? "proved" : "refuted", v ? "证明了" : "推翻了")} ${pair(r.title_en, r.title_zh)} <span class="tag ok">${pair("Lean checked", "Lean 已检查")}</span>${evPts(v ? "proof" : "refutation", (x) => x.id === r.id)}` });
    }
  }
  for (const n of notes) {
    const r = byId.get(n.record);
    ev.push({ at: n.date, url: notePage(n), ico: ["✎", "cool"], html: `${profile(n.who)} ${pair("wrote a research note on", "写了一篇研究笔记，关于")} ${pair(r.title_en, r.title_zh)} <span class="tag ok">${pair("reviewed", "已审查")}</span>${evPts("note", (x) => x.path === n.path)} <span class="small muted">${esc(setupLabel(n))}</span>` });
  }
  for (const g of splits.values()) {
    if (!g.parent) continue;
    ev.push({ at: g.at, url: `${cfg.repo_url}/blob/main/OpenConjecture/Collatz/Proposals/${g.split}.lean`, ico: ["⑂", "acc"],
      html: `${profile(g.who)} ${pair("split", "拆分了")} ${pair(g.parent.title_en, g.parent.title_zh)} ${pair(`into ${g.n} smaller ${g.n === 1 ? "step" : "steps"}`, `，拆成 ${g.n} 个小步骤`)} <span class="tag ok">${pair("accepted", "已接受")}</span>${evPts("split", (x) => x.id === g.split)}` });
  }
  return ev;
}
let prEvents = [];
const GH_REPO = process.env.GITHUB_REPOSITORY || "";
if (process.env.GITHUB_TOKEN && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(GH_REPO)) {
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/pulls?state=all&sort=updated&direction=desc&per_page=60`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "proofhive-site" } });
    const list = res.ok ? await res.json() : [];
    for (const pr of Array.isArray(list) ? list : []) {
      const who = pr && pr.user && pr.user.login;
      if (!LOGIN_RE.test(who || "") || pr.merged_at || who === GH_REPO.split("/")[0]) continue;
      if ((Array.isArray(cfg.hidden_handles) ? cfg.hidden_handles : []).some((h) => String(h).toLowerCase() === who.toLowerCase())) continue;
      const labels = new Set((pr.labels || []).map((l) => l && l.name));
      const title = String(pr.title || "").slice(0, 100);
      const at = String(pr.closed_at || pr.updated_at || "").slice(0, 19);
      const ico = pr.state === "closed" ? ["×", "bad"] : labels.has("review-rejected") ? ["⊘", "bad"] : ["◷", ""];
      const [en, zh, cls] = pr.state === "closed" ? ["closed without merging", "未合并即关闭", "bad"]
        : labels.has("review-rejected") ? ["rejected by the AI review: restatement or filler", "被 AI 审查拒绝：改写或凑数", "bad"]
        : labels.has("needs-review") ? ["passed the checks, waiting for the AI review", "已通过检查，等待 AI 审查", "open"]
        : ["opened, being checked by Lean", "已提交，Lean 正在检查", "open"];
      const rejected = pr.state === "closed" || labels.has("review-rejected");
      prEvents.push({ at, ico, rejected, tip: `@${who}: ${title} (${en})`, url: String(pr.html_url || ""), html: `${profile(who)}: “${esc(title)}” <span class="tag ${cls}">${pair(en, zh)}</span>` });
    }
  } catch (e) { console.log("site: pull requests not fetched:", e.message); }
}

function homePage() {
  const programs = lemmaRecs.filter((r) => r.kind === "program");
  const steps = lemmaRecs.filter((r) => r.kind === "step");
  const solvedProblems = programs.filter((r) => r.status === "verified").length;
  const splitProblems = programs.filter((p) => kidsOf(p.id).some((k) => k.kind === "step")).length;
  const stepsProven = steps.filter((r) => r.status === "verified").length;
  const joinEn = `Read ${cfg.site_url}agent.md and follow it.`;
  const joinZh = `阅读 ${cfg.site_url}agent.md，然后照做。`;

  const surveyed = programs.filter((p) => progressOf(p).nNotes > 0).length;
  const summary = pair(
    `Collatz conjecture: unsolved. ${programs.length} open problems · ${surveyed} surveyed · ${splitProblems} split · ${solvedProblems} solved.`,
    `Collatz 猜想：未解决。${programs.length} 个未解决问题 · ${surveyed} 个已调研 · ${splitProblems} 个已拆分 · ${solvedProblems} 个已解决。`)
    + `<span class="small muted" style="display:block;font-weight:400;font-size:.82rem;margin-top:4px">${pair(`${notes.length} research ${notes.length === 1 ? "note" : "notes"} (groundwork, not proofs) · ${steps.length} ${steps.length === 1 ? "step" : "steps"} · ${stepsProven} ${stepsProven === 1 ? "step" : "steps"} proven.`, `研究笔记 ${notes.length} 篇（基础工作，不是证明）· 步骤 ${steps.length} 个 · 已证明 ${stepsProven} 个。`)}</span>`;

  const stepLine = (r, depth) => `<li class="d${Math.min(depth, 3)}"><span class="dot2 ${esc(r.status)}"></span>${pair(r.title_en, r.title_zh)} <span class="st">${statusWord(r)}</span>${kidsOf(r.id).length ? `<ul>${kidsOf(r.id).map((k) => stepLine(k, depth + 1)).join("")}</ul>` : ""}</li>`;
  const tree = summits.map((s) => {
    const probs = lemmaRecs.filter((r) => r.kind === "program" && r.parent === s.id);
    return `<div class="branch"><h3>${pair(s.title_en.split(":")[0], s.title_zh.split("：")[0])}</h3>${probs.map((p) => {
      const sub = subtree(p), done = sub.filter((r) => r.status !== "open").length;
      const pct = p.status === "verified" ? 100 : sub.length ? Math.round((100 * done) / (sub.length + 1)) : 0;
      return `<div class="prob"><div class="prob-top"><span class="pt"><a href="${probPage(p)}">${pair(p.title_en, p.title_zh)}</a></span><span class="st">${statusWord(p)}${sub.length ? ` · ${pair(`${sub.length} steps`, `${sub.length} 个步骤`)}` : ""}</span></div>
<div class="bar"><div class="fill" style="width:${pct}%"></div></div>${progressLine(p)}${sub.length ? `<ul class="steps">${kidsOf(p.id).map((k) => stepLine(k, 1)).join("")}</ul>` : ""}</div>`;
    }).join("") || `<p class="small muted">${t("none_attached")}</p>`}</div>`;
  }).join("");

  const events = [...recordEvents(), ...prEvents].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 80);
  const tlStatic = events.map((e) => `<li><span class="ico ${esc((e.ico || ["•", ""])[1])}">${esc((e.ico || ["•"])[0])}</span><span class="what">${e.html}${e.url ? ` <a class="src" href="${esc(e.url)}" rel="noopener">↗</a>` : ""}</span><span class="when" data-at="${esc(String(e.at).slice(0, 10))}">${esc(String(e.at).slice(0, 10))}</span></li>`).join("");

  const lbRows = (rows, emptyKey) => rows.length ? `<ol class="lb2">${rows.slice(0, 10).map((e) => `<li><span class="who">${avatar(e.who, 22)} ${profile(e.who)}</span><span class="pts"><a href="c/${esc(e.who)}.html#ledger" title="Where every point came from">${num(e.points)} ${pair("pts", "分")}</a></span><span class="small muted">${pair(`${e.proofs} proofs · ${e.splits} splits · ${e.refutations} refutations · ${e.notes} notes`, `证明 ${e.proofs} · 拆分 ${e.splits} · 推翻 ${e.refutations} · 笔记 ${e.notes}`)}</span></li>`).join("")}</ol>` : `<p class="empty">${t(emptyKey)}</p>`;
  const logos = rankedSupporters.slice(0, 8).map((s) => `<span class="logo"><span class="nm">${esc(s.name)}</span><span class="am">${usd(s.amount)}</span></span>`).join("");

  return page({
    key: "title_home",
    wide: true,
    bodyAttrs: deskOn ? `data-desk="${esc(deskUrl)}"${SPONSOR_OPEN ? ` data-sponsors="${esc(deskUrl)}"` : ""}` : "",
    extra: `<script>${HIVE_JS}</script>` + (deskOn ? `<script type="application/json" id="task-titles">${jsonForScript(Object.fromEntries(records.map((r) => [r.id, [r.title_en, r.title_zh]])))}</script>
<script type="application/json" id="hidden-handles">${jsonForScript([...hiddenHandles])}</script>
<script>${HOME_JS}</script>${SPONSOR_OPEN ? `<script>${SPONSOR_JS}</script>` : ""}` : ""),
    body: `<section class="hero2"><canvas id="hive" aria-hidden="true"></canvas>
<p class="kicker">${t("hero_kicker2")}</p>
<h1><svg class="hex big" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/></svg>${esc(cfg.site_name)}</h1>
<p class="lede">${t("hero_lede")}</p>
<div class="hero-stats">
<span class="chip live" id="chip-agents"${deskOn ? "" : " hidden"}><b id="agents-num">0</b>${t("hs_agents")}</span>
<span class="chip"><b data-count="${programs.length}">${programs.length}</b>${t("hs_problems")}</span>
<span class="chip"><b data-count="${steps.length}">${steps.length}</b>${t("hs_steps")}</span>
<span class="chip"><b data-count="${settled.length + notes.length}">${settled.length + notes.length}</b>${t("hs_results")}</span>
<span class="chip"><b data-count="${lbAll.length}">${lbAll.length}</b>${t("hs_people")}</span>
</div>
<div class="btns" style="margin-top:18px"><a class="btn primary" href="join.html">${t("btn_ai")} →</a><a class="btn" href="credit.html">${t("credit_short_btn")}</a></div>
</section>

<section class="part">
<p class="kicker">${pair("Part 1", "第一部分")}</p>
<h2>${t("p1_h")}</h2>
<div class="camp">
<p class="camp-sum">${summary}</p>
<p class="small muted" id="agents-now">${deskOn ? t("agents_wait") : t("desk_soon")}</p>
${tree}
<p class="small"><a href="lemmas.html">${t("campaign_link")} →</a></p>
</div>
${progressChart()}
${breakthroughs()}
<h3 class="tl-h">${t("tl_h")}</h3>
<p class="small muted">${t("tl_lead")}</p>
<ol class="tl" id="tl-live"></ol>
<ol class="tl">${tlStatic || `<li class="empty-li">${t("tl_empty")}</li>`}</ol>
</section>

<section class="part">
<p class="kicker">${pair("Part 2", "第二部分")}</p>
<h2>${t("p2_h")}</h2>
<div class="cols">
<div>
<h3>${t("lb_h")}</h3>
<div class="btns" role="group"><button class="btn sm" type="button" data-tab="week" aria-pressed="true">${t("tab_week")}</button><button class="btn sm" type="button" data-tab="all" aria-pressed="false">${t("tab_all")}</button></div>
<div data-panel="week">${lbRows(lbWeek, "lb_none_week")}</div>
<div data-panel="all" hidden>${lbRows(lbAll, "lb_none")}</div>
<p class="small"><a href="about.html#scoring">${t("scoring_h")} →</a></p>
<h3 style="margin-top:22px">${t("top_setups")}</h3>${topSetups()}<p class="small"><a href="models.html">${t("ai_full")} →</a></p>
</div>
<div>
<h3>${t("credit_h")}</h3>
<ul class="plain small">${["credit_1", "credit_2", "credit_3", "credit_4", "credit_5"].map((k) => `<li>${t(k)}</li>`).join("")}</ul>
<p class="small"><a href="credit.html">${t("credit_full")} →</a></p>
</div>
</div>
<div class="joincta glass"><div><h3>${t("join_cta_h")}</h3><p class="small muted">${t("join_cta_p")}</p></div><a class="btn primary" href="signup.html">${t("nav_signup")} →</a></div>
<h3>${t("backed_h")}</h3>
<div class="backers2"><span id="backer-logos" class="logos">${logos}</span><a class="logo slot" href="sponsor.html">${t(SPONSOR_OPEN ? "logo_slot" : "support_soon")}</a></div>
${SPONSOR_OPEN ? `<p class="small muted">${t("pledge_lead")}</p><div class="btns"><a class="btn primary" href="sponsor.html">${t("become_backer")}</a></div>` : ""}
<div class="joinbox"><div><h2>${t("btn_ai")}</h2><p>${t("join_strip_lead")}</p><code>${pair(joinEn, joinZh)}</code></div>
<div class="btns" style="margin:0"><button class="btn primary" type="button" data-copy="${esc(joinEn)}" data-copy-zh="${esc(joinZh)}"><span class="lbl" data-i18n="copy">${esc(I18N.en.copy)}</span></button></div></div>
</section>`,
  });
}

// The hero's hive: a canvas of hexagonal cells that breathe slowly; live events light some up.
// Cheap: about 30 frames a second, paused when the tab is hidden, a single still frame with reduced motion.
const HIVE_JS = `
(function(){var c=document.getElementById("hive");if(!c||!c.getContext)return;var x=c.getContext("2d");
var still=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var R=15,cells=[],W=0,H=0,dpr=Math.min(2,window.devicePixelRatio||1);
function css(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}
function size(){var r=c.getBoundingClientRect();W=r.width;H=r.height;c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);x.setTransform(dpr,0,0,dpr,0,0);
cells=[];var w=Math.sqrt(3)*R,h=1.5*R;for(var row=-1;row*h<H+R;row++)for(var col=-1;col*w<W+w;col++)cells.push({x:col*w+(row%2?w/2:0),y:row*h,p:Math.random()*6.28,s:.4+Math.random()*.6,lit:0});}
function hex(cx,cy,r){x.beginPath();for(var i=0;i<6;i++){var a=Math.PI/3*i+Math.PI/6;x.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a));}x.closePath();}
var t=0,last=0;
function draw(ts){if(!still){if(ts-last<33){req();return;}last=ts;}t+=.016;
var acc=css("--accent")||"#f5b83d",light=document.documentElement.getAttribute("data-theme")==="light";x.clearRect(0,0,W,H);
for(var i=0;i<cells.length;i++){var k=cells[i],b=.5+.5*Math.sin(t*k.s+k.p);hex(k.x,k.y,R-1.5);
x.strokeStyle=light?"rgba(20,21,26,"+(.05+.05*b)+")":"rgba(255,255,255,"+(.035+.04*b)+")";x.lineWidth=1;x.stroke();
if(k.lit>0){x.globalAlpha=Math.min(1,k.lit)*.32;x.fillStyle=acc;x.fill();x.globalAlpha=1;k.lit-=.006;}}
req();}
function req(){if(!still&&!document.hidden)requestAnimationFrame(draw);}
window.__hive={light:function(n){for(var i=0;i<n&&cells.length;i++){cells[Math.floor(Math.random()*cells.length)].lit=1;}if(still)draw(0);}};
size();window.addEventListener("resize",function(){size();if(still)draw(0);});document.addEventListener("visibilitychange",function(){if(!document.hidden&&!still)requestAnimationFrame(draw);});
window.__hive.light(6);draw(0);
})();`;

// Live part of the timeline and the "agents working now" line, from the desk's public status.
const HOME_JS = `
(function(){
var desk=document.body.getAttribute("data-desk");if(!desk)return;
var last=null;
function lang(){return window.__lang==="zh"?"zh":"en";}
function tr(k){var d=window.__D;return d&&d[lang()]&&d[lang()][k]!=null?d[lang()][k]:k;}
function el(id){return document.getElementById(id);}
function str(v,max){return typeof v==="string"?v.slice(0,max):"";}
function clear(n){while(n.firstChild)n.removeChild(n.firstChild);}
function node(tag,cls,s){var e=document.createElement(tag);if(cls)e.className=cls;e.textContent=s;return e;}
var TITLES={};try{TITLES=JSON.parse(el("task-titles").textContent)||{};}catch(e){}
var HIDDEN=[];try{HIDDEN=JSON.parse(el("hidden-handles").textContent)||[];}catch(e){}
var REASONS={hypothesis_too_weak:"r_hypothesis_too_weak",missing_lemma:"r_missing_lemma",statement_seems_false:"r_statement_seems_false",does_not_elaborate:"r_does_not_elaborate",out_of_time:"r_out_of_time",other:"r_other"};
var ROLES={think:"tl_role_think",redteam:"tl_role_redteam"};
function title(id){return Object.prototype.hasOwnProperty.call(TITLES,id)?TITLES[id][lang()==="zh"?1:0]:id;}
function when(at){var ms=Date.parse(str(at,40));if(!isFinite(ms))return "";var m=Math.max(0,Math.round((Date.now()-ms)/60000));
if(m<1)return tr("just_now");if(m<60)return m+" "+tr("min_ago");var h=Math.round(m/60);if(h<48)return h+" "+tr("hr_ago");return Math.round(h/24)+" "+tr("day_ago");}
function render(d){
if(!d||typeof d!=="object"||Array.isArray(d))return;last=d;
var n=Number(d.agents_now)||0,a=el("agents-now");if(a)a.textContent=tr("agents_now").replace("{n}",String(n));var an=el("agents-num");if(an)an.textContent=String(n);
if(window.__hive)window.__hive.light(Math.min(12,(Array.isArray(d.recent)?d.recent.length:0)+n*3));
var box=el("tl-live");if(!box)return;clear(box);
(Array.isArray(d.recent)?d.recent:[]).slice(0,30).forEach(function(e){if(!e||typeof e!=="object")return;
if(HIDDEN.indexOf(str(e.handle,40).toLowerCase())>=0)return;
var type=str(e.type,40),head=type.split(":")[0],tail=type.slice(head.length+1),h="@"+str(e.handle,40),t=title(str(e.task,120)),text;
if(head==="took")text=h+" "+tr("tl_started")+" "+t+(Object.prototype.hasOwnProperty.call(ROLES,tail)?" ("+tr(ROLES[tail])+")":"");
else if(head==="released"&&tail==="submitted")text=h+" "+tr("tl_submitted")+" "+t;
else if(head==="released")text=h+" "+tr("tl_handed")+" "+t+(Object.prototype.hasOwnProperty.call(REASONS,tail)?": "+tr(REASONS[tail]):"");
else return;
var ic=head==="took"?["▶","cool"]:tail==="submitted"?["⇡","ok"]:["↩","acc"];
var li=document.createElement("li");li.appendChild(node("span","ico "+ic[1],ic[0]));li.appendChild(node("span","what",text));li.appendChild(node("span","when",when(e.at)));box.appendChild(li);});}
function load(){fetch(desk+"/desk/status",{credentials:"omit"}).then(function(r){if(!r.ok)throw new Error("s");return r.json();}).then(render).catch(function(){var a=el("agents-now");if(a&&!last)a.textContent=tr("desk_soon");});}
var lb=el("lang");if(lb)lb.addEventListener("click",function(){if(last)render(last);});
load();setInterval(load,30000);
})();`;

// ---------- contributors: profiles, badges, directory ----------
const profiles = readProfiles(ROOT, { strict: false });
// Profile fields edited on the web live in the desk (GET /desk/profiles); they are merged over the repository file.
const deskProfiles = {};
if (deskOn && !simOk && process.env.GITHUB_ACTIONS) {
  try {
    const r = await fetch(`${deskUrl}/desk/profiles`, { signal: AbortSignal.timeout(8000) });
    const d = r.ok ? await r.json() : null;
    for (const [login, pr] of Object.entries((d && d.profiles) || {})) if (LOGIN_RE.test(login) && pr && typeof pr === "object") deskProfiles[login.toLowerCase()] = { login, ...pr };
  } catch (e) { console.log("site: desk profiles not fetched:", e.message); }
} else if (simOk) {
  try { const r = await fetch(`${deskUrl}/desk/profiles`); const d = r.ok ? await r.json() : null;
    for (const [login, pr] of Object.entries((d && d.profiles) || {})) if (LOGIN_RE.test(login) && pr && typeof pr === "object") deskProfiles[login.toLowerCase()] = { login, ...pr }; } catch (e) {}
}
const TEXT_MAX = { display_name: 60, affiliation: 100, bio: 400, country: 40 };
for (const [key, dp] of Object.entries(deskProfiles)) {
  const base = profiles.get(key) || { login: dp.login };
  const merged = { ...base };
  for (const [k, max] of Object.entries(TEXT_MAX)) if (typeof dp[k] === "string" && dp[k].length <= max) merged[k] = dp[k];
  if (Array.isArray(dp.interests)) merged.interests = dp.interests.filter((x) => typeof x === "string" && x.length <= 40).slice(0, 8);
  if (dp.links && typeof dp.links === "object") merged.links = { ...(base.links || {}), ...Object.fromEntries(Object.entries(dp.links).filter(([, v]) => typeof v === "string" && /^https:\/\//.test(v) && v.length <= 200)) };
  if (typeof dp.member_since === "string" && DATE_RE.test(dp.member_since)) merged.member_since = dp.member_since;
  profiles.set(key, merged);
}
const LINK_LABEL = { x: "X", linkedin: "LinkedIn", github: "GitHub", homepage: "Homepage", orcid: "ORCID", scholar: "Google Scholar" };
function personOf(who) {
  const key = String(who).toLowerCase();
  const p = profiles.get(key) || { login: who };
  const mine = scoreEvts.filter((e) => String(e.who).toLowerCase() === key);
  const row = lbAll.find((r) => String(r.who).toLowerCase() === key) || { points: 0, proofs: 0, splits: 0, refutations: 0, notes: 0 };
  const rank = lbAll.findIndex((r) => String(r.who).toLowerCase() === key) + 1;
  const since = p.member_since || mine.map((e) => e.date).filter(Boolean).sort()[0] || "";
  const badges = [];
  if (row.notes) badges.push(["note", "First research note", "首篇研究笔记"]);
  if (row.splits) badges.push(["split", "First split", "首个拆分"]);
  if (row.proofs) badges.push(["proof", "First proof", "首个证明"]);
  if (row.refutations) badges.push(["refute", "First refutation", "首个反驳"]);
  if (rank && rank <= 10 && row.points > 0) badges.push(["top", "Top 10", "前十名"]);
  const accepted = row.proofs + row.splits + row.refutations + row.notes;
  return { login: p.login || who, p, mine, row, rank, since, badges, accepted };
}
const people = [...new Set([...scoreEvts.map((e) => String(e.who)), ...[...profiles.values()].map((p) => p.login)])]
  .filter((w) => LOGIN_RE.test(w))
  .filter((w, i, a) => a.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i)
  .map(personOf);
const avatar = (login, size = 96) => `<span class="avatar" style="width:${size}px;height:${size}px"><span class="ini">${esc(login.slice(0, 2).toUpperCase())}</span><img class="av-img" src="https://github.com/${esc(login)}.png?size=${size * 2}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer"></span>`;

function contributorPage(who) {
  const P = personOf(who), p = P.p, login = P.login;
  const KIND = { proof: ["proved", "证明了"], refutation: ["refuted", "推翻了"], split: ["split", "拆分了"], note: ["wrote a research note on", "写了研究笔记："], bonus: ["bonus for", "奖励："] };
  const items = P.mine.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((e) => {
    const r = byId.get(e.id);
    const target = e.kind === "note" ? byId.get(e.id) : e.kind === "split" ? (records.find((x) => x.split === e.id) ? byId.get(records.find((x) => x.split === e.id).parent) : null) : r;
    const ico = { proof: ["✓", "ok"], refutation: ["✗", "bad"], split: ["⑂", "acc"], note: ["✎", "cool"], bonus: ["+", "acc"] }[e.kind] || ["•", ""];
    return `<li><span class="ico ${ico[1]}">${ico[0]}</span><span class="what">${pair(KIND[e.kind][0], KIND[e.kind][1])} ${target ? pair(target.title_en, target.title_zh) : esc(e.id)} <span class="tag ok">+${num(e.points)}</span></span><span class="when" data-at="${esc(e.date)}">${esc(e.date)}</span></li>`;
  }).join("");
  const links = { github: `https://github.com/${login}`, ...(p.links || {}) };
  const url = `${cfg.site_url}c/${login}.html`;
  const shareEn = `I contributed to ProofHive, a public attack on open problems in mathematics: ${num(P.row.points)} points, ${P.accepted} accepted ${P.accepted === 1 ? "result" : "results"}.`;
  const shareX = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareEn)}&url=${encodeURIComponent(url)}`;
  const shareLi = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  return page({
    key: "title_profile", prefix: "../", title: p.display_name ? `${p.display_name} (@${login})` : `@${login}`,
    extra: `<script src="../vendor/qrcode.js"></script><script>${WX_JS}</script>`,
    meta: `<meta property="og:title" content="${esc(p.display_name || "@" + login)} on ProofHive"><meta property="og:description" content="${esc(shareEn)}"><meta property="og:url" content="${esc(url)}"><meta name="twitter:card" content="summary">`,
    body: `<section class="prof">
${avatar(login, 104)}
<div class="prof-main">
<h1>${esc(p.display_name || "@" + login)}</h1>
<p class="muted mono small">@${esc(login)}${p.country ? ` · ${esc(p.country)}` : ""}${P.since ? ` · ${pair("member since", "加入于")} ${esc(P.since)}` : ""}</p>
${p.affiliation ? `<p class="aff">${esc(p.affiliation)}</p>` : ""}
${p.bio ? `<p>${esc(p.bio)}</p>` : ""}
${p.interests ? `<p class="interests">${p.interests.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</p>` : ""}
<p class="links">${Object.entries(links).map(([k, v]) => `<a class="btn sm" href="${esc(v)}" rel="noopener me">${esc(LINK_LABEL[k] || k)}</a>`).join("")}</p>
</div></section>
<div class="sharecard glass">
<div class="sc-top"><span class="brand"><svg class="hex" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/></svg>ProofHive</span><span class="kicker">${pair("contributor", "贡献者")}</span></div>
<p class="sc-line">${pair(`I contributed to ProofHive: ${num(P.row.points)} points, ${P.accepted} accepted ${P.accepted === 1 ? "result" : "results"}.`, `我参与了 ProofHive：${num(P.row.points)} 分，${P.accepted} 个被接受的成果。`)}</p>
<div class="sc-stats"><span><b>${num(P.row.points)}</b>${pair("points", "积分")}</span><span><b>${P.rank || "–"}</b>${pair("rank", "排名")}</span><span><b>${P.row.notes}</b>${pair("notes", "笔记")}</span><span><b>${P.row.splits}</b>${pair("splits", "拆分")}</span><span><b>${P.row.proofs}</b>${pair("proofs", "证明")}</span><span><b>${P.row.refutations}</b>${pair("refutations", "反驳")}</span></div>
${P.badges.length ? `<p class="badges">${P.badges.map(([k, en, zh]) => `<span class="badge b-${k}">${pair(en, zh)}</span>`).join("")}</p>` : ""}
<div class="btns"><a class="btn sm" href="${esc(shareX)}" rel="noopener">${pair("Share on X", "分享到 X")}</a><a class="btn sm" href="${esc(shareLi)}" rel="noopener">${pair("Share on LinkedIn", "分享到 LinkedIn")}</a><a class="btn sm" href="${esc(`https://service.weibo.com/share/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(shareEn)}`)}" rel="noopener">${pair("Share on Weibo", "分享到微博")}</a><button class="btn sm" type="button" id="wxbtn" data-url="${esc(url)}">${pair("WeChat QR", "微信二维码")}</button><button class="btn sm" type="button" data-copy="${esc(url)}"><span class="lbl" data-i18n="copy_link">${esc(I18N.en.copy_link)}</span></button></div>
</div>
<div id="wxqr" class="wxqr" hidden><img alt="QR code" width="180" height="180"><p class="small muted">${pair("Scan with WeChat to share this page.", "用微信扫一扫，分享此页面。")}</p></div>
<h2 id="ledger">${pair("Points ledger", "积分明细")}</h2>
<p class="small muted">${pair("One row per award: where every point came from, the rule applied, and a link to the work.", "每一行是一次计分：分数从哪里来、用了哪条规则，以及对应成果的链接。")}</p>
${ledgerTable(P.mine, "../", { who: false })}
<p class="small muted">${t("profile_note")} ${t("profile_edit")}</p>`,
  });
}

function peoplePage() {
  const cards = people.slice().sort((a, b) => b.row.points - a.row.points || (a.login < b.login ? -1 : 1)).map((P) => {
    const p = P.p;
    const hay = [P.login, p.display_name, p.affiliation, p.country, ...(p.interests || [])].filter(Boolean).join(" ").toLowerCase();
    return `<a class="person glass" href="c/${esc(P.login)}.html" data-s="${esc(hay)}" data-points="${P.row.points}" data-since="${esc(P.since)}" data-name="${esc((p.display_name || P.login).toLowerCase())}">
${avatar(P.login, 52)}<span class="pi"><b>${esc(p.display_name || "@" + P.login)}</b><span class="small muted">@${esc(P.login)}${p.affiliation ? ` · ${esc(p.affiliation)}` : ""}${p.country ? ` · ${esc(p.country)}` : ""}</span>
${p.interests ? `<span class="small">${p.interests.slice(0, 4).map(esc).join(" · ")}</span>` : ""}</span><span class="pp"><b>${num(P.row.points)}</b><span class="small muted">${pair("pts", "分")}</span></span></a>`;
  }).join("");
  return page({
    key: "title_people",
    body: `<h1>${t("title_people")}</h1>
<p class="lede">${t("people_lead")}</p>
<div class="tools"><input type="search" id="pq" data-i18n-ph="people_search" placeholder="${esc(I18N.en.people_search)}" aria-label="${esc(I18N.en.people_search)}">
<div class="filters" role="group"><button class="btn sm" type="button" data-sort="points" aria-pressed="true">${t("sort_points")}</button><button class="btn sm" type="button" data-sort="name" aria-pressed="false">${t("sort_name")}</button><button class="btn sm" type="button" data-sort="since" aria-pressed="false">${t("sort_new")}</button></div></div>
<div class="people" id="people">${cards || `<p class="empty">${t("tl_empty")}</p>`}</div>
<p class="empty" id="pempty" hidden>${t("no_match")}</p>
<p class="small muted">${t("profile_edit")}</p>`,
    extra: `<script>${PEOPLE_JS}</script>`,
  });
}
const WX_JS = `
(function(){var b=document.getElementById("wxbtn"),box=document.getElementById("wxqr");if(!b||!box)return;
b.addEventListener("click",function(){if(!box.hidden){box.hidden=true;return;}try{var q=window.qrcode(0,"M");q.addData(b.getAttribute("data-url"));q.make();
box.querySelector("img").src=q.createDataURL(5,8);box.hidden=false;}catch(e){}});})();`;
const PEOPLE_JS = `
(function(){var box=document.getElementById("people"),q=document.getElementById("pq");if(!box||!q)return;var cards=[].slice.call(box.querySelectorAll(".person"));
function apply(){var v=q.value.trim().toLowerCase(),n=0;cards.forEach(function(c){var ok=!v||c.getAttribute("data-s").indexOf(v)!==-1;c.hidden=!ok;if(ok)n++;});document.getElementById("pempty").hidden=n>0||!cards.length;}
q.addEventListener("input",apply);
document.querySelectorAll("[data-sort]").forEach(function(b){b.addEventListener("click",function(){var k=b.getAttribute("data-sort");
document.querySelectorAll("[data-sort]").forEach(function(x){x.setAttribute("aria-pressed",x===b?"true":"false");});
cards.sort(function(a,c){if(k==="points")return Number(c.getAttribute("data-points"))-Number(a.getAttribute("data-points"));if(k==="since")return c.getAttribute("data-since")<a.getAttribute("data-since")?-1:1;return a.getAttribute("data-name")<c.getAttribute("data-name")?-1:1;});
cards.forEach(function(c){box.appendChild(c);});});});})();`;

// ---------- research note pages: Markdown rendered with everything escaped ----------
const linkOk = (u) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };
function mdInline(text) {
  let out = "", last = 0;
  const re = /`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s)\]>]+)|\*\*([^*]+)\*\*/g;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(last, m.index));
    if (m[1] !== undefined) out += `<code>${esc(m[1])}</code>`;
    else if (m[3] !== undefined) out += linkOk(m[3]) ? `<a href="${esc(m[3])}" rel="nofollow ugc noopener">${esc(m[2])}</a>` : esc(m[0]);
    else if (m[4] !== undefined) out += linkOk(m[4]) ? `<a href="${esc(m[4])}" rel="nofollow ugc noopener">${esc(m[4])}</a>` : esc(m[4]);
    else out += `<strong>${esc(m[5])}</strong>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
function mdRender(src) {
  const out = [];
  let para = [], list = null, code = null;
  const flush = () => { if (para.length) out.push(`<p>${mdInline(para.join(" "))}</p>`); para = []; if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${i.split("\n").map((x, k) => { const c = k ? /^(Claim|Where): (.*)$/.exec(x) : null; return c ? `<span class="claimk">${c[1]}:</span> ${mdInline(c[2])}` : mdInline(x); }).join("<br>")}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const line of src.split(/\r?\n/)) {
    if (code) { if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^```/.test(line)) { flush(); code = []; continue; }
    const h = /^(#{1,4}) (.*)$/.exec(line);
    if (h) { flush(); const lv = Math.min(4, h[1].length + 1); out.push(`<h${lv}>${mdInline(h[2])}</h${lv}>`); continue; }
    if (list && /^\s*(?:[-*] )?(?:Claim|Where): /.test(line)) { list.items[list.items.length - 1] += "\n" + line.replace(/^\s*(?:[-*] )?/, "").trim(); continue; }
    const li = /^\s*(?:[-*]|(\d+)\.) (.*)$/.exec(line);
    if (li) { const tag = li[1] ? "ol" : "ul"; if (para.length || (list && list.tag !== tag)) flush(); if (!list) list = { tag, items: [] }; list.items.push(li[2]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list && /^\s+\S/.test(line)) { list.items[list.items.length - 1] += " " + line.trim(); continue; }
    if (list) flush();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  flush();
  return out.join("\n");
}
function notePageHtml(n) {
  const r = byId.get(n.record);
  return page({
    key: "title_note", prefix: "../../", title: n.title,
    body: `<p class="small muted">${pair("Research note", "研究笔记")} · ${profile(n.who, "../../")} · ${esc(n.date)} · ${esc(setupLabel(n))} · <a href="../../${probPage(r)}">${pair(`on: ${r.title_en}`, `关于：${r.title_zh}`)}</a></p>
<article class="note-md">${mdRender(n.text.split(/\r?\n/).slice(1).filter((l) => !/^(Record|Author|Date): /.test(l)).join("\n")).replace(/^/, `<h1>${esc(n.title)}</h1>\n`)}</article>
<p class="small muted">${t("note_disclaimer")} <a href="${esc(cfg.repo_url)}/blob/main/${esc(n.path)}" rel="noopener">${pair("Source", "源文件")}</a></p>
<section class="citebox glass"><h2>${pair("Cite / build on this", "引用 / 在此基础上继续")}</h2>
<p class="small muted">${pair("Link this permalink in your own note or split sketch: the author gets a citation bonus when your work is accepted.", "在你自己的笔记或拆分说明里链接这个永久地址：你的成果被接受时，作者会得到引用奖励。")}</p>
<code>${esc(noteUrl(n))}</code><code>${esc(citeLine(n))}</code>${citeBtns(n)}
${citedBy(n).length ? `<p class="small">${pair("Cited by", "被引用：")} ${citedBy(n).map((e) => { const l = ledgerLink(e); return `<a href="${esc(/^https:/.test(l) ? l : "../../" + l)}">@${esc(e.by)} (${esc(e.date)})</a>`; }).join(" · ")}</p>` : ""}</section>`,
  });
}

function statsPage() {
  return page({
    key: "title_stats", beacon: false, noindex: true,
    body: `<h1>${t("title_stats")}</h1>
<p class="small muted">Private. Anonymous counts from the task desk: no cookies, no IPs stored. Paste the ADMIN_TOKEN; it stays in this tab only.</p>
${deskOn ? `<form id="tokform" class="pledge" autocomplete="off"><label>Admin token<input id="tok" type="password" autocomplete="off"></label>
<label>Days<input id="days" type="number" min="1" max="400" value="30"></label><div class="btns"><button class="btn primary" type="submit">Show</button><button class="btn" type="button" id="forget">Forget token</button></div></form>
<p class="bad" id="msg" aria-live="polite"></p>
<div id="out" hidden><p id="sum"></p>
<svg id="chart" viewBox="0 0 720 200" class="statchart" role="img" aria-label="Daily views and visitors"></svg>
<p class="small muted"><span class="key v"></span> views <span class="key u"></span> visitors</p>
<div class="cols"><div><h2>Top pages</h2><div id="paths"></div></div><div><h2>Top referrers</h2><div id="refs"></div></div></div>
<h2>Top countries</h2><div id="countries"></div><h2>Sign-ups per day</h2><div id="signups"></div><p class="small muted">Export members (with emails): GET /desk/admin/members?format=csv with the same token.</p></div>` : `<p class="empty">No task desk is configured.</p>`}`,
    extra: deskOn ? `<script>${STATS_JS}</script>` : "",
  });
}

// ---------- open-problem library ----------
// A prebuilt JSON index (tools/build_library.mjs) searched in the browser; votes come from the desk.
const LIB_META = existsSync(at("site/library/library.json")) ? (() => { const d = readJson("site/library/library.json"); return { n: d.entries.length, generated: d.generated, attribution: d.attribution }; })() : null;
function libraryPage() {
  const fc = LIB_META && LIB_META.attribution && LIB_META.attribution["formal-conjectures"];
  return page({
    key: "title_library",
    bodyAttrs: `data-desk="${deskOn ? esc(deskUrl) : ""}"`,
    body: `<p class="kicker">${t("nav_library")}</p>
<h1>${t("title_library")}</h1>
<p class="lede">${t("library_lead")}</p>
<div class="libtools glass">
<input type="search" id="lq" data-i18n-ph="library_search" placeholder="${esc(I18N.en.library_search)}" aria-label="${esc(I18N.en.library_search)}">
<div class="librow">
<select id="larea" aria-label="Area"><option value="">${esc(I18N.en.all_areas)}</option></select>
<select id="lsrc" aria-label="Source"><option value="">${esc(I18N.en.all_sources)}</option></select>
<select id="lsort" aria-label="Sort"><option value="votes">${esc(I18N.en.sort_votes)}</option><option value="board">${esc(I18N.en.sort_board)}</option><option value="title">${esc(I18N.en.sort_title)}</option></select>
</div>
<div class="filters"><label class="chk"><input type="checkbox" id="lboard"> ${t("only_board")}</label><label class="chk"><input type="checkbox" id="llean"> ${t("only_lean")}</label></div>
</div>
<p class="small muted" id="lcount" aria-live="polite">${t("library_loading")}</p>
<div id="lib"></div>
<div class="btns"><button class="btn" type="button" id="lmore" hidden>${t("show_more")}</button></div>
<p class="small muted">${t("library_votes_note")}</p>
${fc ? `<p class="small muted">${pair(`Most entries come from google-deepmind/formal-conjectures (commit ${fc.commit.slice(0, 7)}), © The Formal Conjectures Authors, Apache License 2.0; statements shortened and reformatted. Erdős problems and other sources are linked, not copied.`, `大部分条目来自 google-deepmind/formal-conjectures（提交 ${fc.commit.slice(0, 7)}），© The Formal Conjectures Authors，Apache 2.0 许可证；陈述有删节和重排。Erdős 问题等来源只链接，不复制。`)} <a href="${esc(fc.repo)}" rel="noopener">GitHub</a> · <a href="library/NOTICE.txt">NOTICE</a></p>` : ""}`,
    extra: `<script>${LIBRARY_JS}</script>`,
  });
}
const LIBRARY_JS = `
(function(){
var desk=document.body.getAttribute("data-desk")||"";
function lang(){return window.__lang==="zh"?"zh":"en";}
function tr(k){var d=window.__D;return d&&d[lang()]&&d[lang()][k]!=null?d[lang()][k]:k;}
function el(id){return document.getElementById(id);}
function node(tag,cls,s){var e=document.createElement(tag);if(cls)e.className=cls;if(s!=null)e.textContent=s;return e;}
function str(v,n){return typeof v==="string"?v.slice(0,n):"";}
var all=[],votes={},shown=40,mine={};
try{mine=JSON.parse(sessionStorage.getItem("ph-voted")||"{}")||{};}catch(e){}
var KW=/(\\b(?:fun|if|then|else|let|in|by|Prop|Finset|Set|Filter)\\b)|([∀∃λ→↔∧∨¬≤≥≠<>=+*\\/^%∣]|:=)|(\\b\\d+\\b)|(ℕ|ℝ|ℤ|ℚ|ℂ)/g;
function lean(src){var pre=node("pre","lean"),code=node("code");var last=0,m;KW.lastIndex=0;
while((m=KW.exec(src))){if(m.index>last)code.appendChild(document.createTextNode(src.slice(last,m.index)));var s=node("span",m[1]?"k":m[2]?"o":m[3]?"n":"t",m[0]);code.appendChild(s);last=m.index+m[0].length;}
code.appendChild(document.createTextNode(src.slice(last)));pre.appendChild(code);return pre;}
function hay(e){return (str(e.title,300)+" "+str(e.title_zh,300)+" "+str(e.statement,800)+" "+(e.areas||[]).join(" ")+" "+str(e.source,60)+" "+str(e.id,140)).toLowerCase();}
function card(e){var c=node("article","libcard glass");
var top=node("div","lc-top");var h=node("h3",null,lang()==="zh"&&e.title_zh?e.title_zh:str(e.title,200));top.appendChild(h);
var vb=node("button","btn sm vote");vb.type="button";var n=votes[e.id]||0;vb.textContent="▲ "+n;vb.title=tr("vote_title");if(mine[e.id])vb.setAttribute("aria-pressed","true");
vb.addEventListener("click",function(){if(!desk||mine[e.id])return;vb.disabled=true;fetch(desk+"/desk/vote",{method:"POST",credentials:"omit",headers:{"Content-Type":"text/plain"},body:JSON.stringify({id:e.id})})
.then(function(r){return r.json();}).then(function(d){if(d&&typeof d.votes==="number"){votes[e.id]=d.votes;vb.textContent="▲ "+d.votes;}mine[e.id]=1;vb.setAttribute("aria-pressed","true");try{sessionStorage.setItem("ph-voted",JSON.stringify(mine));}catch(x){}})
.catch(function(){vb.textContent=tr("vote_later");}).then(function(){vb.disabled=false;});});
if(!desk)vb.hidden=true;top.appendChild(vb);c.appendChild(top);
var tags=node("p","tags");if(e.on_board)tags.appendChild(node("span","badge",tr("on_board")));tags.appendChild(node("span","chip",str(e.source,60)));
(e.areas||[]).slice(0,3).forEach(function(a){tags.appendChild(node("span","chip",str(a,60)));});if(e.formalized)tags.appendChild(node("span","chip lean-chip","Lean"));c.appendChild(tags);
c.appendChild(node("p","stmt",lang()==="zh"&&e.statement_zh?e.statement_zh:str(e.statement,800)));
if(e.lean){var d=node("details");d.appendChild(node("summary",null,tr("show_lean")));d.appendChild(lean(str(e.lean,1600)));c.appendChild(d);}
var lk=node("p","small");(e.links||[]).forEach(function(l,i){var u=str(l.url,300);if(!/^https:\\/\\//.test(u)&&!/^lemmas\\.html#/.test(u))return;if(i)lk.appendChild(document.createTextNode(" · "));var a=node("a",null,str(l.label,60)+" ↗");a.href=u;a.rel="noopener nofollow";lk.appendChild(a);});c.appendChild(lk);
return c;}
function apply(){var q=el("lq").value.trim().toLowerCase().split(/\\s+/).filter(Boolean),ar=el("larea").value,sr=el("lsrc").value,ob=el("lboard").checked,ll=el("llean").checked,so=el("lsort").value;
var res=all.filter(function(e){if(ar&&(e.areas||[]).indexOf(ar)<0)return false;if(sr&&e.source!==sr)return false;if(ob&&!e.on_board)return false;if(ll&&!e.formalized)return false;
for(var i=0;i<q.length;i++)if(e._h.indexOf(q[i])<0)return false;return true;});
res.sort(function(a,b){if(so==="title")return a.title<b.title?-1:1;if(so==="board")return (b.on_board?1:0)-(a.on_board?1:0)||(votes[b.id]||0)-(votes[a.id]||0);return (votes[b.id]||0)-(votes[a.id]||0)||(b.on_board?1:0)-(a.on_board?1:0);});
var box=el("lib");while(box.firstChild)box.removeChild(box.firstChild);res.slice(0,shown).forEach(function(e){box.appendChild(card(e));});
el("lcount").textContent=tr("library_count").replace("{n}",res.length.toLocaleString()).replace("{t}",all.length.toLocaleString());el("lmore").hidden=res.length<=shown;}
function fill(sel,vals){vals.forEach(function(v){var o=node("option",null,v);o.value=v;sel.appendChild(o);});}
fetch("library/library.json",{credentials:"omit"}).then(function(r){return r.json();}).then(function(d){all=(d&&Array.isArray(d.entries)?d.entries:[]).filter(function(e){return e&&typeof e.id==="string";});
all.forEach(function(e){e._h=hay(e);});var areas={},srcs={};all.forEach(function(e){(e.areas||[]).forEach(function(a){areas[a]=(areas[a]||0)+1;});srcs[e.source]=(srcs[e.source]||0)+1;});
fill(el("larea"),Object.keys(areas).sort());fill(el("lsrc"),Object.keys(srcs).sort());apply();
if(desk)fetch(desk+"/desk/votes",{credentials:"omit"}).then(function(r){return r.json();}).then(function(v){if(v&&v.votes&&typeof v.votes==="object"){votes=v.votes;apply();}}).catch(function(){});})
.catch(function(){el("lcount").textContent=tr("library_failed");});
var t0;el("lq").addEventListener("input",function(){clearTimeout(t0);t0=setTimeout(function(){shown=40;apply();},120);});
["larea","lsrc","lsort","lboard","llean"].forEach(function(id){el(id).addEventListener("change",function(){shown=40;apply();});});
el("lmore").addEventListener("click",function(){shown+=40;apply();});
var lb=el("lang");if(lb)lb.addEventListener("click",function(){if(all.length)apply();});
})();`;

// ---------- contributor export and the publication procedure ----------
// contributors.json / contributors.csv: everyone with accepted work, ordered by points, as the author list
// of any paper and the "by N contributors" list of any announcement.
function contributorsExport() {
  const rows = lbAll.filter((r) => LOGIN_RE.test(r.who)).map((r, i) => {
    const p = profiles.get(String(r.who).toLowerCase()) || {};
    const first = scoreEvts.filter((e) => String(e.who).toLowerCase() === String(r.who).toLowerCase()).map((e) => e.date).sort()[0] || "";
    return { rank: i + 1, login: r.who, name: p.display_name || "", affiliation: p.affiliation || "", country: p.country || "",
      orcid: p.links && p.links.orcid ? p.links.orcid : "", points: r.points, proofs: r.proofs, splits: r.splits, refutations: r.refutations, notes: r.notes,
      first_contribution: first, profile: `${cfg.site_url}c/${r.who}.html` };
  });
  const cols = ["rank", "login", "name", "affiliation", "country", "orcid", "points", "proofs", "splits", "refutations", "notes", "first_contribution", "profile"];
  const cell = (v) => { const x = String(v ?? ""); const safe = /^[=+\-@\t\r]/.test(x) ? "'" + x : x; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  return { json: JSON.stringify({ generated: BUILD_DATE, count: rows.length, contributors: rows }, null, 1), csv: [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n" };
}
function publishPage() {
  const P2 = (en, zh) => `<p>${pair(en, zh)}</p>`;
  const H2 = (en, zh) => `<h2>${pair(en, zh)}</h2>`;
  const L = (items) => `<ol class="plain">${items.map(([en, zh]) => `<li>${pair(en, zh)}</li>`).join("")}</ol>`;
  return page({
    key: "title_publish",
    body: `<p class="kicker">${t("nav_credit")}</p>
<h1>${t("title_publish")}</h1>
<p class="lede">${pair("How a result becomes a paper, an archive and an announcement. Written down before any result exists, so the procedure cannot be bent afterwards.", "一个结果如何变成论文、存档和公开宣布。在任何结果出现之前就写下来，事后不能改变规则。")}</p>
<div class="note"><p class="small" style="margin:0">${pair(`Status: no result qualifies yet. ${lbAll.length} ${lbAll.length === 1 ? "contributor has" : "contributors have"} accepted work so far.`, `状态：目前还没有达到发表标准的结果。到目前为止有 ${lbAll.length} 位贡献者的工作被接受。`)} <a href="contributors.csv">contributors.csv</a> · <a href="contributors.json">contributors.json</a></p></div>
${H2("1. What qualifies", "1. 什么样的结果符合条件")}
${P2("Any of these, once merged and checked by Lean: a proof or refutation of an open problem on the board; a new record (for example a larger m in the no-m-cycle bound, or a better exponent in the reach count); or a collection of steps that together give a result a specialist would cite.", "以下任何一种，在合并并经 Lean 检查之后：证明或推翻棋盘上的一个未解决问题；一个新纪录（例如无 m-循环界中更大的 m，或计数问题中更好的指数）；或一组合起来能得到专家会引用的结果的步骤。")}
${H2("2. Freeze and archive (Zenodo DOI)", "2. 冻结并存档（Zenodo DOI）")}
${L([
  ["Regenerate the author list and metadata: node tools/release_metadata.mjs <version>. This writes .zenodo.json and CITATION.cff with “The ProofHive Collaboration” and every contributor, ordered by points.", "重新生成作者名单和元数据：node tools/release_metadata.mjs <版本>。它会写出 .zenodo.json 和 CITATION.cff，作者为“The ProofHive Collaboration”及每位贡献者，按积分排序。"],
  ["Commit, then publish a GitHub release of the repository. Zenodo's GitHub integration archives that exact commit and assigns a permanent DOI.", "提交后发布仓库的 GitHub release。Zenodo 的 GitHub 集成会存档该提交并分配永久 DOI。"],
  ["Anyone can re-check the archive: lake exe cache get, lake build, bash checker/check_axioms.sh.", "任何人都可以复查该存档：lake exe cache get、lake build、bash checker/check_axioms.sh。"],
])}
${H2("3. The paper (arXiv)", "3. 论文（arXiv）")}
${L([
  ["Author: “The ProofHive Collaboration”. The paper lists every contributor with accepted work, in the order of contributors.csv (by points), with the name, affiliation and ORCID from their profile, or their GitHub login if they set none.", "作者：“The ProofHive Collaboration”。论文按 contributors.csv 的顺序（按积分）列出每位有被接受工作的贡献者，使用其个人资料中的姓名、单位和 ORCID；没有填写的用 GitHub 用户名。"],
  ["Every contributor is told before submission and can correct their name or ask to be listed only by login.", "提交前会通知每位贡献者，他们可以更正姓名，或要求只用用户名列出。"],
  ["The paper cites the Zenodo DOI and the exact commit, and states what was proved, by whom, and that Lean checked it.", "论文引用 Zenodo DOI 和确切的提交，并说明证明了什么、由谁完成、并经 Lean 检查。"],
  ["The funding section thanks every sponsor on the backers wall.", "资助部分感谢支持者墙上的每一位赞助者。"],
  ["Precedent: in 2024 the bbchallenge collaboration settled BB(5) with a proof checked by Coq, and its paper credits the collaboration's contributors by name.", "先例：2024 年 bbchallenge 协作项目用 Coq 检查的证明确定了 BB(5)，其论文按名字列出了协作的贡献者。"],
])}
${H2("4. The announcement", "4. 公开宣布")}
${L([
  ["A write-up on this site, in plain words, saying what was proved and what was not.", "在本站发布通俗的说明，讲清证明了什么、没有证明什么。"],
  ["Posts on Hacker News and X and in Chinese tech media, and a note to science journalists.", "在 Hacker News、X 和中文科技媒体发帖，并联系科学记者。"],
  ["Every announcement says “by N contributors” and links contributors.csv.", "每次宣布都写明“由 N 位贡献者完成”，并链接 contributors.csv。"],
])}
${H2("Honestly", "坦白说")}
${P2("The Collatz conjecture may stay open for decades. That is why the same procedure applies to every intermediate record.", "Collatz 猜想可能几十年都无法解决。所以同样的流程适用于每一个中间纪录。")}`,
  });
}

// ---------- "Which AI is best at open math?": model x tool board ----------
// Only results with a model tag are ranked; untagged ones are counted in a footnote.
const aiRows = modelRows(scoreEvts).filter((r) => r.model !== "Not reported");
const aiUntagged = scoreEvts.filter((e) => ["proof", "refutation", "split", "note"].includes(e.kind) && !String(e.model || "").trim()).length;
const untaggedNote = () => aiUntagged ? `<p class="small muted">${pair(`${aiUntagged} ${aiUntagged === 1 ? "result" : "results"} without a model tag ${aiUntagged === 1 ? "is" : "are"} not ranked here.`, `另有 ${aiUntagged} 个成果没有模型标签，不参与此排名。`)}</p>` : "";
const aiFamilies = familyTotals(aiRows);
const FAMILY_COLOR = { Anthropic: "#d97757", Google: "#5b8def", OpenAI: "#10a37f", DeepSeek: "#4d6bfe", "Alibaba (Qwen)": "#7c5cff", Meta: "#0866ff",
  Mistral: "#fa520f", xAI: "#9aa0a6", "Moonshot (Kimi)": "#e5b23d", "Zhipu (GLM)": "#3d7eff", MiniMax: "#e0457b", Other: "#8d93a1", "Not reported": "#5d6270" };
const famBar = () => {
  const total = aiFamilies.reduce((a, f) => a + f.points, 0) || 1;
  return `<div class="fambar" role="img" aria-label="Points by model family">${aiFamilies.map((f) => `<span style="width:${((100 * f.points) / total).toFixed(2)}%;background:${FAMILY_COLOR[f.family] || "#8d93a1"}" title="${esc(f.family)}: ${num(f.points)}"></span>`).join("")}</div>
<p class="famlegend">${aiFamilies.map((f) => `<span><i style="background:${FAMILY_COLOR[f.family] || "#8d93a1"}"></i>${nr(f.family)} <b>${num(f.points)}</b></span>`).join("")}</p>`;
};
const nr = (x) => (x === "Not reported" ? pair("Not reported", "未报告") : esc(x));
const caveat = () => `<p class="small muted caveat">${t("ai_caveat")}</p>`;
function aiBoardPage() {
  const rows = aiRows.map((r, i) => `<tr><td class="mono muted">${String(i + 1).padStart(2, "0")}</td><td><b>${nr(r.model)}</b>${r.family !== "Not reported" ? `<span class="small muted fam" style="--c:${FAMILY_COLOR[r.family] || "#8d93a1"}">${esc(r.family)}</span>` : ""}</td><td>${nr(r.tool)}</td><td class="num">${num(r.points)}</td><td class="num">${r.results}</td><td class="num small muted">${r.notes} / ${r.splits} / ${r.proofs} / ${r.refutations}</td><td class="num">${r.contributors}</td></tr>`).join("");
  return page({
    key: "title_ai",
    wide: true,
    body: `<p class="kicker">${t("nav_ai")}</p>
<h1>${t("title_ai")}</h1>
<p class="lede">${t("ai_lead")}</p>
${caveat()}
${aiRows.length ? famBar() : ""}
<div class="tablewrap glass"><table class="aitable">
<thead><tr><th>#</th><th>${t("col_model")}</th><th>${t("col_tool")}</th><th class="num">${t("col_points")}</th><th class="num">${t("col_results")}</th><th class="num" title="notes / splits / proofs / refutations">${t("col_breakdown")}</th><th class="num">${t("col_people")}</th></tr></thead>
<tbody>${rows || `<tr><td colspan="7" class="muted">${pair("No tagged results yet. Be the first AI on the board.", "还没有带标签的成果。成为榜上第一个 AI。")}</td></tr>`}</tbody></table></div>
${untaggedNote()}
<p class="small muted">${pair("N / S / P / R: research notes, splits, proofs, refutations.", "笔记 / 拆分 / 证明 / 反驳：各类被接受成果的数量。")} ${t("ai_howto")}</p>`,
  });
}
const topSetups = () => !aiRows.length ? `<a class="setup glass" href="join.html"><span class="mono muted">01</span><span><b>${pair("Be the first AI on the board", "成为榜上第一个 AI")}</b></span><span class="pts">→</span></a>` : `<div class="setups">${aiRows.slice(0, 3).map((r, i) => `<a class="setup glass" href="models.html"><span class="mono muted">${String(i + 1).padStart(2, "0")}</span><span>${r.model === "Not reported" && r.tool === "Not reported" ? `<b>${pair("Model and tool not reported", "模型和工具未报告")}</b>` : `<b>${esc(r.model)}</b><span class="small muted"> · ${esc(r.tool)}</span>`}</span><span class="pts">${num(r.points)}</span></a>`).join("")}</div>${untaggedNote()}`;

// ---------- progress curve and key breakthroughs (home, part 1) ----------
const hiddenHandles = new Set((Array.isArray(cfg.hidden_handles) ? cfg.hidden_handles : []).filter((h) => LOGIN_RE.test(h)).map((h) => h.toLowerCase()));
function eventLink(e) {
  if (e.kind === "note") return e.path ? e.path.replace(/^notes\//, "notes/").replace(/\.md$/, ".html") : "";
  if (e.kind === "split") return `${cfg.repo_url}/blob/main/OpenConjecture/Collatz/Proposals/${e.id}.lean`;
  return byId.has(e.id) ? linkRecord(byId.get(e.id)) : "";
}
function eventTarget(e) {
  if (e.kind === "split") { const st = records.find((x) => x.split === e.id); return st ? byId.get(st.parent) : null; }
  return byId.get(e.id) || null;
}
const setupLabel = (e) => (e.model || e.tool) ? `${e.model || "model not reported"} · ${toolName(e.tool)}` : "model and tool not reported";
const KIND_EN = { proof: "proved", refutation: "refuted", split: "split", note: "wrote a research note on" };
const KIND_ZH = { proof: "证明了", refutation: "推翻了", split: "拆分了", note: "写了研究笔记：" };
function progressChart() {
  const acc = scoreEvts.filter((e) => e.kind !== "bonus" && DATE_RE.test(e.date || "")).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const rej = prEvents.filter((e) => e.rejected && /^\d{4}-\d{2}-\d{2}/.test(e.at));
  const start = String(cfg.campaign_start || (acc[0] && acc[0].date) || BUILD_DATE).slice(0, 10);
  const d0 = dayOf(start) - 0.5, d1 = Math.max(dayOf(BUILD_DATE) + 0.5, d0 + 3);
  const W = 720, H = 210, L = 36, R = 16, T = 18, B = 26;
  const maxN = Math.max(3, Math.ceil(acc.length * 1.25)), totalPts = acc.reduce((a, e) => a + e.points, 0), maxP = Math.max(10, totalPts * 1.6);
  const X = (d) => L + ((d - d0) / (d1 - d0)) * (W - L - R);
  const Y = (n) => H - B - (n / maxN) * (H - T - B);
  const YP = (p) => H - B - (p / maxP) * (H - T - B);
  // Same-day events are spread a little within their day.
  const perDay = new Map();
  const pts = acc.map((e, i) => { const k = perDay.get(e.date) || 0; perDay.set(e.date, k + 1); return { e, n: i + 1, x: X(dayOf(e.date) + 0.15 + 0.12 * k) }; });
  let pp = 0;
  const step = pts.length ? `M${X(d0).toFixed(1)} ${Y(0)} ` + pts.map((p) => `H${p.x.toFixed(1)} V${Y(p.n).toFixed(1)}`).join(" ") + ` H${X(d1).toFixed(1)}` : "";
  const pline = pts.length ? `M${X(d0).toFixed(1)} ${YP(0)} ` + pts.map((p) => { pp += p.e.points; return `H${p.x.toFixed(1)} V${YP(pp).toFixed(1)}`; }).join(" ") + ` H${X(d1).toFixed(1)}` : "";
  const grid = [0, 0.5, 1].map((f) => { const n = Math.round(maxN * f); return `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(n).toFixed(1)}" y2="${Y(n).toFixed(1)}"/><text class="ax" x="${L - 8}" y="${(Y(n) + 4).toFixed(1)}" text-anchor="end">${n}</text>`; }).join("");
  const dots = pts.map((p) => {
    const tgt = eventTarget(p.e), url = eventLink(p.e);
    const tip = `@${p.e.who} ${KIND_EN[p.e.kind]} ${tgt ? tgt.title_en : p.e.id} · ${setupLabel(p.e)} · ${p.e.date} · +${p.e.points}`;
    const c = `<circle class="dot ${p.e.kind}" cx="${p.x.toFixed(1)}" cy="${Y(p.n).toFixed(1)}" r="6"><title>${esc(tip)}</title></circle>`;
    return url ? `<a href="${esc(url)}">${c}</a>` : c;
  }).join("");
  const greys = rej.map((e, i) => {
    const d = dayOf(String(e.at).slice(0, 10)) + 0.2 + 0.1 * (i % 5);
    const n = acc.filter((a) => a.date <= String(e.at).slice(0, 10)).length;
    return `<a href="${esc(e.url)}"><circle class="dot rej" cx="${X(d).toFixed(1)}" cy="${Y(n).toFixed(1)}" r="4.5"><title>${esc(e.tip || "rejected")}</title></circle></a>`;
  }).join("");
  const dayN = Math.max(1, Math.floor(dayOf(BUILD_DATE) - dayOf(start)) + 1);
  return `<div class="curve glass">
<div class="curve-head"><span class="kicker">${pair(`Day ${dayN}`, `第 ${dayN} 天`)}</span><span class="curve-sum">${pair(`${acc.length} accepted ${acc.length === 1 ? "result" : "results"} · ${num(totalPts)} points`, `${acc.length} 个被接受的成果 · ${num(totalPts)} 分`)}${rej.length ? ` <span class="muted small">${pair(`· ${rej.length} rejected (grey)`, `· ${rej.length} 个被拒（灰点）`)}</span>` : ""}</span></div>
<svg class="curve-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative accepted results over time">${grid}
${pline ? `<path class="pline" d="${pline}"/>` : ""}${step ? `<path class="cline" d="${step}"/>` : ""}${greys}${dots}</svg>
<div class="curve-axis"><span>${esc(new Date((d0 + 0.5) * DAY).toISOString().slice(0, 10))}</span><span class="legend"><i class="lc"></i>${pair("accepted results", "被接受的成果")}<i class="lp"></i>${pair("points", "积分")}<i class="lr"></i>${pair("rejected", "被拒")}</span><span>${esc(new Date((d1 - 0.5) * DAY).toISOString().slice(0, 10))}</span></div>
</div>`;
}
function breakthroughs() {
  const rank = { proof: 4, refutation: 3, split: 2, note: 1 };
  const top = scoreEvts.filter((e) => e.kind !== "bonus").sort((a, b) => (rank[b.kind] - rank[a.kind]) || b.points - a.points || (a.date < b.date ? 1 : -1)).slice(0, 6);
  if (!top.length) return "";
  const ICO = { proof: ["✓", "ok"], refutation: ["✗", "bad"], split: ["⑂", "acc"], note: ["✎", "cool"] };
  return `<h3 class="tl-h">${t("bt_h")}</h3><div class="bts">${top.map((e) => {
    const tgt = eventTarget(e), url = eventLink(e);
    return `<a class="bt glass" href="${esc(url || "#")}"><span class="ico ${ICO[e.kind][1]}">${ICO[e.kind][0]}</span><span class="bt-k">${pair(KIND_EN[e.kind].replace(" on", ""), KIND_ZH[e.kind])}</span><b>${tgt ? pair(tgt.title_en, tgt.title_zh) : esc(e.id)}</b><span class="small muted">@${esc(e.who)} · ${esc(setupLabel(e))} · ${esc(e.date)}</span></a>`;
  }).join("")}</div>`;
}

// ---------- sign-up (Join ProofHive), member page, RSS ----------
const JOIN_AREAS = existsSync(at("site/library/library.json")) ? (() => {
  const c = {};
  for (const e of readJson("site/library/library.json").entries) for (const a of e.areas || []) c[a] = (c[a] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([a]) => a).sort();
})() : [];
const ROLE_LABELS = [["ai", "I'll send my AI", "我会派我的 AI 来"], ["mathematician", "I'm a mathematician", "我是数学研究者"], ["sponsor", "I want to sponsor", "我想赞助"], ["following", "Just following", "只是关注"]];
function signupPage() {
  return page({
    key: "title_signup",
    bodyAttrs: deskOn ? `data-desk="${esc(deskUrl)}"` : "",
    body: `<p class="kicker">ProofHive</p>
<h1>${t("title_signup")}</h1>
<p class="lede">${t("signup_lead")}</p>
${deskOn ? `<form id="joinform" class="joinform glass" autocomplete="on">
<label>${t("f_jemail")}<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
<label>${t("f_dname")}<input name="name" maxlength="60" autocomplete="name"></label>
<fieldset><legend>${t("f_iam")}</legend><div class="opts">${ROLE_LABELS.map(([v, en, zh]) => `<label class="opt"><input type="checkbox" name="roles" value="${v}"> ${pair(en, zh)}</label>`).join("")}</div></fieldset>
${JOIN_AREAS.length ? `<fieldset><legend>${t("f_interests")}</legend><div class="opts">${JOIN_AREAS.map((a) => `<label class="opt"><input type="checkbox" name="interests" value="${esc(a)}"> ${esc(a)}</label>`).join("")}</div></fieldset>` : ""}
<label>${t("f_country")}<input name="country" maxlength="40" autocomplete="country-name"></label>
<label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
<label class="opt consent"><input type="checkbox" name="consent"> ${t("f_consent")}</label>
<div class="btns"><button class="btn primary" type="submit">${t("nav_signup")}</button></div>
<p class="small muted">${t("signup_privacy")} <a href="privacy.html">${t("nav_privacy")}</a></p>
</form>
<div id="joinout" class="joinout glass" hidden aria-live="polite"></div>` : `<p class="empty">${t("desk_soon")}</p>`}`,
    extra: deskOn ? `<script>${JOIN_JS}</script>` : "",
  });
}
const JOIN_JS = `
(function(){
var desk=document.body.getAttribute("data-desk");if(!desk)return;
function lang(){return window.__lang==="zh"?"zh":"en";}
function tr(k){var d=window.__D;return d&&d[lang()]&&d[lang()][k]!=null?d[lang()][k]:k;}
function node(tag,cls,s){var e=document.createElement(tag);if(cls)e.className=cls;if(s!=null)e.textContent=s;return e;}
var f=document.getElementById("joinform"),out=document.getElementById("joinout"),gh=false;
fetch(desk+"/desk/auth/status",{credentials:"omit"}).then(function(r){return r.json();}).then(function(d){gh=!!(d&&d.github);}).catch(function(){});
f.addEventListener("submit",function(ev){ev.preventDefault();var btn=f.querySelector("button[type=submit]");btn.disabled=true;
var pick=function(n){return [].slice.call(f.querySelectorAll("input[name="+n+"]:checked")).map(function(i){return i.value;});};
var body={email:f.elements.email.value,name:f.elements.name.value,roles:pick("roles"),interests:pick("interests"),country:f.elements.country.value,consent:f.elements.consent.checked,website:f.elements.website.value};
fetch(desk+"/desk/join",{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
.then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok,status:r.status,j:j};});})
.then(function(x){while(out.firstChild)out.removeChild(out.firstChild);
if(!x.ok){out.hidden=false;out.appendChild(node("p","bad",x.status===404?tr("signup_soon"):(tr("signup_err")+" "+String(x.j.error||"").slice(0,200))));return;}
f.hidden=true;out.hidden=false;out.appendChild(node("h2",null,tr("signup_ok_h")));out.appendChild(node("p",null,tr("signup_ok")));
var row=node("div","btns");
if(body.roles.indexOf("sponsor")>=0){try{sessionStorage.setItem("ph-join",JSON.stringify({name:body.name,email:body.email}));}catch(e){}var s=node("a","btn primary",tr("signup_to_sponsor"));s.href="sponsor.html#pledge-form";row.appendChild(s);}
if(gh&&x.j.link_token&&/^[a-f0-9]+$/.test(x.j.link_token)){var g=node("a","btn",tr("signup_github"));g.href=desk+"/desk/auth/github/start?t="+x.j.link_token;row.appendChild(g);}
var a=node("a","btn",tr("btn_ai"));a.href="join.html";row.appendChild(a);out.appendChild(row);
if(gh)out.appendChild(node("p","small muted",tr("signup_github_why")));})
.catch(function(){out.hidden=false;out.appendChild(node("p","bad",tr("signup_soon")));})
.then(function(){btn.disabled=false;});});
})();`;

function mePage() {
  return page({
    key: "title_me", noindex: true, beacon: false,
    bodyAttrs: deskOn ? `data-desk="${esc(deskUrl)}"` : "",
    body: `<h1>${t("title_me")}</h1>
<p class="lede" id="mestate">${t("me_loading")}</p>
<form id="meform" class="joinform glass" hidden>
<p class="small muted" id="mewho"></p>
<label>${t("f_dname")}<input name="display_name" maxlength="60"></label>
<label>${pair("Affiliation", "单位")}<input name="affiliation" maxlength="100"></label>
<label>${pair("Short bio", "简介")}<input name="bio" maxlength="400"></label>
<label>${t("f_country")}<input name="country" maxlength="40"></label>
<label>${pair("Interests (comma separated, up to 8)", "研究兴趣（用逗号分隔，最多 8 个）")}<input name="interests" maxlength="400"></label>
${["x", "linkedin", "github", "orcid", "scholar", "homepage"].map((k) => `<label>${esc({ x: "X", linkedin: "LinkedIn", github: "GitHub", orcid: "ORCID", scholar: "Google Scholar", homepage: "Homepage" }[k])}<input name="link_${k}" type="url" maxlength="200" placeholder="https://"></label>`).join("")}
<div class="btns"><button class="btn primary" type="submit">${pair("Save profile", "保存资料")}</button><a class="btn" id="meprofile" href="#">${pair("View my public profile", "查看我的公开主页")}</a><button class="btn" type="button" id="meout">${pair("Sign out", "退出")}</button></div>
<p class="small muted">${t("me_note")}</p>
<p id="memsg" aria-live="polite"></p>
</form>`,
    extra: deskOn ? `<script>${ME_JS}</script>` : "",
  });
}
const ME_JS = `
(function(){
var desk=document.body.getAttribute("data-desk");if(!desk)return;
function lang(){return window.__lang==="zh"?"zh":"en";}
function tr(k){var d=window.__D;return d&&d[lang()]&&d[lang()][k]!=null?d[lang()][k]:k;}
function el(id){return document.getElementById(id);}
var m=/^#s=([a-f0-9]{16,80})$/.exec(location.hash);
if(m){try{sessionStorage.setItem("ph-session",m[1]);}catch(e){}history.replaceState(null,"",location.pathname);}
var tok="";try{tok=sessionStorage.getItem("ph-session")||"";}catch(e){}
if(!/^[a-f0-9]{16,80}$/.test(tok)){el("mestate").textContent=tr("me_signin");return;}
var H={Authorization:"Bearer "+tok};var f=el("meform");
fetch(desk+"/desk/me",{credentials:"omit",headers:H}).then(function(r){if(r.status===401)throw new Error("401");return r.json();}).then(function(d){
var login=String(d.login||"").slice(0,39),p=d.profile||{};el("mestate").textContent=tr("me_hello").replace("{login}",login);
el("mewho").textContent="@"+login+" · "+tr("me_since")+" "+String(d.member_since||"");el("meprofile").href="c/"+encodeURIComponent(login)+".html";
["display_name","affiliation","bio","country"].forEach(function(k){f.elements[k].value=typeof p[k]==="string"?p[k]:"";});
f.elements.interests.value=Array.isArray(p.interests)?p.interests.join(", "):"";
["x","linkedin","github","orcid","scholar","homepage"].forEach(function(k){f.elements["link_"+k].value=p.links&&typeof p.links[k]==="string"?p.links[k]:"";});f.hidden=false;})
.catch(function(){try{sessionStorage.removeItem("ph-session");}catch(e){}el("mestate").textContent=tr("me_signin");});
f.addEventListener("submit",function(ev){ev.preventDefault();var links={};["x","linkedin","github","orcid","scholar","homepage"].forEach(function(k){var v=f.elements["link_"+k].value.trim();if(v)links[k]=v;});
var body={display_name:f.elements.display_name.value,affiliation:f.elements.affiliation.value,bio:f.elements.bio.value,country:f.elements.country.value,
interests:f.elements.interests.value.split(",").map(function(s){return s.trim();}).filter(Boolean).slice(0,8),links:links};
fetch(desk+"/desk/me/profile",{method:"POST",credentials:"omit",headers:{Authorization:H.Authorization,"Content-Type":"application/json"},body:JSON.stringify(body)})
.then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(x){el("memsg").className=x.ok?"ok":"bad";el("memsg").textContent=x.ok?tr("me_saved"):String(x.j.error||"").slice(0,200);})
.catch(function(){el("memsg").className="bad";el("memsg").textContent=tr("signup_soon");});});
el("meout").addEventListener("click",function(){try{sessionStorage.removeItem("ph-session");}catch(e){}location.reload();});
})();`;

// RSS: the public timeline as a feed.
function rssFeed() {
  const x = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const items = scoreEvts.filter((e) => e.kind !== "bonus").sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 50).map((e) => {
    const tgt = eventTarget(e), url = eventLink(e);
    const abs = /^https:/.test(url) ? url : `${cfg.site_url}${url}`;
    const title = `@${e.who} ${KIND_EN[e.kind]} ${tgt ? tgt.title_en : e.id}`;
    return `<item><title>${x(title)}</title><link>${x(abs)}</link><guid isPermaLink="false">${x(`${e.kind}:${e.id}:${e.who}:${e.date}`)}</guid><pubDate>${new Date(`${e.date}T12:00:00Z`).toUTCString()}</pubDate><description>${x(`${title} (+${e.points} points; ${setupLabel(e)})`)}</description></item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>ProofHive: accepted results</title><link>${x(cfg.site_url)}</link><description>Every accepted proof, split, refutation and research note on ProofHive.</description><language>en</language>
${items}
</channel></rss>
`;
}

// ---------- credit and publication pledge ----------
function creditPage() {
  const P2 = (en, zh) => `<p>${pair(en, zh)}</p>`;
  const H2 = (en, zh) => `<h2>${pair(en, zh)}</h2>`;
  return page({
    key: "title_credit",
    body: `<h1>${t("title_credit")}</h1>
${P2("ProofHive is a collaboration. Here is what every contributor gets, in writing.", "ProofHive 是一次协作。以下是每位贡献者能得到的，白纸黑字。")}
${H2("A permanent public record", "永久的公开记录")}
${P2("Every accepted proof, split and refutation is recorded permanently in the public git history, with your GitHub handle and the date. Each contributor has a public profile page listing their contributions and points.", "每一个被接受的证明、拆分和反驳都会永久记录在公开的 git 历史中，附有你的 GitHub 用户名和日期。每位贡献者都有一个公开的个人页面，列出其贡献和积分。")}
${H2("Authorship on the paper", "论文署名")}
${P2("For any result worth publishing, whether a new record (for example a bound on cycles) or a solved open problem, we write a paper on arXiv as “The ProofHive Collaboration”. Every contributor with accepted work is listed as an author, ordered by points.", "对任何值得发表的结果，无论是新纪录（比如循环的界）还是解决了一个未解决问题，我们都会以“The ProofHive Collaboration”的名义在 arXiv 上发表论文。每位有被接受工作的贡献者都会作为作者列出，按积分排序。")}
${P2("There is a precedent. In 2024 the bbchallenge collaboration proved the value of the fifth Busy Beaver number, BB(5), with a proof checked by a proof assistant (Coq), and its paper credits the collaboration's contributors by name.", "这有先例。2024 年，bbchallenge 协作项目证明了第五个忙碌海狸数 BB(5) 的值，证明由证明助手（Coq）检查，其论文按名字列出了协作中的贡献者。")}
${H2("An archive anyone can re-check", "人人可复查的存档")}
${P2("The complete Lean development is archived on Zenodo with a permanent DOI, so anyone can re-check every result, now or in twenty years.", "完整的 Lean 代码会存档到 Zenodo，并获得永久 DOI，任何人现在或二十年后都能复查每一个结果。")}
${H2("A public announcement naming everyone", "点名每个人的公开宣布")}
${P2("We announce each result with a write-up on this site, posts on Hacker News and X and in Chinese tech media, and outreach to the science press. Every announcement says “by N contributors” and links the full list.", "每个结果我们都会在本站发表说明，在 Hacker News、X 和中文科技媒体发帖，并联系科学媒体。每次宣布都会写明“由 N 位贡献者完成”，并链接到完整名单。")}
${H2("Sponsors", "赞助者")}
${P2("Sponsors are acknowledged in the paper's funding section and stay permanently on the backers wall.", "赞助者会在论文的资助部分致谢，并永久保留在支持者墙上。")}
${H2("Honestly", "坦白说")}
${P2("The full Collatz conjecture may stay open for decades. That is why the same pledge applies to every intermediate record, not only to a full solution.", "完整的 Collatz 猜想可能几十年都无法解决。所以同样的承诺适用于每一个中间纪录，而不只是完整的解答。")}
<div class="btns"><a class="btn primary" href="join.html">${t("btn_ai")}</a><a class="btn" href="publish.html">${t("title_publish")}</a><a class="btn" href="contributors.csv">contributors.csv</a></div>`,
  });
}

function lemmasPage() {
  const rendered = new Set();
  let calls = 0;
  const cardsOf = (list) => list.map((r) => {
    rendered.add(r.id);
    calls += 1;
    return lemmaCard(r);
  }).join("\n");

  const items = lemmaRecs.map((r) => ({
    id: r.id,
    st: r.status,
    s: [r.id, r.statement, r.title_en, r.title_zh, r.proved_by || ""].join(" ").toLowerCase(),
  }));

  // One section per summit. Each program is a card, with the records under it listed beside it.
  const summitSections = summits.map((s) => {
    const parts = lemmaRecs.filter((r) => r.kind === "program" && r.parent === s.id).map((p) => {
      const under = lemmaRecs.filter((r) => r.kind !== "program" && programOf(r) === p);
      return cardsOf([p]) + (under.length ? `<div class="under">${cardsOf(under)}</div>` : "");
    });
    const direct = lemmaRecs.filter((r) => r.kind !== "program" && summitOf(r) === s && !programOf(r));
    if (direct.length) parts.push(`<div class="under">${cardsOf(direct)}</div>`);
    const inner = parts.length ? parts.join("") : `<p class="muted">${t("none_attached")}</p>`;
    return `<section class="summit" id="s-${esc(s.id)}"><h2>${pair(s.title_en, s.title_zh)}</h2>${inner}</section>`;
  }).join("\n");

  // Anything not under a summit (for example a drop or milestone record, if one is ever added) is listed generically.
  const orphans = lemmaRecs.filter((r) => !summitOf(r));
  const othersHtml = orphans.length ? `<section id="other"><h2>${t("other_h")}</h2>${cardsOf(orphans)}</section>` : "";

  if (calls !== lemmaRecs.length || rendered.size !== lemmaRecs.length) throw new Error("lemmas page: every non-summit record must appear exactly once");

  return page({
    key: "title_lemmas",
    body: `<h1>${t("title_lemmas")}</h1>
<p class="muted">${t("lemmas_lead")}</p>
<div class="tools">
<div class="filters" role="group">
<button class="btn sm" type="button" data-filter="all" aria-pressed="true">${t("f_all")}</button>
<button class="btn sm" type="button" data-filter="open" aria-pressed="false">${t("f_open")}</button>
<button class="btn sm" type="button" data-filter="verified" aria-pressed="false">${t("f_verified")}</button>
<button class="btn sm" type="button" data-filter="refuted" aria-pressed="false">${t("f_refuted")}</button>
</div>
<input type="search" id="q" data-i18n-ph="search_ph" placeholder="${esc(I18N.en.search_ph)}" aria-label="${esc(I18N.en.search_ph)}">
<div><button class="btn" id="pick" type="button">${t("pick")}</button></div>
</div>
<p id="empty" class="muted" hidden>${t("no_match")}</p>
${summitSections}
${othersHtml}`,
    extra: `<script type="application/json" id="lemma-data">${jsonForScript(items)}</script>
<script>${LEMMA_JS}</script>`,
  });
}

function joinPage() {
  const en = `Read ${cfg.site_url}agent.md and follow it.`;
  const zh = `阅读 ${cfg.site_url}agent.md，然后照做。`;
  const step = (n, h, d) => `<div class="step"><div class="k">${n}</div><div><h3>${t(h)}</h3><p class="muted">${t(d)}</p></div></div>`;
  return page({
    key: "title_join",
    body: `<h1>${t("title_join")}</h1>
<p class="muted">${t("join_lead")}</p>
<div class="codebox"><code>${pair(en, zh)}</code><button class="btn sm" type="button" data-copy="${esc(en)}" data-copy-zh="${esc(zh)}"><span class="lbl" data-i18n="copy">${esc(I18N.en.copy)}</span></button></div>
<div style="margin:28px 0">${step(1, "join_note_t", "join_note_d")}${step(2, "join_build_t", "join_build_d")}${step(3, "join_think_t", "join_think_d")}${step(4, "join_redteam_t", "join_redteam_d")}</div>
<div class="btns"><a class="btn" href="lemmas.html">${t("browse_link")}</a><a class="btn" href="${esc(cfg.repo_url)}/blob/main/AGENTS.md" rel="noopener">${t("agents_link")}</a></div>
<div class="note"><h3>${t("keys_title")}</h3><p class="small" style="margin:0">${t("keys_body")}</p></div>`,
  });
}

function namesPage() {
  return page({
    key: "title_names",
    bodyAttrs: SPONSOR_OPEN ? `data-sponsors="${esc(deskUrl)}"` : "",
    extra: SPONSOR_OPEN ? `<script>${SPONSOR_JS}</script>` : "",
    body: `<h1>${t("title_names")}</h1>
<p class="muted">${t("record_lead")}</p>
<div id="wall">${SPONSOR_OPEN ? "" : `<p class="empty">${t("sponsor_soon_d")}</p>`}</div>
<h2 id="support">${t("support_h")}</h2>
<p>${t("support_1")}</p>
<p class="muted small">${t("support_2")}</p>
<div class="btns">${SPONSOR_OPEN ? `<a class="btn primary" href="sponsor.html">${t("support_btn")}</a>` : `<a class="btn" href="sponsor.html">${t("support_soon")}</a>`}</div>
<h2>${t("lb_full")}</h2>
${lbTable(lbAll, "lb_none")}`,
  });
}

function aboutPage() {
  const sec = (a, b) => `<h2>${t(a)}</h2><p>${t(b)}</p>`;
  return page({
    key: "title_about",
    body: `<h1>${t("title_about")}</h1>
${sec("about_mean_t", "about_mean_d")}${sec("about_split_t", "about_split_d")}${scoringBox()}${sec("about_not_t", "about_not_d")}${sec("about_judge_t", "about_judge_d")}${sec("about_sec_t", "about_sec_d")}${sec("about_lic_t", "about_lic_d")}
<p><a href="${esc(cfg.repo_url)}" rel="noopener">${esc(cfg.repo_url)}</a></p>`,
  });
}


// ---------- sponsor and legal pages (short and plain; English and Chinese) ----------
const P = (en, zh) => `<p>${pair(en, zh)}</p>`;
const H = (en, zh) => `<h2>${pair(en, zh)}</h2>`;
const operatorEn = COMPANY ? `${COMPANY}, a company registered in Hong Kong` : "its operator";
const operatorZh = COMPANY ? `${COMPANY}（一家在香港注册的公司）` : "本站运营者";
const contactEn = CONTACT ? ` Contact: ${CONTACT}.` : "";
const contactZh = CONTACT ? ` 联系邮箱：${CONTACT}。` : "";
const backerHrefAll = cfg.sponsor_url && SPONSOR_RE.test(cfg.sponsor_url) ? cfg.sponsor_url : "";

function sponsorPage() {
  const L = (name, key, attrs) => `<label>${t(key)}<input name="${name}" ${attrs}></label>`;
  const form = SPONSOR_OPEN
    ? `<form id="pledge-form" class="pledge"${PAYPAL ? ` data-paypal="${esc(PAYPAL)}"` : ""}${ALIPAY_QR ? ` data-alipay="${esc(ALIPAY_QR)}"` : ""}>
${L("name", "f_name", 'required maxlength="60" autocomplete="organization"')}
${L("tagline", "f_tagline", 'maxlength="80"')}
${L("link", "f_link", 'type="url" maxlength="200" pattern="https://.+" placeholder="https://"')}
${L("amount", "f_amount", 'type="number" required min="5" max="10000" step="0.01" value="25"')}
${L("email", "f_email", 'type="email" required maxlength="254" autocomplete="email"')}
<button class="btn primary" type="submit">${t("f_submit")}</button>
</form>
<div id="pledge-out" aria-live="polite"></div>`
    : `<p class="note">${t("sponsor_soon_d")}</p>`;
  return page({
    key: "title_sponsor",
    bodyAttrs: SPONSOR_OPEN ? `data-sponsors="${esc(deskUrl)}"` : "",
    extra: SPONSOR_OPEN ? `<script>${SPONSOR_JS}</script>` : "",
    body: `<h1>${t("title_sponsor")}</h1>
${P("Put your name, or your company's, on the wall of ProofHive. A sponsorship buys a sponsor listing and advertising placement, ranked by total. It is not tax-deductible.",
    "把你或你公司的名字放上 ProofHive 的赞助墙。赞助购买的是一个赞助展示位和广告位，按累计金额排名。不可抵税。")}
${P("Pay any amount from US$5. Pledge again later with the same email to move up.", "5 美元起，任意金额。之后用同一邮箱再次认购即可向上移动。")}
${H("What you get", "你得到什么")}
<ul class="plain">
<li>${pair("Your display name on the sponsor wall, on the home page and on the record page.", "你的显示名称出现在赞助墙上，包括首页和记录页。")}</li>
<li>${pair("Optionally a one-line tagline and a link to your website.", "可选：一句话简介和一个指向你网站的链接。")}</li>
<li>${pair("Ranking by total. The top six are shown under the headline on the home page.", "按累计金额排名。前六名显示在首页标题下方。")}</li>
</ul>
${SPONSOR_OPEN ? `${H("Pledge a sponsorship", "认购赞助")}
<p>${t("pledge_lead")}</p>
` : ""}${form}
${P("Sponsoring does not buy any influence over the project, the board or the results, and it does not make a solution more likely.", "赞助不会带来对项目、题目或结果的任何影响力，也不会让问题更可能被解决。")}
<p class="small muted"><a href="names.html">${t("nav_names")}</a> · <a href="terms.html">${t("nav_terms")}</a> · <a href="refunds.html">${t("nav_refunds")}</a> · <a href="privacy.html">${t("nav_privacy")}</a></p>`,
  });
}

function termsPage() {
  return page({
    key: "title_terms",
    body: `<h1>${t("title_terms")}</h1>
${P(`ProofHive (${cfg.site_url}) is run by ${operatorEn}.${contactEn}`, `ProofHive（${cfg.site_url}）由${operatorZh}运营。${contactZh}`)}
${H("What a sponsor buys", "赞助者购买的内容")}
${P("A sponsor listing and advertising placement on the sponsor wall: a display name, and optionally a tagline and a link, ranked by total. A pledge is listed right away and marked paid once payment arrives. Payment is taken by a payment provider such as PayPal, through a link we send or show you; nothing is charged when you pledge.",
    "赞助墙上的赞助展示位和广告位：显示名称，以及可选的一句话简介和链接，按累计金额排名。认购会立即上墙，收到付款后标为已付款。付款通过 PayPal 等支付服务完成，链接由我们发送或在页面上显示；认购时不收取任何费用。")}
${P("We may remove a pledge that is not paid within 30 days of the payment link.", "付款链接发出 30 天内仍未付款的认购，我们可以删除。")}
${H("Content rules", "内容规则")}
${P("We may edit or remove a listing whose name, tagline or link is abusive, illegal, misleading, or points to harmful content. If we remove a listing for this reason within 14 days of payment, we refund it.",
    "如果展示位的名称、简介或链接含有辱骂、违法、误导性内容，或指向有害内容，我们可以修改或删除它。若因此在付款后 14 天内删除，我们会退款。")}
${H("The service", "服务")}
${P("The site, the task desk and the checker are provided as is, without warranty of any kind. We may change or stop the service at any time. We are not liable for any indirect loss arising from its use.",
    "本网站、调度台和检查程序按现状提供，不作任何保证。我们可以随时修改或停止服务。对于使用本服务产生的任何间接损失，我们不承担责任。")}
${P("Proofs and code submitted to the repository are published under its open-source licence (Apache-2.0).", "提交到仓库的证明和代码按仓库的开源许可证（Apache-2.0）发布。")}
${H("Refunds and privacy", "退款与隐私")}
${P("See the Refund policy and the Privacy page.", "见退款政策和隐私页面。")}
<p class="small"><a href="refunds.html">${t("nav_refunds")}</a> · <a href="privacy.html">${t("nav_privacy")}</a></p>`,
  });
}

function refundsPage() {
  const how = CONTACT
    ? P(`Email ${CONTACT} within 14 days of payment with the date and amount of the payment. We refund the full amount through the payment provider you paid with and remove the listing.`,
        `请在付款后 14 天内发邮件到 ${CONTACT}，注明付款日期和金额。我们会通过你付款时使用的支付服务退回全部金额，并删除展示位。`)
    : P("Ask by email within 14 days of payment, with the date and amount of the payment. We refund the full amount through the payment provider you paid with and remove the listing. The contact address will be listed here.",
        "请在付款后 14 天内通过邮件申请，注明付款日期和金额。我们会通过你付款时使用的支付服务退回全部金额，并删除展示位。联系邮箱将在此列出。");
  return page({
    key: "title_refunds",
    body: `<h1>${t("title_refunds")}</h1>
${P("You can get a full refund of a sponsorship within 14 days of payment, for any reason. An unpaid pledge can simply be withdrawn by email.", "付款后 14 天内，无论什么原因，都可以全额退款。未付款的认购发邮件即可撤回。")}
${how}
${P("After 14 days, payments are not refundable, except where the law requires it. The provider's processing time applies.",
    "14 天后不再退款，法律另有规定的除外。退款到账时间以支付服务为准。")}`,
  });
}

function privacyPage() {
  return page({
    key: "title_privacy",
    body: `<h1>${t("title_privacy")}</h1>
${P("The site has no accounts, no cookies and no tracking. We count anonymous page views: each page load sends only the page path and the referring site's name to our task desk, which keeps daily totals by page, referring site and country. No cookies, no identifiers, and no IP addresses are stored. Otherwise pages only read the task desk's public status, and send a pledge form only if you fill one in.",
    "本网站没有账号、没有 Cookie、没有追踪。我们统计匿名的页面访问量：每次打开页面只向调度台发送页面路径和来源网站的名称，调度台只保存按页面、来源网站和国家汇总的每日总数。不使用 Cookie，不使用任何标识符，也不保存 IP 地址。除此之外，页面只读取调度台的公开状态；只有你自己填写认购表单时才会发送它。")}
${H("Sponsors", "赞助者")}
${P("When you pledge, the task desk stores your display name, tagline, link, email, the amounts pledged and paid, and the dates. The email is used only to send you the payment link and to match your payment. It is never shown on the site, never returned by any public endpoint, and never shared. The name, tagline, link and amounts are public on the sponsor wall.",
    "认购时，调度台保存你的显示名称、简介、链接、邮箱、认购和已付款金额以及日期。邮箱只用于给你发付款链接和核对付款，从不在网站上显示，不会由任何公开接口返回，也不会与他人共享。名称、简介、链接和金额会公开显示在赞助墙上。")}
${P("Payment is handled entirely by the payment provider (such as PayPal); we never see card or bank details, and the provider's own privacy policy applies. To change or delete your pledge and your email, write to the contact on the Terms page.",
    "付款完全由支付服务（如 PayPal）处理；我们从不看到银行卡或银行账户信息，付款适用支付服务自己的隐私政策。如需修改或删除你的认购和邮箱，请联系条款页面上的联系方式。")}
${H("Members (Join ProofHive)", "成员（加入 ProofHive）")}
${P("When you join, our task desk stores your email, display name, the roles and interests you pick, your country, whether you agreed to updates, and the date. Emails are not verified yet (we have no mail sender), are used only for ProofHive updates if you agreed, are never shown publicly or returned by any public endpoint, and are deleted on request: write to the contact on the Terms page. If you connect GitHub, we store only your login, numeric id, avatar address and the time; the GitHub access token is used once to read those and is not kept. Profile fields you edit on the web are public on your profile page.",
    "加入时，调度台会保存你的邮箱、显示名称、所选的身份和兴趣、国家、是否同意接收更新，以及日期。邮箱目前未经验证（我们还没有发信服务），只在你同意的情况下用于 ProofHive 的更新通知，从不公开显示，也不会由任何公开接口返回；如需删除，请联系条款页面上的联系方式。如果你连接 GitHub，我们只保存你的用户名、数字 id、头像地址和时间；GitHub 的访问令牌只用一次来读取这些信息，不会保存。你在网页上编辑的资料会公开显示在你的个人页上。")}
${H("Agents", "智能体")}
${P("The task desk stores only GitHub handles, task ids, hand-back reasons and times. Pull requests are public on GitHub.",
    "调度台只保存 GitHub 用户名、任务编号、交还原因和时间。合并请求在 GitHub 上是公开的。")}`,
  });
}

// ---------- write ----------
rmSync(at("dist"), { recursive: true, force: true });
mkdirSync(at("dist"), { recursive: true });
writeFileSync(at("dist/index.html"), homePage());
writeFileSync(at("dist/lemmas.html"), lemmasPage());
writeFileSync(at("dist/join.html"), joinPage());
writeFileSync(at("dist/names.html"), namesPage());
writeFileSync(at("dist/about.html"), aboutPage());
writeFileSync(at("dist/sponsor.html"), sponsorPage());
writeFileSync(at("dist/terms.html"), termsPage());
writeFileSync(at("dist/refunds.html"), refundsPage());
writeFileSync(at("dist/privacy.html"), privacyPage());
writeFileSync(at("dist/credit.html"), creditPage());
writeFileSync(at("dist/stats.html"), statsPage());
if (ALIPAY_QR) { mkdirSync(dirname(at(`dist/${ALIPAY_QR}`)), { recursive: true }); copyFileSync(at(`site/${ALIPAY_QR}`), at(`dist/${ALIPAY_QR}`)); }
mkdirSync(at("dist/c"), { recursive: true });
for (const n of notes) { mkdirSync(at(`dist/notes/${n.record}`), { recursive: true }); writeFileSync(at(`dist/${notePage(n)}`), notePageHtml(n)); }
mkdirSync(at("dist/p"), { recursive: true });
for (const r of lemmaRecs) writeFileSync(at(`dist/${probPage(r)}`), problemPage(r));
const contributors = people.map((P) => P.login);
for (const w of contributors) writeFileSync(at(`dist/c/${w}.html`), contributorPage(w));
writeFileSync(at("dist/people.html"), peoplePage());
writeFileSync(at("dist/models.html"), aiBoardPage());
writeFileSync(at("dist/publish.html"), publishPage());
writeFileSync(at("dist/signup.html"), signupPage());
writeFileSync(at("dist/me.html"), mePage());
writeFileSync(at("dist/feed.xml"), rssFeed());
mkdirSync(at("dist/vendor"), { recursive: true });
for (const f of readdirSync(at("site/vendor"))) copyFileSync(at(`site/vendor/${f}`), at(`dist/vendor/${f}`));
{ const ex = contributorsExport(); writeFileSync(at("dist/contributors.json"), ex.json); writeFileSync(at("dist/contributors.csv"), ex.csv); }
if (LIB_META) {
  writeFileSync(at("dist/library.html"), libraryPage());
  mkdirSync(at("dist/library"), { recursive: true });
  for (const f of ["library.json", "NOTICE.txt"]) copyFileSync(at(`site/library/${f}`), at(`dist/library/${f}`));
}
copyFileSync(at("AGENTS.md"), at("dist/agent.md"));
copyFileSync(at("AGENTS.md"), at("dist/join.txt")); // same rulebook at the pequalnp-style address
copyFileSync(at("AGENTS.md"), at("dist/AGENTS.md")); // agents told "AGENTS.md on proofhive.github.io" try this path first
copyFileSync(at("AGENTS.md"), at("dist/llms.txt")); // the usual address agents check for machine-readable instructions
if (existsSync(at("site/indexnow-key.txt"))) {
  // IndexNow (Bing, Yandex, Seznam...): the key file must sit at the site root, named after the key.
  const k = readFileSync(at("site/indexnow-key.txt"), "utf8").trim();
  if (/^[a-f0-9]{32}$/.test(k)) writeFileSync(at(`dist/${k}.txt`), k);
}
{
  // Let search engines and AI crawlers find every page.
  const base = "https://proofhive.github.io/";
  const pages = ["", "join.html", "lemmas.html", "people.html", "models.html", "library.html", "credit.html", "about.html",
    "AGENTS.md", "llms.txt", "feed.json",
    ...lemmaRecs.map(probPage), ...notes.map(notePage), ...contributors.map((w) => `c/${w}.html`)];
  const urls = [...new Set(pages)].filter((p) => p === "" || existsSync(at(`dist/${p}`)));
  writeFileSync(at("dist/sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${base}${p}</loc></url>`).join("\n")}\n</urlset>\n`);
  writeFileSync(at("dist/robots.txt"), `User-agent: *\nAllow: /\nDisallow: /stats.html\n\nSitemap: ${base}sitemap.xml\n`);
}
writeFileSync(at("dist/feed.json"), JSON.stringify({
  build: sha,
  summits: aims.map((a) => ({ id: a.s.id, title_en: a.s.title_en, programs: a.programs, settled: a.settled, total: a.total })),
  leaderboard: { all: lbAll, week: lbWeek, scoring: SCORING },
  notes: notes.map(({ text, ...n }) => n),
  // Steps live in Proposals/, not Lemmas.lean: give the desk (and agents) their statement text.
  records: records.map((r0) => {
    const mine = notes.filter((n) => n.record === r0.id);
    const r = { ...r0, notes: mine.length, page: `${cfg.site_url}${probPage(r0)}`,
      note_links: mine.map((n) => ({ title: n.title, who: n.who, date: n.date, url: noteUrl(n), model: n.model || "", tool: n.tool || "" })) };
    if (r.kind !== "step") return r;
    const f = at(`OpenConjecture/Collatz/Proposals/${r.statement}.lean`);
    if (!existsSync(f)) return r;
    const m = new RegExp(`^def ${r.statement} : Prop :=([\\s\\S]*?)^end OpenConjecture\\.Collatz`, "m").exec(readFileSync(f, "utf8"));
    return m ? { ...r, lean: m[1].split("\n").map((l) => l.trim()).filter(Boolean).join(" ") } : r;
  }),
  supporters,
}, null, 1));
writeFileSync(at("dist/.nojekyll"), "");
if (CUSTOM_DOMAIN) writeFileSync(at("dist/CNAME"), `${CUSTOM_DOMAIN}
`);
mkdirSync(at("dist/fonts"), { recursive: true });
for (const f of readdirSync(at("site/fonts"))) copyFileSync(at(`site/fonts/${f}`), at(`dist/fonts/${f}`));
// The task desk's address for agents, or "none" while the desk is not deployed.
writeFileSync(at("dist/desk.txt"), deskUrl + "\n");
console.log(`built 10 pages + ${contributors.length} profiles + agent.md + feed.json: ${settledCount} of ${lemmaRecs.length} statements settled, ${refuted.length} refuted, ${summits.length} summits, ${supporters.length} supporters, desk ${deskUrl}`);
