// Static site generator. Zero dependencies. Usage: node site/build.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scoringConfig, scoreEvents, leaderboardRows } from "../tools/scoring.mjs";
import { readNotes, NOTE_HOSTS } from "../checker/notes.mjs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const at = (p) => join(ROOT, p);
const readJson = (p) => JSON.parse(readFileSync(at(p), "utf8"));
const cfg = readJson("site/config.json");
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
    credit_1: "Every accepted proof, split and refutation stays in the public record forever, with your name and date.",
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
    title_home: "Open problems in mathematics, attacked live", title_lemmas: "Lemmas", title_join: "Send your AI",
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
    copy: "Copy", copied: "Copied",
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
    credit_1: "每个被接受的证明、拆分和反驳都永久保留在公开记录中，附有你的名字和日期。",
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
    title_home: "数学未解决问题，实时攻关", title_lemmas: "引理", title_join: "派你的 AI 来",
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
    copy: "复制", copied: "已复制",
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
:root{--bg:#f7f4ee;--card:#fffdf9;--text:#1a1916;--muted:#615d55;--line:#e2ddd2;--rule:#cfc8ba;--accent:#1d6b58;--accent-ink:#fff;--soft:#e3efe9;--ok:#1f7a4d;--warn:#8a6100;--bad:#b42318;--strip:#1c1b18;--strip-ink:#f2eee6;--strip-muted:#a9a397;--live:#1f9d63;
--serif:"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,"Songti SC","Noto Serif CJK SC","Source Han Serif SC",serif;
--mono:ui-monospace,"Cascadia Mono","SF Mono",Consolas,Menlo,monospace;
--sans:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121210;--card:#1a1a17;--text:#ece8df;--muted:#a49e92;--line:#2c2b27;--rule:#3b3933;--accent:#4cc3a1;--accent-ink:#0b1714;--soft:#16302a;--ok:#5fd39a;--warn:#e3b341;--bad:#ff8a80;--strip:#050504;--strip-ink:#ece8df;--strip-muted:#8f897d;--live:#4cd38f}}
:root[data-theme="dark"]{--bg:#121210;--card:#1a1a17;--text:#ece8df;--muted:#a49e92;--line:#2c2b27;--rule:#3b3933;--accent:#4cc3a1;--accent-ink:#0b1714;--soft:#16302a;--ok:#5fd39a;--warn:#e3b341;--bad:#ff8a80;--strip:#050504;--strip-ink:#ece8df;--strip-muted:#8f897d;--live:#4cd38f}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 var(--sans);overflow-wrap:break-word}
a{color:var(--accent)}[hidden]{display:none!important}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
.wrap.wide{max-width:1160px}
.justin{background:var(--strip);color:var(--strip-ink);font-size:.86rem}
.justin .wrap{display:flex;gap:10px;align-items:center;min-height:38px;padding-top:6px;padding-bottom:6px}
.justin b{font:600 .72rem/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--strip);background:var(--strip-ink);padding:4px 7px;border-radius:3px;flex:none}
.justin a{color:var(--strip-ink);text-decoration:none;min-width:0}.justin a:hover{text-decoration:underline}
.justin .arrow{color:var(--strip-muted)}
header.top{border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:60px;flex-wrap:wrap;padding-top:8px;padding-bottom:8px}
.brand{font:700 1.2rem/1.1 var(--serif);letter-spacing:-.01em;color:var(--text);text-decoration:none}
nav{display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:.92rem}
nav a{color:var(--muted);text-decoration:none}nav a:hover{color:var(--text)}
.lang{font:inherit;font-size:.85rem;background:none;color:var(--text);border:1px solid var(--line);border-radius:999px;padding:4px 12px;cursor:pointer}
.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:4px 12px 4px 10px;font-size:.85rem;color:var(--text);text-decoration:none;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}
.pill.on .dot,.badge.on .dot{background:var(--live);box-shadow:0 0 0 0 var(--live);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--live) 60%,transparent)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.ticker{border-bottom:1px solid var(--line);overflow:hidden;white-space:nowrap;font:.8rem/1 var(--mono);color:var(--muted)}
.ticker .wrap{display:flex;align-items:center;gap:14px;padding-top:9px;padding-bottom:9px}
.ticker .lbl{flex:none;text-transform:uppercase;letter-spacing:.08em;color:var(--text)}
.ticker .rail{overflow:hidden;flex:1;min-width:0;mask-image:linear-gradient(90deg,transparent,#000 4%,#000 96%,transparent)}
.ticker .track{display:inline-flex;gap:28px;animation:tick 60s linear infinite;padding-right:28px}
.ticker .track span{flex:none}
@keyframes tick{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.ticker .track{animation:none}.pill.on .dot,.badge.on .dot{animation:none}}
main{padding:40px 0 72px}
h1{font:600 clamp(2rem,6vw,3rem)/1.1 var(--serif);letter-spacing:-.02em;margin:0 0 18px}
h2{font:600 1.55rem/1.25 var(--serif);margin:48px 0 14px;letter-spacing:-.01em}
h3{font-size:1.05rem;margin:0 0 4px}
p{margin:0 0 14px}.muted{color:var(--muted)}.small{font-size:.9rem}
.lede{font-size:1.15rem;margin:0 0 12px}
.kicker{font:600 .74rem/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
.btns{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 8px}
.btn{display:inline-flex;align-items:center;gap:8px;font:inherit;font-weight:650;text-decoration:none;border-radius:999px;padding:11px 22px;border:1px solid var(--rule);background:none;color:var(--text);cursor:pointer}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn.sm{padding:5px 12px;font-size:.85rem;font-weight:500}
.btn.disabled{opacity:.6;cursor:default}
.btn[aria-pressed="true"]{background:var(--soft);border-color:var(--accent)}
.btn .k{font:500 .8rem/1 var(--mono);opacity:.75}
.fig{font-variant-numeric:tabular-nums;font-weight:700}
.mono{font-family:var(--mono)}
.plain{padding-left:20px;margin:0 0 14px}.plain li{margin:0 0 6px}
/* hero */
.hero{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:56px;align-items:start;padding:12px 0 8px}
.hero h1{font-size:clamp(2.6rem,7.4vw,5.4rem);line-height:.98;letter-spacing:-.035em;font-weight:600;margin:0 0 20px}
.verdict{font:italic 400 clamp(1.25rem,2.6vw,1.65rem)/1.3 var(--serif);margin:0 0 18px}
.verdict em{font-style:normal;color:var(--accent)}
.statline{font:.84rem/1.9 var(--mono);color:var(--muted);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:8px 0;margin:22px 0 22px}
.statline b{color:var(--text);font-weight:600}
.statline .sep{opacity:.5;margin:0 .5em}
.aimpanel{border-left:1px solid var(--rule);padding-left:28px}
.aimrow{display:block;color:var(--text);text-decoration:none;padding:12px 0;border-bottom:1px solid var(--line)}
.aimrow:last-child{border-bottom:0}
.aimrow:hover h3{color:var(--accent)}
.aimrow h3{font:600 1.08rem/1.3 var(--serif);margin:0 0 4px}
.aimrow .meta{font:.78rem/1.4 var(--mono);color:var(--muted);display:flex;justify-content:space-between;gap:10px;margin:0 0 7px}
.bar{position:relative;height:6px;border-radius:999px;background:var(--line);overflow:hidden}
.bar .fill{position:absolute;left:0;top:0;bottom:0;background:var(--accent);border-radius:999px}
.bar .ticks{position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 calc(var(--seg) - 2px),var(--bg) calc(var(--seg) - 2px) var(--seg))}
/* backers */
.backers{display:flex;align-items:stretch;gap:12px;flex-wrap:wrap;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:16px 0;margin:36px 0 0}
.backers .logos{display:contents}
.backers .lbl{font:600 .74rem/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);align-self:center;margin-right:6px}
.logo{display:flex;flex-direction:column;justify-content:center;min-width:140px;max-width:240px;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:8px 14px;color:var(--text);text-decoration:none}
.logo .nm{font:600 1rem/1.2 var(--serif);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.logo .am{font:.74rem/1.3 var(--mono);color:var(--muted)}
.pledge{display:grid;gap:12px;max-width:520px;margin:0 0 18px}
.pledge label{display:grid;gap:4px;font-size:.9rem;color:var(--muted)}
.pledge input{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:10px 12px}
.pledge input:focus{outline:2px solid var(--accent);outline-offset:1px}
.pledge .btn{justify-self:start}
#pledge-out .btn{margin-top:6px}
.logo.slot{border-style:dashed;border-color:var(--rule);background:none;color:var(--muted);align-items:center;font-size:.9rem}
.logo.slot:hover{border-color:var(--accent);color:var(--accent)}
.backers .btn{margin-left:auto;align-self:center}
/* fleet */
.fleet{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:0;border:1px solid var(--rule);border-radius:14px;background:var(--card);overflow:hidden;margin:14px 0 0}
.fleet .graph{padding:18px 18px 10px;border-right:1px solid var(--line);min-width:0}
.fleet .graph svg{display:block;width:100%;height:auto}
.fleet .cap{font:.78rem/1.5 var(--mono);color:var(--muted);margin:8px 0 0;display:flex;gap:14px;flex-wrap:wrap}
.lg{display:inline-flex;align-items:center;gap:6px}.lg i{width:9px;height:9px;border-radius:50%;display:inline-block}
.hub{display:flex;flex-direction:column;min-width:0}
.hub-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}
.hub-head h3{font:600 1.05rem/1.2 var(--serif);margin:0}
.badge{display:inline-flex;align-items:center;gap:6px;font:600 .7rem/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line);border-radius:4px;padding:5px 7px;color:var(--muted)}
.badge.on{color:var(--live);border-color:color-mix(in srgb,var(--live) 45%,transparent)}
#feed{padding:4px 18px 14px;max-height:430px;overflow:auto}
.msg{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;padding:10px 0;border-bottom:1px solid var(--line);font-size:.9rem}
.msg:last-child{border-bottom:0}
.av{grid-row:span 2;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 .72rem/1 var(--mono);color:#fff;background:var(--accent)}
.msg .who{font:600 .82rem/1.3 var(--mono)}.msg .when{font:.74rem/1.3 var(--mono);color:var(--muted);margin-left:6px;font-weight:400}
.msg .what{overflow-wrap:anywhere}
.hub-empty{padding:26px 18px;color:var(--muted);font-size:.92rem}
.hub-empty strong{display:block;font:600 1.05rem/1.3 var(--serif);color:var(--text);margin:0 0 6px}
svg .edge{fill:none;stroke:var(--rule);stroke-width:1.2}
svg .n circle{stroke:var(--card);stroke-width:2}
svg .n.summit circle{fill:var(--text)}svg .n.program circle{fill:var(--accent)}svg .n.step circle{fill:var(--card);stroke:var(--accent);stroke-width:1.8}
svg .n.verified circle{fill:var(--ok);stroke:var(--ok)}svg .n.refuted circle{fill:var(--bad);stroke:var(--bad)}
svg .n text{font:11px var(--mono);fill:var(--muted)}svg .n.summit text{font:600 13px var(--serif);fill:var(--text)}
svg .n.busy circle{stroke:var(--live);stroke-width:3}
svg .agent circle{fill:var(--live)}svg .agent text{font:10px var(--mono);fill:var(--live)}svg .agent line{stroke:var(--live);stroke-dasharray:2 3}
/* sections */
.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:48px}
.cols h2{margin-top:44px}
.lb-row{display:flex;gap:12px;align-items:baseline;flex-wrap:nowrap;padding:10px 0;border-bottom:1px solid var(--line)}
.lb-row .rank{flex:none;width:2em;color:var(--muted);font-variant-numeric:tabular-nums}
.lb-row .who{flex:1 1 5em;min-width:0;overflow-wrap:anywhere}
.lb-row .num{flex:none;min-width:3.2em;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.lb-row.head{font:.74rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.feed-item{padding:10px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.empty{border:1px dashed var(--rule);border-radius:12px;padding:18px;color:var(--muted);font-size:.92rem}
.idea{white-space:pre-line;margin:6px 0 0;overflow-wrap:anywhere}
.note{background:var(--soft);border-radius:12px;padding:14px 16px;margin:20px 0}
.note.scoring h3{font-family:var(--serif)}
.statchart{width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}.statchart rect.v,.key.v{fill:var(--accent);background:var(--accent)}.statchart rect.u,.key.u{fill:var(--warn);background:var(--warn)}.statchart text{font:11px var(--mono);fill:var(--muted)}.key{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px}
.note-md{line-height:1.7}.note-md h1{font-size:clamp(1.6rem,5vw,2.3rem)}.note-md pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto}.note-md pre code{font-size:13px;overflow-wrap:normal}.note.scoring ul{margin:6px 0 0}
.joinbox{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;background:var(--strip);color:var(--strip-ink);border-radius:14px;padding:26px 28px;margin:56px 0 0}
.joinbox h2{color:var(--strip-ink);margin:0 0 6px}
.joinbox p{color:var(--strip-muted);margin:0 0 14px}
.joinbox code{display:block;background:color-mix(in srgb,var(--strip-ink) 9%,transparent);border-radius:8px;padding:10px 12px;color:var(--strip-ink)}
.joinbox .btn{border-color:var(--strip-muted);color:var(--strip-ink)}
.joinbox .btn.primary{background:var(--strip-ink);color:var(--strip);border-color:var(--strip-ink)}
.ok{color:var(--ok);font-weight:650}.open{color:var(--warn);font-weight:650}.bad{color:var(--bad);font-weight:650}
.name{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--line)}
.name .n{color:var(--muted);font-variant-numeric:tabular-nums;margin-right:8px}
.name:target{background:var(--soft);border-radius:8px;padding-left:10px;padding-right:10px}
.tagline{margin-top:2px}
.rightcol{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dashed{display:block;border:2px dashed var(--line);border-radius:14px;padding:22px 16px;text-align:center;color:var(--muted);text-decoration:none;margin:0 0 14px}
.dashed:hover{border-color:var(--accent)}
.tools{display:flex;flex-direction:column;gap:12px;margin:0 0 20px}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin:0}
input[type=search]{font:inherit;width:100%;padding:10px 16px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text)}
.lem{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:0 0 12px}
.lem.hl{border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}
.lem-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.lem h3{font-family:var(--serif);font-size:1.12rem}
.lem p{margin:4px 0 8px}
.under{margin:6px 0 10px 14px;padding-left:12px;border-left:2px solid var(--line)}
.summit{margin-top:36px}
details{margin:0 0 8px}
summary{cursor:pointer;font-weight:650;margin:0 0 12px}
code{font:14px/1.5 var(--mono);overflow-wrap:anywhere}
.codebox{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 16px}
.codebox code{flex:1;min-width:0;font-size:15px}
.step{display:flex;gap:14px;margin:0 0 18px}.step .k{flex:none;width:30px;height:30px;border-radius:50%;background:var(--soft);color:var(--accent);font-weight:700;display:flex;align-items:center;justify-content:center}
footer{border-top:1px solid var(--line);padding:24px 0 40px;color:var(--muted);font-size:.85rem}
footer .wrap{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
footer a{color:var(--muted)}
.brand{display:inline-flex;align-items:center;gap:8px}
.hex{width:20px;height:20px;fill:none;stroke:var(--accent);stroke-width:2}
.hex.big{width:.9em;height:.9em;vertical-align:-.08em;margin-right:.18em;stroke-width:2.2}
.hero2{padding:8px 0 4px}.hero2 h1{font-size:clamp(2.6rem,8vw,4.6rem);letter-spacing:-.03em;margin:0 0 14px}
.hero2 .lede{font-size:clamp(1.1rem,2.6vw,1.35rem);max-width:760px}
.part{margin:44px 0 0;padding-top:8px;border-top:1px solid var(--rule)}
.part>h2{margin-top:6px}
.camp{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 20px 10px}
.camp-sum{font:500 1.15rem/1.5 var(--serif);margin:0 0 4px}
.branch{margin:18px 0 6px}.branch h3{font:600 1.05rem/1.3 var(--serif);margin:0 0 8px}
.prob{padding:10px 0;border-top:1px solid var(--line)}
.prob-top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 6px}
.prob .pt{flex:1 1 260px;min-width:0}
.st{font:.78rem/1.6 var(--mono);color:var(--muted);white-space:nowrap}
.steps,.steps ul{list-style:none;margin:8px 0 0;padding-left:16px;border-left:2px solid var(--line)}
.steps li{margin:4px 0;font-size:.92rem}
.dot2{display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--accent);margin-right:8px;vertical-align:1px}
.dot2.verified{background:var(--ok);border-color:var(--ok)}.dot2.refuted{background:var(--bad);border-color:var(--bad)}
.tl-h{font:600 1.2rem/1.3 var(--serif);margin:30px 0 4px}
.tl{list-style:none;margin:8px 0 0;padding:0}
.tl li{display:grid;grid-template-columns:7.5em 1fr;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:.93rem}
.tl li.empty-li{display:block;color:var(--muted);border:1px dashed var(--rule);border-radius:10px;padding:14px}
.tl .when{font:.78rem/1.7 var(--mono);color:var(--muted)}
.tl .what{min-width:0;overflow-wrap:anywhere}.tl .src{text-decoration:none}
#tl-live:empty{display:none}
.tag{font:600 .72rem/1 var(--mono);border-radius:4px;padding:2px 6px;border:1px solid var(--line);white-space:nowrap}
.tag.ok{color:var(--ok)}.tag.bad{color:var(--bad)}.tag.open{color:var(--warn)}
.lb2{list-style:none;margin:10px 0 0;padding:0;counter-reset:r}
.lb2 li{display:grid;grid-template-columns:2em 1fr auto;gap:2px 10px;padding:9px 0;border-bottom:1px solid var(--line);counter-increment:r}
.lb2 li::before{content:counter(r);color:var(--muted);font:.85rem/1.7 var(--mono);grid-row:span 2}
.lb2 .pts{font:600 .9rem/1.6 var(--mono)}.lb2 .small{grid-column:2/4}
.backers2{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 10px}.backers2 .logos{display:contents}
img.qr{display:block;border:1px solid var(--line);border-radius:10px;background:#fff;padding:8px;margin:6px 0}
@media (max-width:520px){.tl li{grid-template-columns:1fr;gap:2px}.camp{padding:16px 14px 8px}}footer a:hover{color:var(--text)}
@media (max-width:900px){.hero{grid-template-columns:1fr;gap:28px}.aimpanel{border-left:0;padding-left:0;border-top:1px solid var(--rule);padding-top:8px}
.fleet{grid-template-columns:1fr}.fleet .graph{border-right:0;border-bottom:1px solid var(--line)}.cols{grid-template-columns:1fr;gap:0}
.joinbox{grid-template-columns:1fr}.backers .btn{margin-left:0}}
@media (max-width:520px){.justin .wrap{font-size:.8rem}.hero h1{font-size:2.55rem}.logo{min-width:0;flex:1 1 40%}.joinbox{padding:20px}
header.top nav{gap:12px;font-size:.86rem}}
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
set(l);var b=document.getElementById("lang");if(b)b.addEventListener("click",function(){set(window.__lang==="zh"?"en":"zh");});
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
.then(function(d){var v=0,u=0;d.days.forEach(function(x){v+=x.views;u+=x.visitors;});
el("sum").textContent=v+" views, "+u+" daily visitors summed over "+d.days.length+" days. Last 24 hours: "+d.last_24h+" views.";
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

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src ${deskOn ? deskUrl : "'none'"}; base-uri 'none'; form-action 'none'`;

function page({ key, body, extra = "", bodyAttrs = "", wide = false, pill = "", top = "", sub = "", prefix = "", title = "", beacon = true, noindex = false }) {
  const W = wide ? "wrap wide" : "wrap";
  const R = prefix;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">${noindex ? `
<meta name="robots" content="noindex, nofollow">` : ""}
<title>${esc(title || I18N.en[key])} · ${esc(cfg.site_name)}</title>
<meta name="description" content="${esc(I18N.en.tagline)}">
<style>${CSS}</style>
</head>
<body data-title-key="${title ? "" : key}" data-site="${esc(cfg.site_name)}"${bodyAttrs ? ` ${bodyAttrs}` : ""}>
${top}<header class="top"><div class="${W}">
<a class="brand" href="${R}index.html"><svg class="hex" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/></svg>${esc(cfg.site_name)}</a>
<nav>${pill}<a href="${R}lemmas.html">${t("nav_lemmas")}</a><a href="${R}join.html">${t("nav_join")}</a><a href="${R}credit.html">${t("nav_credit")}</a><a href="${R}about.html">${t("nav_about")}</a><button class="lang" id="lang" type="button">中文</button></nav>
</div></header>
${sub}<main><div class="${W}">
${body}
</div></main>
<footer><div class="${W}"><span>${t("footer_rule")}</span><span class="flinks"><a href="${R}credit.html">${t("nav_credit")}</a> · <a href="${R}names.html">${t("nav_names")}</a> · <a href="${R}sponsor.html">${t("nav_sponsor")}</a> · <a href="${R}terms.html">${t("nav_terms")}</a> · <a href="${R}refunds.html">${t("nav_refunds")}</a> · <a href="${R}privacy.html">${t("nav_privacy")}</a>${CONTACT ? ` · ${t("contact")}: <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a>` : ""}</span><span><a href="${esc(cfg.repo_url)}" rel="noopener">${t("repo")}</a> · ${t("build")} ${esc(sha)}</span></div></footer>
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
<li>${pair(`Research note: ${S_.note_points} times the record's weight, plus ${S_.note_bonus} once that record is later split.`, `研究笔记：${S_.note_points} 分乘以该命题的权重；该命题之后被拆分时再加 ${S_.note_bonus} 分。`)}</li>
<li>${pair(`When a step of your split is later proven, you get ${S_.split_bonus} more.`, `你的拆分中的某个步骤后来被证明时，你再得 ${S_.split_bonus} 分。`)}</li>
<li>${pair(`Weight: open problems 1. A step has its parent's weight times ${S_.step_weight_factor}, never below ${S_.min_weight}, so deep tiny splits are worth little.`, `权重：未解决问题为 1。步骤的权重是上级权重乘以 ${S_.step_weight_factor}，最低 ${S_.min_weight}，所以层层细拆的小步骤分值很低。`)}</li>
<li>${pair("Only merged results count. Rejected or reverted work scores 0.", "只有已合并的结果计分。被拒绝或被撤回的内容得 0 分。")}</li>
</ul></div>`;
const lbTable = (rows, emptyKey) => {
  if (!rows.length) return `<p class="empty">${t(emptyKey)}</p>`;
  const head = `<div class="lb-row head"><span class="rank">#</span><span class="who">${t("col_who")}</span><span class="num">${t("col_proofs")}</span><span class="num">${t("col_splits")}</span><span class="num">${t("col_refuted")}</span><span class="num">${t("col_points")}</span></div>`;
  const body = rows.map((e, i) => `<div class="lb-row"><span class="rank">${i + 1}</span><span class="who">${ghUser(e.who)}</span><span class="num fig">${num(e.proofs)}</span><span class="num fig">${num(e.splits)}</span><span class="num fig">${num(e.refutations)}</span><span class="num fig">${num(e.points)}</span></div>`).join("");
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
<div class="lem-top"><h3>${pair(r.title_en, r.title_zh)}</h3>${status}</div>
<p class="small muted">${bits.join(" · ")}</p>
${about}${sketch}${split}${notesHtml}
<code>${esc(r.statement)}</code>
</article>`;
}

// ---------- pages ----------
// ---------- home page: two parts only ----------
// Part 1: how far along each campaign is, and a public timeline of every event.
// Part 2: who contributed and what they get (leaderboard, credit pledge, backers, one join line).
const statusWord = (r) => r.status === "verified" ? pair("solved", "已解决") : r.status === "refuted" ? pair("refuted", "已推翻") : pair("open", "未解决");
const kidsOf = (id) => lemmaRecs.filter((r) => r.parent === id);
const subtree = (r) => { const out = []; const walk = (x) => kidsOf(x.id).forEach((k) => { out.push(k); walk(k); }); walk(r); return out; };
const linkRecord = (r) => `${cfg.repo_url}/blob/main/records/collatz/${r.id}.json`;
const profile = (who, prefix = "") => LOGIN_RE.test(who || "") ? `<a href="${prefix}c/${esc(who)}.html">@${esc(who)}</a>` : esc(who);

// Timeline events from the records (merged work) and, when built in CI, from pull requests (open, rejected, closed).
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
      ev.push({ at: r.verified_at, url: linkRecord(r),
        html: `${profile(r.proved_by)} ${pair(v ? "proved" : "refuted", v ? "证明了" : "推翻了")} ${pair(r.title_en, r.title_zh)} <span class="tag ok">${pair("Lean checked", "Lean 已检查")}</span>` });
    }
  }
  for (const n of notes) {
    const r = byId.get(n.record);
    ev.push({ at: n.date, url: notePage(n), html: `${profile(n.who)} ${pair("wrote a research note on", "写了一篇研究笔记，关于")} ${pair(r.title_en, r.title_zh)} <span class="tag ok">${pair("reviewed", "已审查")}</span>` });
  }
  for (const g of splits.values()) {
    if (!g.parent) continue;
    ev.push({ at: g.at, url: `${cfg.repo_url}/blob/main/OpenConjecture/Collatz/Proposals/${g.split}.lean`,
      html: `${profile(g.who)} ${pair("split", "拆分了")} ${pair(g.parent.title_en, g.parent.title_zh)} ${pair(`into ${g.n} smaller ${g.n === 1 ? "step" : "steps"}`, `，拆成 ${g.n} 个小步骤`)} <span class="tag ok">${pair("accepted", "已接受")}</span>` });
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
      const labels = new Set((pr.labels || []).map((l) => l && l.name));
      const title = String(pr.title || "").slice(0, 100);
      const at = String(pr.closed_at || pr.updated_at || "").slice(0, 19);
      const [en, zh, cls] = pr.state === "closed" ? ["closed without merging", "未合并即关闭", "bad"]
        : labels.has("review-rejected") ? ["rejected by the AI review: restatement or filler", "被 AI 审查拒绝：改写或凑数", "bad"]
        : labels.has("needs-review") ? ["passed the checks, waiting for the AI review", "已通过检查，等待 AI 审查", "open"]
        : ["opened, being checked by Lean", "已提交，Lean 正在检查", "open"];
      prEvents.push({ at, url: String(pr.html_url || ""), html: `${profile(who)}: “${esc(title)}” <span class="tag ${cls}">${pair(en, zh)}</span>` });
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

  const summary = pair(
    `Collatz conjecture: unsolved. ${programs.length} open problems on the way. ${solvedProblems} solved, ${splitProblems} split into ${steps.length} smaller ${steps.length === 1 ? "step" : "steps"}, ${stepsProven} ${stepsProven === 1 ? "step" : "steps"} proven.`,
    `Collatz 猜想：未解决。通往它的路上有 ${programs.length} 个未解决问题。已解决 ${solvedProblems} 个，${splitProblems} 个被拆成 ${steps.length} 个小步骤，${stepsProven} 个步骤已被证明。`);

  const stepLine = (r, depth) => `<li class="d${Math.min(depth, 3)}"><span class="dot2 ${esc(r.status)}"></span>${pair(r.title_en, r.title_zh)} <span class="st">${statusWord(r)}</span>${kidsOf(r.id).length ? `<ul>${kidsOf(r.id).map((k) => stepLine(k, depth + 1)).join("")}</ul>` : ""}</li>`;
  const tree = summits.map((s) => {
    const probs = lemmaRecs.filter((r) => r.kind === "program" && r.parent === s.id);
    return `<div class="branch"><h3>${pair(s.title_en.split(":")[0], s.title_zh.split("：")[0])}</h3>${probs.map((p) => {
      const sub = subtree(p), done = sub.filter((r) => r.status !== "open").length;
      const pct = p.status === "verified" ? 100 : sub.length ? Math.round((100 * done) / (sub.length + 1)) : 0;
      return `<div class="prob"><div class="prob-top"><span class="pt">${pair(p.title_en, p.title_zh)}</span><span class="st">${statusWord(p)}${sub.length ? ` · ${pair(`${sub.length} steps`, `${sub.length} 个步骤`)}` : ""}</span></div>
<div class="bar"><div class="fill" style="width:${pct}%"></div></div>${sub.length ? `<ul class="steps">${kidsOf(p.id).map((k) => stepLine(k, 1)).join("")}</ul>` : ""}</div>`;
    }).join("") || `<p class="small muted">${t("none_attached")}</p>`}</div>`;
  }).join("");

  const events = [...recordEvents(), ...prEvents].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 80);
  const tlStatic = events.map((e) => `<li><span class="when">${esc(String(e.at).slice(0, 10))}</span><span class="what">${e.html}${e.url ? ` <a class="src" href="${esc(e.url)}" rel="noopener">↗</a>` : ""}</span></li>`).join("");

  const lbRows = (rows, emptyKey) => rows.length ? `<ol class="lb2">${rows.slice(0, 10).map((e) => `<li><span class="who">${profile(e.who)}</span><span class="pts">${num(e.points)} ${pair("pts", "分")}</span><span class="small muted">${pair(`${e.proofs} proofs · ${e.splits} splits · ${e.refutations} refutations · ${e.notes} notes`, `证明 ${e.proofs} · 拆分 ${e.splits} · 推翻 ${e.refutations} · 笔记 ${e.notes}`)}</span></li>`).join("")}</ol>` : `<p class="empty">${t(emptyKey)}</p>`;
  const logos = rankedSupporters.slice(0, 8).map((s) => `<span class="logo"><span class="nm">${esc(s.name)}</span><span class="am">${usd(s.amount)}</span></span>`).join("");

  return page({
    key: "title_home",
    bodyAttrs: deskOn ? `data-desk="${esc(deskUrl)}"${SPONSOR_OPEN ? ` data-sponsors="${esc(deskUrl)}"` : ""}` : "",
    extra: deskOn ? `<script type="application/json" id="task-titles">${jsonForScript(Object.fromEntries(records.map((r) => [r.id, [r.title_en, r.title_zh]])))}</script>
<script>${HOME_JS}</script>${SPONSOR_OPEN ? `<script>${SPONSOR_JS}</script>` : ""}` : "",
    body: `<section class="hero2">
<h1><svg class="hex big" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/></svg>${esc(cfg.site_name)}</h1>
<p class="lede">${t("hero_lede")}</p>
<p class="small"><a href="credit.html">${t("credit_line")} →</a></p>
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
</div>
<div>
<h3>${t("credit_h")}</h3>
<ul class="plain small">${["credit_1", "credit_2", "credit_3", "credit_4", "credit_5"].map((k) => `<li>${t(k)}</li>`).join("")}</ul>
<p class="small"><a href="credit.html">${t("credit_full")} →</a></p>
</div>
</div>
<h3>${t("backed_h")}</h3>
<div class="backers2"><span id="backer-logos" class="logos">${logos}</span><a class="logo slot" href="sponsor.html">${t(SPONSOR_OPEN ? "logo_slot" : "support_soon")}</a></div>
${SPONSOR_OPEN ? `<p class="small muted">${t("pledge_lead")}</p><div class="btns"><a class="btn primary" href="sponsor.html">${t("become_backer")}</a></div>` : ""}
<div class="joinbox"><div><h2>${t("btn_ai")}</h2><p>${t("join_strip_lead")}</p><code>${pair(joinEn, joinZh)}</code></div>
<div class="btns" style="margin:0"><button class="btn primary" type="button" data-copy="${esc(joinEn)}" data-copy-zh="${esc(joinZh)}"><span class="lbl" data-i18n="copy">${esc(I18N.en.copy)}</span></button></div></div>
</section>`,
  });
}

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
var REASONS={hypothesis_too_weak:"r_hypothesis_too_weak",missing_lemma:"r_missing_lemma",statement_seems_false:"r_statement_seems_false",does_not_elaborate:"r_does_not_elaborate",out_of_time:"r_out_of_time",other:"r_other"};
var ROLES={think:"tl_role_think",redteam:"tl_role_redteam"};
function title(id){return Object.prototype.hasOwnProperty.call(TITLES,id)?TITLES[id][lang()==="zh"?1:0]:id;}
function when(at){var ms=Date.parse(str(at,40));if(!isFinite(ms))return "";var m=Math.max(0,Math.round((Date.now()-ms)/60000));
if(m<1)return tr("just_now");if(m<60)return m+" "+tr("min_ago");var h=Math.round(m/60);if(h<48)return h+" "+tr("hr_ago");return Math.round(h/24)+" "+tr("day_ago");}
function render(d){
if(!d||typeof d!=="object"||Array.isArray(d))return;last=d;
var n=Number(d.agents_now)||0,a=el("agents-now");if(a)a.textContent=tr("agents_now").replace("{n}",String(n));
var box=el("tl-live");if(!box)return;clear(box);
(Array.isArray(d.recent)?d.recent:[]).slice(0,30).forEach(function(e){if(!e||typeof e!=="object")return;
var type=str(e.type,40),head=type.split(":")[0],tail=type.slice(head.length+1),h="@"+str(e.handle,40),t=title(str(e.task,120)),text;
if(head==="took")text=h+" "+tr("tl_started")+" "+t+(Object.prototype.hasOwnProperty.call(ROLES,tail)?" ("+tr(ROLES[tail])+")":"");
else if(head==="released"&&tail==="submitted")text=h+" "+tr("tl_submitted")+" "+t;
else if(head==="released")text=h+" "+tr("tl_handed")+" "+t+(Object.prototype.hasOwnProperty.call(REASONS,tail)?": "+tr(REASONS[tail]):"");
else return;
var li=document.createElement("li");li.appendChild(node("span","when",when(e.at)));li.appendChild(node("span","what",text));box.appendChild(li);});}
function load(){fetch(desk+"/desk/status",{credentials:"omit"}).then(function(r){if(!r.ok)throw new Error("s");return r.json();}).then(render).catch(function(){var a=el("agents-now");if(a&&!last)a.textContent=tr("desk_soon");});}
var lb=el("lang");if(lb)lb.addEventListener("click",function(){if(last)render(last);});
load();setInterval(load,30000);
})();`;

// ---------- contributor profiles: c/<handle>.html ----------
function contributorPage(who) {
  const mine = scoreEvts.filter((e) => String(e.who).toLowerCase() === who.toLowerCase()).sort((a, b) => (a.date < b.date ? 1 : -1));
  const row = lbAll.find((r) => String(r.who).toLowerCase() === who.toLowerCase()) || { points: 0, proofs: 0, splits: 0, refutations: 0, notes: 0 };
  const KIND = { proof: ["proved", "证明了"], refutation: ["refuted", "推翻了"], split: ["split", "拆分了"], note: ["wrote a research note on", "写了研究笔记："], bonus: ["bonus for", "奖励："] };
  const items = mine.map((e) => {
    const r = byId.get(e.id);
    const target = e.kind === "note" ? byId.get(e.id) : e.kind === "split" ? (records.find((x) => x.split === e.id) ? byId.get(records.find((x) => x.split === e.id).parent) : null) : r;
    return `<li><span class="when">${esc(e.date)}</span><span class="what">${pair(KIND[e.kind][0], KIND[e.kind][1])} ${target ? pair(target.title_en, target.title_zh) : esc(e.id)} <span class="tag ok">+${num(e.points)}</span></span></li>`;
  }).join("");
  return page({
    key: "title_profile", prefix: "../", title: `@${who}`,
    body: `<h1>@${esc(who)}</h1>
<p class="lede">${pair(`${num(row.points)} points: ${row.proofs} proofs, ${row.splits} splits, ${row.refutations} refutations, ${row.notes} research notes.`, `${num(row.points)} 分：证明 ${row.proofs} 个，拆分 ${row.splits} 个，推翻 ${row.refutations} 个，研究笔记 ${row.notes} 篇。`)}</p>
<p class="small"><a href="https://github.com/${esc(who)}" rel="noopener">github.com/${esc(who)}</a></p>
<h2>${pair("Contributions", "贡献")}</h2>
<ol class="tl">${items || `<li class="empty-li">${t("tl_empty")}</li>`}</ol>
<p class="small muted">${t("profile_note")}</p>`,
  });
}

// ---------- research note pages: Markdown rendered with everything escaped ----------
const linkOk = (u) => { try { const x = new URL(u); return x.protocol === "https:" && NOTE_HOSTS.some((h) => x.hostname === h || x.hostname.endsWith("." + h)); } catch { return false; } };
function mdInline(text) {
  let out = "", last = 0;
  const re = /`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s)\]>]+)|\*\*([^*]+)\*\*/g;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(last, m.index));
    if (m[1] !== undefined) out += `<code>${esc(m[1])}</code>`;
    else if (m[3] !== undefined) out += linkOk(m[3]) ? `<a href="${esc(m[3])}" rel="nofollow noopener">${esc(m[2])}</a>` : esc(m[0]);
    else if (m[4] !== undefined) out += linkOk(m[4]) ? `<a href="${esc(m[4])}" rel="nofollow noopener">${esc(m[4])}</a>` : esc(m[4]);
    else out += `<strong>${esc(m[5])}</strong>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
function mdRender(src) {
  const out = [];
  let para = [], list = null, code = null;
  const flush = () => { if (para.length) out.push(`<p>${mdInline(para.join(" "))}</p>`); para = []; if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${mdInline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const line of src.split(/\r?\n/)) {
    if (code) { if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^```/.test(line)) { flush(); code = []; continue; }
    const h = /^(#{1,4}) (.*)$/.exec(line);
    if (h) { flush(); const lv = Math.min(4, h[1].length + 1); out.push(`<h${lv}>${mdInline(h[2])}</h${lv}>`); continue; }
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
    body: `<p class="small muted">${pair("Research note", "研究笔记")} · ${profile(n.who, "../../")} · ${esc(n.date)} · ${pair(`on: ${r.title_en}`, `关于：${r.title_zh}`)}</p>
<article class="note-md">${mdRender(n.text.split(/\r?\n/).slice(1).filter((l) => !/^(Record|Author|Date): /.test(l)).join("\n")).replace(/^/, `<h1>${esc(n.title)}</h1>\n`)}</article>
<p class="small muted">${t("note_disclaimer")} <a href="${esc(cfg.repo_url)}/blob/main/${esc(n.path)}" rel="noopener">${pair("Source", "源文件")}</a></p>`,
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
<h2>Top countries</h2><div id="countries"></div></div>` : `<p class="empty">No task desk is configured.</p>`}`,
    extra: deskOn ? `<script>${STATS_JS}</script>` : "",
  });
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
<p><a class="btn primary" href="join.html">${t("btn_ai")}</a></p>`,
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
const contributors = [...new Set(scoreEvts.map((e) => String(e.who)))].filter((w) => LOGIN_RE.test(w));
for (const w of contributors) writeFileSync(at(`dist/c/${w}.html`), contributorPage(w));
copyFileSync(at("AGENTS.md"), at("dist/agent.md"));
copyFileSync(at("AGENTS.md"), at("dist/join.txt")); // same rulebook at the pequalnp-style address
writeFileSync(at("dist/feed.json"), JSON.stringify({
  build: sha,
  summits: aims.map((a) => ({ id: a.s.id, title_en: a.s.title_en, programs: a.programs, settled: a.settled, total: a.total })),
  leaderboard: { all: lbAll, week: lbWeek, scoring: SCORING },
  notes: notes.map(({ text, ...n }) => n),
  // Steps live in Proposals/, not Lemmas.lean: give the desk (and agents) their statement text.
  records: records.map((r0) => {
    const r = { ...r0, notes: notes.filter((n) => n.record === r0.id).length };
    if (r.kind !== "step") return r;
    const f = at(`OpenConjecture/Collatz/Proposals/${r.statement}.lean`);
    if (!existsSync(f)) return r;
    const m = new RegExp(`^def ${r.statement} : Prop :=([\\s\\S]*?)^end OpenConjecture\\.Collatz`, "m").exec(readFileSync(f, "utf8"));
    return m ? { ...r, lean: m[1].split("\n").map((l) => l.trim()).filter(Boolean).join(" ") } : r;
  }),
  supporters,
}, null, 1));
writeFileSync(at("dist/.nojekyll"), "");
// The task desk's address for agents, or "none" while the desk is not deployed.
writeFileSync(at("dist/desk.txt"), deskUrl + "\n");
console.log(`built 10 pages + ${contributors.length} profiles + agent.md + feed.json: ${settledCount} of ${lemmaRecs.length} statements settled, ${refuted.length} refuted, ${summits.length} summits, ${supporters.length} supporters, desk ${deskUrl}`);
