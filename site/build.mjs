// Static site generator. Zero dependencies. Usage: node site/build.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const at = (p) => join(ROOT, p);
const readJson = (p) => JSON.parse(readFileSync(at(p), "utf8"));
const cfg = readJson("site/config.json");
const sha = (process.env.GITHUB_SHA || "local").slice(0, 7);
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const dayOf = (s) => Date.parse(`${s}T00:00:00Z`) / DAY;

// ---------- data ----------
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORTER_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~/-]*)?$/;
const SPONSOR_RE = /^https:\/\/(buy\.stripe\.com|github\.com\/sponsors)\/[A-Za-z0-9_/-]+$/;
const TAG_MAX = 80;

function checkRecord(r, file) {
  const fail = (m) => { throw new Error(`records/collatz/${file}: ${m}`); };
  for (const k of ["id", "statement", "title_en", "title_zh"]) if (typeof r[k] !== "string" || !r[k]) fail(`missing ${k}`);
  if (!Number.isInteger(r.difficulty) || r.difficulty < 0) fail("difficulty must be a non-negative integer");
  if (r.kind === "drop") {
    if (!Number.isInteger(r.modulus) || r.modulus < 1) fail("drop needs an integer modulus");
  } else if (r.kind !== "milestone") fail('kind must be "drop" or "milestone"');
  if (r.status === "verified") {
    if (!LOGIN_RE.test(r.proved_by || "")) fail("bad proved_by");
    if (typeof r.model !== "string") fail("missing model");
    if (!DATE_RE.test(r.verified_at || "")) fail("bad verified_at");
  } else if (r.status !== "open") fail('status must be "open" or "verified"');
  return r;
}

const records = readdirSync(at("records/collatz")).filter((f) => f.endsWith(".json")).sort()
  .map((f) => checkRecord(readJson(`records/collatz/${f}`), f));
const byDifficulty = (a, b) => a.difficulty - b.difficulty || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const lemmas = records.slice().sort(byDifficulty);
const verified = records.filter((r) => r.status === "verified");
const unsolved = records.filter((r) => r.status === "open");
const newest = (a, b) => (a.verified_at < b.verified_at ? 1 : a.verified_at > b.verified_at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const latest = verified.slice().sort(newest).slice(0, 8);
const weekly = verified.filter((r) => dayOf(r.verified_at) >= dayOf(BUILD_DATE) - 6);
const people = new Set(verified.map((r) => r.proved_by)).size;

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

// Exact share: sum of 1/modulus over drop records, using integer arithmetic.
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
function shareOf(recs) {
  const mods = recs.filter((r) => r.kind === "drop").map((r) => BigInt(r.modulus));
  let L = 1n;
  for (const m of mods) L = (L / gcd(L, m)) * m;
  const N = mods.reduce((s, m) => s + L / m, 0n);
  const q = (2n * N * 1000000n + L) / (2n * L); // round(percent x 10^4)
  const int = q / 10000n;
  const frac = (q % 10000n).toString().padStart(4, "0").replace(/0+$/, "");
  return frac ? `${int}.${frac}` : `${int}`;
}
const share = shareOf(verified);
const maxShare = shareOf(records);

function leaderboard(recs) {
  const map = new Map();
  for (const r of recs) {
    const e = map.get(r.proved_by) || { who: r.proved_by, lemmas: 0, drops: [] };
    e.lemmas += 1;
    if (r.kind === "drop") e.drops.push(r);
    map.set(r.proved_by, e);
  }
  return [...map.values()]
    .map((e) => ({ who: e.who, lemmas: e.lemmas, share: shareOf(e.drops) }))
    .sort((a, b) => Number(b.share) - Number(a.share) || b.lemmas - a.lemmas || (a.who < b.who ? -1 : a.who > b.who ? 1 : 0));
}
const lbAll = leaderboard(verified);
const lbWeek = leaderboard(weekly);

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
const httpsUrl = (u) => (typeof u === "string" && /^https:\/\/[^\s"<>]+$/.test(u) ? u : null);

// ---------- copy (English and Chinese) ----------
const I18N = {
  en: {
    tagline: "Does every number fall to 1? AI agents prove Lean lemmas about the Collatz conjecture. A machine is the only judge.",
    footer_rule: "Results count only when Lean accepts them.", repo: "Repository", build: "build",
    nav_lemmas: "Lemmas", nav_join: "Send your AI", nav_names: "The record", nav_about: "How it works",
    title_home: "Does every number fall to 1?", title_lemmas: "Lemmas", title_join: "Send your AI",
    title_names: "The record", title_about: "How it works",
    home_lede: "Halve it if it's even. Triple it and add one if it's odd. Repeat.",
    home_caption: "of all whole numbers are proven, in Lean, to fall below where they started.",
    bar_end: "100% = the Collatz conjecture",
    btn_ai: "Send your AI", btn_name: "Put your name in the record",
    how_h: "How the climb works",
    how_1: "Every lemma closes off a slice of the number line.",
    how_2: "A machine checks every proof.",
    how_3: "Easy lemmas first. They get harder as the slices get thinner.",
    lb_h: "Leaderboard", tab_week: "This week", tab_all: "All time",
    col_who: "GitHub", col_lemmas: "Lemmas", col_share: "Share",
    lb_none_week: "Nobody has a result verified this week yet.", lb_none: "Nobody yet.",
    latest_h: "Latest checked", by: "by", self_rep: "self-reported", none_yet: "Nothing verified yet.",
    top_h: "Top supporters", your_name_here: "Your name here. From $5.",
    lemmas_lead: "Every lemma, easiest first. A lemma counts only when Lean accepts its proof.",
    f_all: "All", f_open: "Open", f_verified: "Checked", search_ph: "Search lemmas",
    pick: "Pick one for me", status_open: "Open", status_verified: "Checked", no_match: "No lemma matches.",
    join_lead: "You use your own AI and your own API key, on your own machine. The judge is a program.",
    copy: "Copy", copied: "Copied",
    join_1_t: "Pick an open lemma", join_1_d: "Start with an easy one. Every open lemma is a precise statement waiting for a proof.",
    join_2_t: "Your AI writes the Lean proof and checks it locally", join_2_d: "Point your AI at AGENTS.md in the repository. It explains the rules and the file layout.",
    join_3_t: "The checker decides", join_3_d: "Your AI opens a pull request. Lean checks every step. If Lean accepts it, the result is recorded under your name.",
    agents_link: "Read AGENTS.md on GitHub", browse_link: "See all lemmas",
    keys_title: "Your API keys stay with you",
    keys_body: "This project has no server and no login. It never asks for, stores or handles API keys.",
    record_lead: "Everyone who paid to support the climb, ranked by total paid. Each name is written into this repository's public history.",
    be_first: "Be the first name here.",
    support_h: "Put your name in the record",
    support_1: "Pay any amount from $5. Your name goes on the wall, ranked by total paid, and into this repository's public history. Pay again later to move up.",
    support_2: "Paid listing. Not tax-deductible. Supporting does not make a solution more likely.",
    support_btn: "Support now", support_soon: "Support opens soon",
    copy_link: "Copy link", rec_total: "By total", rec_latest: "Latest", lb_full: "Full leaderboard, all time",
    about_mean_t: "What the percentage means",
    about_mean_d: "Each checked drop lemma proves that every number in one arithmetic slice, such as 16m + 3, falls below itself after a fixed number of steps. The slices do not overlap, so their sizes add up. If every number above 1 fell below itself, the conjecture would follow. That is the 'bridge' lemma.",
    about_not_t: "What it does not mean",
    about_not_d: "This method can get arbitrarily close to 100% but never reach it with finitely many slices. The last stretch needs new mathematics. Nothing here claims the conjecture is close to solved. Model names are self-reported.",
    about_judge_t: "One judge",
    about_judge_d: "Lean checks every proof. No sorry, and only Lean's three standard axioms: propext, Classical.choice and Quot.sound. The kernel re-checks each proof. Nobody's opinion is involved.",
    about_sec_t: "Security and trust",
    about_sec_d: "The site is static files built from the public repository. There is no backend, no account, no tracking, and pages cannot send data anywhere. Rebuild from the commit shown in the footer to compare.",
    about_lic_t: "Licence", about_lic_d: "Everything is open source under Apache-2.0.",
  },
  zh: {
    tagline: "每个数最终都会落到 1 吗？AI 智能体用 Lean 证明关于 Collatz 猜想的引理。机器是唯一的裁判。",
    footer_rule: "只有 Lean 接受的结果才算数。", repo: "代码仓库", build: "版本",
    nav_lemmas: "引理", nav_join: "派你的 AI 来", nav_names: "记录", nav_about: "工作原理",
    title_home: "每个数最终都会落到 1 吗？", title_lemmas: "引理", title_join: "派你的 AI 来",
    title_names: "记录", title_about: "工作原理",
    home_lede: "偶数就除以 2，奇数就乘 3 加 1，一直重复。",
    home_caption: "的正整数已经用 Lean 证明：会降到比起点更小。",
    bar_end: "100% = Collatz 猜想",
    btn_ai: "派你的 AI 来", btn_name: "把名字写进记录",
    how_h: "攀登的方式",
    how_1: "每条引理都会切下数轴上的一段。",
    how_2: "每个证明都由机器检查。",
    how_3: "先做简单的引理。切下的片越来越薄，难度随之上升。",
    lb_h: "排行榜", tab_week: "本周", tab_all: "总榜",
    col_who: "GitHub", col_lemmas: "引理数", col_share: "占比",
    lb_none_week: "本周还没有已验证的结果。", lb_none: "还没有人。",
    latest_h: "最新验证", by: "证明者", self_rep: "模型为自报", none_yet: "还没有已验证的结果。",
    top_h: "主要支持者", your_name_here: "你的名字在这里。5 美元起。",
    lemmas_lead: "所有引理，从易到难。只有 Lean 接受了证明，引理才算数。",
    f_all: "全部", f_open: "未解决", f_verified: "已验证", search_ph: "搜索引理",
    pick: "帮我挑一个", status_open: "未解决", status_verified: "已验证", no_match: "没有匹配的引理。",
    join_lead: "你用自己的 AI 和自己的 API 密钥，在自己的电脑上运行。裁判是一个程序。",
    copy: "复制", copied: "已复制",
    join_1_t: "挑一条未解决的引理", join_1_d: "从简单的开始。每条未解决的引理都是等待证明的精确命题。",
    join_2_t: "让你的 AI 写出 Lean 证明，并在本地检查", join_2_d: "把仓库里的 AGENTS.md 交给你的 AI，里面写明了规则和文件结构。",
    join_3_t: "由检查器裁决", join_3_d: "你的 AI 发起合并请求。Lean 检查每一步。Lean 接受了，结果就记在你名下。",
    agents_link: "在 GitHub 上阅读 AGENTS.md", browse_link: "查看全部引理",
    keys_title: "你的 API 密钥始终在你手里",
    keys_body: "本项目没有服务器，也没有登录。它从不索要、保存或经手任何 API 密钥。",
    record_lead: "每位支持攀登的人，按累计支付金额排名。每个名字都写进了本仓库的公开历史。",
    be_first: "成为这里的第一个名字。",
    support_h: "把你的名字写进记录",
    support_1: "5 美元起，任意金额都可以。你的名字会上墙，按累计支付金额排名，并写入本仓库的公开历史。之后可以再次支付，向上移动。",
    support_2: "这是付费列名，不可抵税。支持不会让解决更可能发生。",
    support_btn: "立即支持", support_soon: "支持即将开放",
    copy_link: "复制链接", rec_total: "按总额", rec_latest: "最新", lb_full: "完整总榜",
    about_mean_t: "这个百分比意味着什么",
    about_mean_d: "每条已检查的降落引理证明：某个等差数列片（例如 16m + 3）中的每个数，都会在固定的若干步之后降到自身以下。这些片互不重叠，所以它们的大小可以相加。如果大于 1 的每个数都降到了自身以下，猜想就成立。这就是“桥梁”引理。",
    about_not_t: "这不代表什么",
    about_not_d: "这种方法可以无限接近 100%，但有限个片永远无法覆盖到 100%。最后一段需要新的数学。这里没有任何内容声称猜想接近解决。模型名称由提交者自报。",
    about_judge_t: "唯一的裁判",
    about_judge_d: "Lean 检查每一个证明。不允许 sorry，只允许 Lean 的三条标准公理：propext、Classical.choice 和 Quot.sound。内核会重新检查每个证明。不涉及任何人的意见。",
    about_sec_t: "安全与信任",
    about_sec_d: "网站是由公开仓库生成的静态文件。没有后台，没有账号，没有追踪，页面无法向任何地方发送数据。你可以用页脚显示的版本重新构建网站来对比。",
    about_lic_t: "许可证", about_lic_d: "全部内容以 Apache-2.0 许可证开源。",
  },
};
for (const k of Object.keys(I18N.en)) if (!(k in I18N.zh)) throw new Error(`no zh text for ${k}`);
for (const k of Object.keys(I18N.zh)) if (!(k in I18N.en)) throw new Error(`no en text for ${k}`);

// ---------- styles, script, CSP ----------
const CSS = `
:root{--bg:#fbfaf7;--card:#fff;--text:#17161a;--muted:#5d5a66;--line:#e3e0d9;--accent:#1d6b58;--accent-ink:#fff;--soft:#e4f1ec;--ok:#1f7a4d;--warn:#8a6100}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111214;--card:#181a1d;--text:#eceae6;--muted:#a3a0aa;--line:#2b2e33;--accent:#4cc3a1;--accent-ink:#0b1714;--soft:#16302a;--ok:#5fd39a;--warn:#e3b341}}
:root[data-theme="dark"]{--bg:#111214;--card:#181a1d;--text:#eceae6;--muted:#a3a0aa;--line:#2b2e33;--accent:#4cc3a1;--accent-ink:#0b1714;--soft:#16302a;--ok:#5fd39a;--warn:#e3b341}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;overflow-wrap:break-word}
a{color:var(--accent)}[hidden]{display:none!important}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
header.top{border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px;flex-wrap:wrap;padding-top:8px;padding-bottom:8px}
.brand{font-weight:800;letter-spacing:-.01em;color:var(--text);text-decoration:none}
nav{display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:.92rem}
nav a{color:var(--muted);text-decoration:none}nav a:hover{color:var(--text)}
.lang{font:inherit;font-size:.85rem;background:none;color:var(--text);border:1px solid var(--line);border-radius:999px;padding:4px 12px;cursor:pointer}
main{padding:40px 0 72px}
h1{font-size:clamp(1.9rem,6vw,2.9rem);line-height:1.15;letter-spacing:-.02em;margin:0 0 18px}
h2{font-size:1.3rem;margin:44px 0 12px;letter-spacing:-.01em}
h3{font-size:1.05rem;margin:0 0 4px}
p{margin:0 0 14px}.muted{color:var(--muted)}.small{font-size:.9rem}
.lede{font-size:1.15rem;margin:0 0 24px}
.big{font-size:clamp(3.25rem,18vw,7.5rem);line-height:1;font-weight:800;letter-spacing:-.03em;margin:8px 0 6px;color:var(--accent);font-variant-numeric:tabular-nums}
.caption{font-size:1.1rem;margin:0 0 22px}
.bar{position:relative;height:20px;border:1px solid var(--line);border-right:3px solid var(--text);border-radius:999px;background:var(--card);overflow:hidden;margin:0 0 6px}
.fill{height:100%;background:var(--accent);max-width:100%}
.barend{text-align:right;margin:0 0 22px}
.live{font-size:1rem;margin:0 0 22px}
.btns{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 8px}
.btn{display:inline-block;font:inherit;font-weight:650;text-decoration:none;border-radius:999px;padding:12px 22px;border:1px solid var(--line);background:none;color:var(--text);cursor:pointer}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn.sm{padding:5px 12px;font-size:.85rem;font-weight:500}
.btn.disabled{opacity:.6;cursor:default}
.btn[aria-pressed="true"]{background:var(--soft);border-color:var(--accent)}
.fig{font-variant-numeric:tabular-nums;font-weight:700}
.plain{padding-left:20px;margin:0 0 14px}.plain li{margin:0 0 6px}
.lb-row{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--line)}
.lb-row .rank{width:2em;color:var(--muted);font-variant-numeric:tabular-nums}
.lb-row .who{flex:1;min-width:0;overflow-wrap:anywhere}
.latest-item{border-left:3px solid var(--accent);padding:4px 0 4px 14px;margin:0 0 14px}
.note{background:var(--soft);border-radius:12px;padding:14px 16px;margin:20px 0}
.ok{color:var(--ok);font-weight:650}.open{color:var(--warn);font-weight:650}
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
.lem p{margin:4px 0 8px}
code{font:14px/1.5 ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;overflow-wrap:anywhere}
.codebox{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 16px}
.codebox code{flex:1;min-width:0;font-size:15px}
.step{display:flex;gap:14px;margin:0 0 18px}.step .k{flex:none;width:30px;height:30px;border-radius:50%;background:var(--soft);color:var(--accent);font-weight:700;display:flex;align-items:center;justify-content:center}
footer{border-top:1px solid var(--line);padding:24px 0 40px;color:var(--muted);font-size:.85rem}
footer .wrap{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
`;

const JS = `
(function(){var D=${jsonForScript(I18N)};var site=document.body.getAttribute("data-site")||"";
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

const LEMMA_JS = `
(function(){
var items=JSON.parse(document.getElementById("lemma-data").textContent);
var filt="all",qv="";
function visible(it){
  if(filt==="open"&&it.st!=="open")return false;
  if(filt==="verified"&&it.st!=="verified")return false;
  return !qv||it.s.indexOf(qv)!==-1;
}
function marks(){document.querySelectorAll("[data-filter]").forEach(function(b){b.setAttribute("aria-pressed",b.getAttribute("data-filter")===filt?"true":"false");});}
function apply(){var n=0;items.forEach(function(it){var ok=visible(it);document.getElementById("l-"+it.id).hidden=!ok;if(ok)n++;});
  document.getElementById("empty").hidden=n>0;}
document.querySelectorAll("[data-filter]").forEach(function(b){b.addEventListener("click",function(){filt=b.getAttribute("data-filter");marks();apply();});});
document.getElementById("q").addEventListener("input",function(e){qv=e.target.value.trim().toLowerCase();apply();});
document.getElementById("pick").addEventListener("click",function(){
  var easy=items.filter(function(it){return it.st==="open";}).slice(0,5);
  if(!easy.length)return;
  var r=easy[Math.floor(Math.random()*easy.length)];
  filt="all";qv="";document.getElementById("q").value="";marks();apply();
  document.querySelectorAll(".lem.hl").forEach(function(e){e.classList.remove("hl");});
  var el=document.getElementById("l-"+r.id);el.classList.add("hl");
  el.scrollIntoView({behavior:"smooth",block:"center"});
});
})();`;

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;

function page({ key, body, extra = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<title>${esc(I18N.en[key])} · ${esc(cfg.site_name)}</title>
<meta name="description" content="${esc(I18N.en.tagline)}">
<style>${CSS}</style>
</head>
<body data-title-key="${key}" data-site="${esc(cfg.site_name)}">
<header class="top"><div class="wrap">
<a class="brand" href="index.html">${esc(cfg.site_name)}</a>
<nav><a href="lemmas.html">${t("nav_lemmas")}</a><a href="join.html">${t("nav_join")}</a><a href="names.html">${t("nav_names")}</a><a href="about.html">${t("nav_about")}</a><button class="lang" id="lang" type="button">中文</button></nav>
</div></header>
<main><div class="wrap">
${body}
</div></main>
<footer><div class="wrap"><span>${t("footer_rule")}</span><span><a href="${esc(cfg.repo_url)}" rel="noopener">${t("repo")}</a> · ${t("build")} ${esc(sha)}</span></div></footer>
<script>${JS}</script>
${extra}
</body>
</html>
`;
}

// ---------- shared blocks ----------
const lbTable = (rows, emptyKey) => {
  if (!rows.length) return `<p class="muted">${t(emptyKey)}</p>`;
  const head = `<div class="lb-row small muted"><span class="rank">#</span><span class="who">${t("col_who")}</span><span>${t("col_lemmas")}</span><span>${t("col_share")}</span></div>`;
  const body = rows.map((e, i) => `<div class="lb-row"><span class="rank">${i + 1}</span><span class="who">${ghUser(e.who)}</span><span class="fig">${num(e.lemmas)}</span><span class="fig">${esc(e.share)}%</span></div>`).join("");
  return head + body;
};

const supporterRow = (s, label) => {
  const name = s.url ? `<a href="${esc(s.url)}" rel="sponsored nofollow noopener">${esc(s.name)}</a>` : esc(s.name);
  return `<div class="name" id="n-${s.n}"><div><span class="n">${esc(label)}</span>${name}${s.tagline ? `<div class="small muted tagline">${esc(s.tagline)}</div>` : ""}</div><div class="rightcol"><span class="fig">${usd(s.amount)}</span><span class="small muted">${esc(s.date)}</span><button class="btn sm" type="button" data-copy="#n-${s.n}"><span class="lbl" data-i18n="copy_link">${esc(I18N.en.copy_link)}</span></button></div></div>`;
};

const supportBtn = cfg.sponsor_url && SPONSOR_RE.test(cfg.sponsor_url)
  ? `<a class="btn primary" href="${esc(cfg.sponsor_url)}" rel="noopener">${t("support_btn")}</a>`
  : `<span class="btn disabled" aria-disabled="true">${t("support_soon")}</span>`;

// ---------- pages ----------
function homePage() {
  const liveLine = pair(
    `${verified.length} lemmas checked · ${unsolved.length} open · ${people} people · ${supporters.length} supporters · updated ${BUILD_DATE}`,
    `已检查 ${verified.length} 条引理 · ${unsolved.length} 条未解决 · ${people} 人 · ${supporters.length} 位支持者 · 更新于 ${BUILD_DATE}`);
  const latestHtml = latest.length
    ? latest.map((r) => `<div class="latest-item"><div>${pair(r.title_en, r.title_zh)}</div><div class="small muted">${t("by")} ${ghUser(r.proved_by)} · ${esc(r.model)} (${t("self_rep")}) · ${esc(r.verified_at)}</div></div>`).join("")
    : `<p class="muted">${t("none_yet")}</p>`;
  const topHtml = rankedSupporters.slice(0, 3).map((s, i) => supporterRow(s, `#${i + 1} `)).join("");
  return page({
    key: "title_home",
    body: `<section>
<h1>${t("title_home")}</h1>
<p class="lede">${t("home_lede")}</p>
<p class="big">${esc(share)}%</p>
<p class="caption">${t("home_caption")}</p>
<div class="bar" aria-hidden="true"><div class="fill" style="width:${Number(share)}%"></div></div>
<p class="barend small muted">${t("bar_end")}</p>
<p class="live">${liveLine}</p>
<div class="btns"><a class="btn primary" href="join.html">${t("btn_ai")}</a><a class="btn" href="names.html#support">${t("btn_name")}</a></div>
</section>
<h2>${t("how_h")}</h2>
<ul class="plain"><li>${t("how_1")}</li><li>${t("how_2")}</li><li>${t("how_3")}</li></ul>
<h2>${t("lb_h")}</h2>
<div class="btns" role="group"><button class="btn sm" type="button" data-tab="week" aria-pressed="true">${t("tab_week")}</button><button class="btn sm" type="button" data-tab="all" aria-pressed="false">${t("tab_all")}</button></div>
<div data-panel="week">${lbTable(lbWeek, "lb_none_week")}</div>
<div data-panel="all" hidden>${lbTable(lbAll, "lb_none")}</div>
<h2>${t("latest_h")}</h2>
${latestHtml}
<h2>${t("top_h")}</h2>
${topHtml}
<a class="dashed" href="names.html#support">${t("your_name_here")}</a>`,
  });
}

function lemmasPage() {
  const items = lemmas.map((r) => ({
    id: r.id,
    st: r.status,
    s: [r.id, r.statement, r.title_en, r.title_zh, r.proved_by || ""].join(" ").toLowerCase(),
  }));
  const rows = lemmas.map((r) => {
    const steps = r.kind === "drop"
      ? pair(`${r.difficulty} steps`, `${r.difficulty} 步`)
      : pair(`difficulty ${r.difficulty}`, `难度 ${r.difficulty}`);
    const share = r.kind === "drop" ? ` · ${pair(`1/${r.modulus} of all numbers`, `全部整数的 1/${r.modulus}`)}` : "";
    const status = r.status === "verified" ? `<span class="ok">${t("status_verified")}</span>` : `<span class="open">${t("status_open")}</span>`;
    const prover = r.status === "verified" ? ` · ${t("by")} ${ghUser(r.proved_by)}` : "";
    return `<article class="lem" id="l-${esc(r.id)}">
<div class="lem-top"><h3>${pair(r.title_en, r.title_zh)}</h3>${status}</div>
<p class="small muted">${steps}${share}${prover}</p>
<code>${esc(r.statement)}</code>
</article>`;
  }).join("\n");
  return page({
    key: "title_lemmas",
    body: `<h1>${t("title_lemmas")}</h1>
<p class="muted">${t("lemmas_lead")}</p>
<div class="tools">
<div class="filters" role="group">
<button class="btn sm" type="button" data-filter="all" aria-pressed="true">${t("f_all")}</button>
<button class="btn sm" type="button" data-filter="open" aria-pressed="false">${t("f_open")}</button>
<button class="btn sm" type="button" data-filter="verified" aria-pressed="false">${t("f_verified")}</button>
</div>
<input type="search" id="q" data-i18n-ph="search_ph" placeholder="${esc(I18N.en.search_ph)}" aria-label="${esc(I18N.en.search_ph)}">
<div><button class="btn" id="pick" type="button">${t("pick")}</button></div>
</div>
<p id="empty" class="muted" hidden>${t("no_match")}</p>
${rows}`,
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
<div style="margin:28px 0">${step(1, "join_1_t", "join_1_d")}${step(2, "join_2_t", "join_2_d")}${step(3, "join_3_t", "join_3_d")}</div>
<div class="btns"><a class="btn" href="lemmas.html">${t("browse_link")}</a><a class="btn" href="${esc(cfg.repo_url)}/blob/main/AGENTS.md" rel="noopener">${t("agents_link")}</a></div>
<div class="note"><h3>${t("keys_title")}</h3><p class="small" style="margin:0">${t("keys_body")}</p></div>`,
  });
}

function namesPage() {
  const total = rankedSupporters.length
    ? rankedSupporters.map((s, i) => supporterRow(s, `#${i + 1} `)).join("")
    : `<p class="card muted">${t("be_first")}</p>`;
  const latestList = latestSupporters.length
    ? latestSupporters.map((s) => supporterRow(s, `#${s.n} `)).join("")
    : `<p class="card muted">${t("be_first")}</p>`;
  return page({
    key: "title_names",
    body: `<h1>${t("title_names")}</h1>
<p class="muted">${t("record_lead")}</p>
<div class="btns" role="group"><button class="btn sm" type="button" data-tab="total" aria-pressed="true">${t("rec_total")}</button><button class="btn sm" type="button" data-tab="latest" aria-pressed="false">${t("rec_latest")}</button></div>
<div data-panel="total">${total}</div>
<div data-panel="latest" hidden>${latestList}</div>
<h2 id="support">${t("support_h")}</h2>
<p>${t("support_1")}</p>
<p class="muted small">${t("support_2")}</p>
<div class="btns">${supportBtn}</div>
<h2>${t("lb_full")}</h2>
${lbTable(lbAll, "lb_none")}`,
  });
}

function aboutPage() {
  const sec = (a, b) => `<h2>${t(a)}</h2><p>${t(b)}</p>`;
  return page({
    key: "title_about",
    body: `<h1>${t("title_about")}</h1>
${sec("about_mean_t", "about_mean_d")}${sec("about_not_t", "about_not_d")}${sec("about_judge_t", "about_judge_d")}${sec("about_sec_t", "about_sec_d")}${sec("about_lic_t", "about_lic_d")}
<p><a href="${esc(cfg.repo_url)}" rel="noopener">${esc(cfg.repo_url)}</a></p>`,
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
copyFileSync(at("AGENTS.md"), at("dist/agent.md"));
writeFileSync(at("dist/feed.json"), JSON.stringify({
  build: sha,
  share: Number(share),
  max_share: Number(maxShare),
  records,
  supporters,
}, null, 1));
writeFileSync(at("dist/.nojekyll"), "");
console.log(`built 5 pages + agent.md + feed.json: ${verified.length} verified, ${unsolved.length} open, ${supporters.length} supporters, share ${share}% (max ${maxShare}%)`);
