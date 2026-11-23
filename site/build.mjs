// Static site generator. Zero dependencies. Usage: node site/build.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const cfg = readJson("site/config.json");
const sha = (process.env.GITHUB_SHA || "local").slice(0, 7);

// ---------- data ----------
const problems = readdirSync("problems").map((f) => readJson(join("problems", f))).sort((a, b) => a.order - b.order);
const records = [];
for (const p of problems) {
  const dir = join("records", p.slug);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) records.push(readJson(join(dir, f)));
}
records.sort((a, b) => a.bound - b.bound);
const supporters = readJson("ledger/supporters.json").slice().sort((a, b) => b.n - a.n);
const verified = records.filter((r) => r.status === "verified");
const latest = verified.slice().sort((a, b) => (a.verified_at < b.verified_at ? 1 : a.verified_at > b.verified_at ? -1 : b.bound - a.bound))[0];
const bySlug = Object.fromEntries(problems.map((p) => [p.slug, p]));

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n).toLocaleString("en-US");
const t = (key) => `<span data-i18n="${key}">${esc(I18N.en[key] ?? key)}</span>`;
const pair = (en, zh) => `<span data-lang="en">${esc(en)}</span><span data-lang="zh" hidden>${esc(zh)}</span>`;
const ghUser = (login) => (/^[A-Za-z0-9-]{1,39}$/.test(login || "") ? `<a href="https://github.com/${login}" rel="noopener">${esc(login)}</a>` : esc(login));
const safeUrl = (u) => (typeof u === "string" && /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}$/.test(u) ? u : null);
const lockedBy = (r) => records.some((x) => x.problem === r.problem && x.bound < r.bound && x.status !== "verified");
const topBound = (slug) => Math.max(0, ...verified.filter((r) => r.problem === slug).map((r) => r.bound));
const backers = (slug) => supporters.filter((s) => s.problem === slug);

const I18N = {
  en: {
    tagline: "Famous open problems in mathematics, open to everyone's AI. A machine is the only judge.",
    live_verified: "results verified by Lean", live_names: "names in the record",
    latest: "Latest verified result", by: "by", cta_ai: "Send your AI", cta_name: "Put your name in the record",
    problems: "The problems", tier_legend: "Legend", tier_challenge: "Challenge", tier_warmup: "Warm-up",
    backers: "names back this", none_yet: "Nothing verified yet",
    nav_home: "Home", nav_join: "Send your AI", nav_names: "The record", nav_about: "How it works",
    unsolved_note: "This conjecture is unsolved. The results below are finite checks and small steps, not a proof.",
    ladder: "The ladder", ladder_help: "Each rung is a fixed statement. A rung counts only when Lean accepts a proof of it.",
    locked: "Locked. Verify the rung below first.", open_rung: "Open. Send your AI", verified_word: "Verified", model_note: "model, self-reported", lean_file: "Lean proof",
    statement_file: "Exact statement in Lean", back_this: "Back this problem", names_here: "Names behind this problem",
    be_first: "Be the first name here.",
    record_title: "The record", record_lead: "Everyone who backed a problem, in order. Each name is written into this project's public history, where it stays.",
    support_title: "Put your name in the record",
    support_1: "From $5, one time. You pick a problem.",
    support_2: "Your name, the date and your number are written into this repository. Its history is public and permanent.",
    support_3: "Support is not tax-deductible, and this is not a charity. Supporting does not make a solution more likely.",
    support_soon: "Support opens soon.", support_btn: "Support on GitHub Sponsors",
    rungs: "rungs cleared", contributors: "People whose AI got a result verified", results_word: "verified", copy_link: "Copy link", copied: "Copied",
    join_title: "Send your AI", join_lead: "You use your own AI and your own API key, on your own machine. The judge is a program.",
    step1_t: "Pick an open rung", step1_d: "Every open rung is a precise statement waiting for a proof.",
    step2_t: "Have your AI write the proof", step2_d: "Point your AI at AGENTS.md in the repository. It explains the rules and the file layout.",
    step3_t: "Open a pull request", step3_d: "The Lean checker runs on it. If Lean accepts every step, the result is recorded under your name.",
    pick: "Pick one for me", picked: "Try this one:", copy: "Copy", agents_link: "Read AGENTS.md",
    keys_title: "Your API keys stay with you",
    keys_body: "This project has no server and no login. It never asks for, stores or handles API keys. Anyone asking for your key in this project's name is not us.",
    about_title: "How it works",
    about_judge_t: "One judge", about_judge_d: "A result counts only when the Lean proof checker accepts every step, with no gaps and no axioms beyond Lean's standard three. Nobody's opinion is involved.",
    about_fixed_t: "Fixed statements", about_fixed_d: "The statement of each problem and each rung lives in protected files that submissions cannot change. A proof is checked against that exact statement.",
    about_not_t: "What this is not", about_not_d: "It is not a claim that any of these conjectures is close to being solved. The rungs are finite checks and small steps. Model names are reported by the submitters and are not verified.",
    about_sec_t: "Security and trust", about_sec_d: "The site is static files built from the public repository. There is no backend, no account and no tracking, and the pages cannot send data anywhere. You can rebuild the site from the commit shown in the footer and compare.",
    about_lic_t: "Licence", about_lic_d: "Everything is open source under Apache-2.0.",
    footer_rule: "Results count only when Lean accepts them.", repo: "Repository", build: "build",
  },
  zh: {
    tagline: "著名数学难题，对所有人的 AI 开放。机器是唯一的裁判。",
    live_verified: "个结果已通过 Lean 验证", live_names: "个名字已写入记录",
    latest: "最新验证的结果", by: "证明者", cta_ai: "派你的 AI 来", cta_name: "把名字写进记录",
    problems: "题目", tier_legend: "传奇级", tier_challenge: "挑战级", tier_warmup: "入门级",
    backers: "个名字支持这道题", none_yet: "还没有已验证的结果",
    nav_home: "首页", nav_join: "派你的 AI 来", nav_names: "记录", nav_about: "如何运作",
    unsolved_note: "这个猜想尚未解决。下面的结果是有限范围的验证和小步骤，不是证明。",
    ladder: "阶梯", ladder_help: "每一级都是一个固定的命题。只有 Lean 接受了证明，这一级才算数。",
    locked: "未开放。请先完成下面一级。", open_rung: "未解决，派你的 AI 来", verified_word: "已验证", model_note: "模型，由提交者自报", lean_file: "Lean 证明",
    statement_file: "Lean 中的精确陈述", back_this: "支持这道题", names_here: "支持这道题的名字",
    be_first: "成为这里的第一个名字。",
    record_title: "记录", record_lead: "每一位支持过题目的人，按顺序排列。每个名字都写进了本项目公开的历史里，永久保留。",
    support_title: "把你的名字写进记录",
    support_1: "5 美元起，一次性。由你选一道题。",
    support_2: "你的名字、日期和序号会写进这个代码仓库。仓库的历史是公开的，永久保留。",
    support_3: "支持不可抵税，本项目不是慈善机构。支持不会让难题更可能被解决。",
    support_soon: "支持通道即将开放。", support_btn: "通过 GitHub Sponsors 支持",
    rungs: "级已通过", contributors: "AI 做出过已验证结果的人", results_word: "个已验证", copy_link: "复制链接", copied: "已复制",
    join_title: "派你的 AI 来", join_lead: "你用自己的 AI 和自己的 API 密钥，在自己的电脑上运行。裁判是一个程序。",
    step1_t: "挑一级未解决的阶梯", step1_d: "每一级都是一个等待证明的精确命题。",
    step2_t: "让你的 AI 写证明", step2_d: "把仓库里的 AGENTS.md 交给你的 AI，里面写明了规则和文件结构。",
    step3_t: "发起合并请求", step3_d: "Lean 检查器会自动运行。Lean 接受了每一步，结果就记在你名下。",
    pick: "帮我挑一个", picked: "试试这个：", copy: "复制", agents_link: "阅读 AGENTS.md",
    keys_title: "你的 API 密钥始终在你手里",
    keys_body: "本项目没有服务器，没有登录。它从不索要、保存或经手任何 API 密钥。任何以本项目名义向你要密钥的人都不是我们。",
    about_title: "如何运作",
    about_judge_t: "唯一的裁判", about_judge_d: "只有 Lean 证明检查器接受了每一步，没有跳步，也没有 Lean 标准三条公理之外的公理，结果才算数。不涉及任何人的意见。",
    about_fixed_t: "固定的命题", about_fixed_d: "每道题和每一级阶梯的陈述都放在受保护的文件里，提交者无法修改。证明就是对着这个精确陈述检查的。",
    about_not_t: "这不是什么", about_not_d: "这不是在宣称任何一个猜想即将被解决。阶梯上的结果是有限范围的验证和小步骤。模型名称由提交者自报，未经核实。",
    about_sec_t: "安全与信任", about_sec_d: "网站是由公开仓库生成的静态文件。没有后台，没有账号，没有追踪，页面无法向任何地方发送数据。你可以用页脚显示的版本重新生成网站来对比。",
    about_lic_t: "许可证", about_lic_d: "全部内容以 Apache-2.0 许可证开源。",
    footer_rule: "只有 Lean 接受的结果才算数。", repo: "代码仓库", build: "版本",
  },
};

const CSS = `
:root{--bg:#fbfaf7;--card:#fff;--text:#17161a;--muted:#5d5a66;--line:#e3e0d9;--accent:#1d6b58;--accent-ink:#fff;--soft:#e4f1ec;--ok:#1f7a4d;--warn:#8a6100}
@media (prefers-color-scheme:dark){:root{--bg:#111214;--card:#181a1d;--text:#eceae6;--muted:#a3a0aa;--line:#2b2e33;--accent:#4cc3a1;--accent-ink:#0b1714;--soft:#16302a;--ok:#5fd39a;--warn:#e3b341}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif}
a{color:var(--accent)}[hidden]{display:none!important}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
header.top{border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px;flex-wrap:wrap;padding-top:8px;padding-bottom:8px}
.brand{font-weight:800;letter-spacing:-.01em;color:var(--text);text-decoration:none}
nav{display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:.92rem}
nav a{color:var(--muted);text-decoration:none}nav a:hover{color:var(--text)}
.lang{font:inherit;font-size:.85rem;background:none;color:var(--text);border:1px solid var(--line);border-radius:999px;padding:4px 12px;cursor:pointer}
main{padding:48px 0 72px}
h1{font-size:clamp(1.9rem,6vw,2.9rem);line-height:1.15;letter-spacing:-.02em;margin:0 0 20px}
h2{font-size:1.3rem;margin:48px 0 12px;letter-spacing:-.01em}
h3{font-size:1.05rem;margin:0 0 4px}
p{margin:0 0 14px}.muted{color:var(--muted)}.small{font-size:.9rem}
.live{font-size:1.05rem;margin:0 0 20px}.live b{font-size:1.4rem}
.latest{border-left:3px solid var(--accent);padding:4px 0 4px 14px;margin:0 0 28px}
.btns{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 8px}
.btn{display:inline-block;font:inherit;font-weight:650;text-decoration:none;border-radius:999px;padding:12px 22px;border:1px solid var(--line);background:none;color:var(--text);cursor:pointer}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn.sm{padding:5px 12px;font-size:.85rem;font-weight:500}
.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:0 0 14px;color:inherit;text-decoration:none}
a.card:hover{border-color:var(--accent)}
.badge{display:inline-block;font-size:.75rem;font-weight:650;color:var(--accent);background:var(--soft);border-radius:999px;padding:2px 10px;margin-bottom:8px}
.fig{font-variant-numeric:tabular-nums;font-weight:700}
.note{background:var(--soft);border-radius:12px;padding:14px 16px;margin:20px 0}
.rung{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap;padding:14px 0;border-bottom:1px solid var(--line)}
.rung .b{font-size:1.15rem;font-weight:700;font-variant-numeric:tabular-nums}
.ok{color:var(--ok);font-weight:650}.open{color:var(--warn);font-weight:650}
.name{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--line)}
.name .n{color:var(--muted);font-variant-numeric:tabular-nums;margin-right:8px}
.name:target{background:var(--soft);border-radius:8px;padding-left:10px;padding-right:10px}
.step{display:flex;gap:14px;margin:0 0 18px}.step .k{flex:none;width:30px;height:30px;border-radius:50%;background:var(--soft);color:var(--accent);font-weight:700;display:flex;align-items:center;justify-content:center}
pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;overflow-x:auto;font:14px/1.5 ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;margin:0 0 10px}
footer{border-top:1px solid var(--line);padding:24px 0 40px;color:var(--muted);font-size:.85rem}
footer .wrap{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
`;

const JS = `
(function(){var D=${JSON.stringify(I18N)};
function set(l){document.documentElement.lang=l==="zh"?"zh-CN":"en";
document.querySelectorAll("[data-i18n]").forEach(function(e){var v=D[l][e.getAttribute("data-i18n")];if(v!=null)e.textContent=v;});
document.querySelectorAll("[data-lang]").forEach(function(e){e.hidden=e.getAttribute("data-lang")!==l;});
var b=document.getElementById("lang");if(b)b.textContent=l==="zh"?"EN":"中文";
try{localStorage.setItem("lang",l);}catch(e){}window.__lang=l;}
var l=null;try{l=localStorage.getItem("lang");}catch(e){}
if(l!=="en"&&l!=="zh")l=(navigator.language||"").toLowerCase().indexOf("zh")===0?"zh":"en";
set(l);var b=document.getElementById("lang");if(b)b.addEventListener("click",function(){set(window.__lang==="zh"?"en":"zh");});
document.querySelectorAll("[data-copy]").forEach(function(btn){btn.addEventListener("click",function(){
var v=btn.getAttribute("data-copy");if(v.charAt(0)==="#")v=location.href.split("#")[0]+v;
var done=function(){var o=btn.textContent;btn.textContent=D[window.__lang].copied;setTimeout(function(){btn.textContent=o;},1200);};
if(navigator.clipboard)navigator.clipboard.writeText(v).then(done,function(){});});});
var pk=document.getElementById("pick");if(pk){var open=JSON.parse(document.getElementById("open-data").textContent);
pk.addEventListener("click",function(){if(!open.length)return;var r=open[Math.floor(Math.random()*open.length)];
var o=document.getElementById("picked");o.hidden=false;var a=document.getElementById("picked-link");
a.textContent=(window.__lang==="zh"?r.zh:r.en);a.href=r.href;});}
})();`;

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;

function page({ title, root, body, extra = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<meta name="description" content="${esc(I18N.en.tagline)}">
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="wrap">
<a class="brand" href="${root}index.html">${esc(cfg.site_name)}</a>
<nav><a href="${root}join.html">${t("nav_join")}</a><a href="${root}names.html">${t("nav_names")}</a><a href="${root}about.html">${t("nav_about")}</a><button class="lang" id="lang" type="button">中文</button></nav>
</div></header>
<main><div class="wrap">
${body}
</div></main>
<footer><div class="wrap"><span>${t("footer_rule")}</span><span><a href="${esc(cfg.repo_url)}" rel="noopener">${t("repo")}</a> · ${t("build")} ${esc(sha)}</span></div></footer>
${extra}
<script>${JS}</script>
</body>
</html>
`;
}

const rungText = (p, r) => ({ en: `${p.ladder_en} ${num(r.bound)}`, zh: `${p.ladder_zh} ${num(r.bound)}` });
const supportBlock = (root) =>
  cfg.sponsor_url && /^https:\/\/github\.com\/sponsors\/[A-Za-z0-9-]+$/.test(cfg.sponsor_url)
    ? `<a class="btn primary" href="${esc(cfg.sponsor_url)}" rel="noopener">${t("support_btn")}</a>`
    : `<a class="btn" href="${root}names.html#support">${t("support_soon")}</a>`;

// ---------- pages ----------
function home() {
  const lt = latest ? rungText(bySlug[latest.problem], latest) : null;
  const cards = problems.map((p) => {
    const top = topBound(p.slug);
    return `<a class="card" href="p/${esc(p.slug)}.html">
<span class="badge">${t("tier_" + p.tier)}</span>
<h3>${pair(p.name_en, p.name_zh)}</h3>
<p class="muted">${pair(p.statement_en, p.statement_zh)}</p>
<p class="small" style="margin:0">${top ? `${pair(p.ladder_en, p.ladder_zh)} <span class="fig">${num(top)}</span>` : t("none_yet")} · <span class="fig">${backers(p.slug).length}</span> ${t("backers")}</p>
</a>`;
  }).join("\n");
  return page({
    title: cfg.site_name, root: "",
    body: `<h1>${t("tagline")}</h1>
<p class="live"><b class="fig">${verified.length}</b> ${t("live_verified")} · <b class="fig">${supporters.length}</b> ${t("live_names")}</p>
${latest ? `<div class="latest"><div class="small muted">${t("latest")}</div><div><a href="p/${esc(latest.problem)}.html">${pair(bySlug[latest.problem].name_en, bySlug[latest.problem].name_zh)}</a>: ${pair(lt.en, lt.zh)}</div><div class="small muted">${t("by")} ${ghUser(latest.proved_by)} · ${esc(latest.verified_at)}</div></div>` : ""}
<div class="btns"><a class="btn primary" href="join.html">${t("cta_ai")}</a><a class="btn" href="names.html#support">${t("cta_name")}</a></div>
<h2>${t("problems")}</h2>
${cards}`,
  });
}

function problemPage(p) {
  const rungs = records.filter((r) => r.problem === p.slug).map((r) => {
    const tx = rungText(p, r);
    const right = r.status === "verified"
      ? `<span class="small"><span class="ok">${t("verified_word")}</span> · ${ghUser(r.proved_by)} · ${esc(r.model)} <span class="muted">(${t("model_note")})</span> · ${esc(r.verified_at)} · <a href="${esc(cfg.repo_url)}/blob/main/${esc(r.file)}" rel="noopener">${t("lean_file")}</a></span>`
      : (lockedBy(r) ? `<span class="small muted">${t("locked")}</span>` : `<a class="small open" href="../join.html">${t("open_rung")}</a>`);
    return `<div class="rung" id="r-${r.bound}"><span><span class="muted small">${pair(p.ladder_en, p.ladder_zh)}</span> <span class="b">${num(r.bound)}</span></span>${right}</div>`;
  }).join("\n");
  const names = backers(p.slug);
  return page({
    title: `${p.name_en} · ${cfg.site_name}`, root: "../",
    body: `<span class="badge">${t("tier_" + p.tier)}</span>
<h1>${pair(p.name_en, p.name_zh)}</h1>
<p style="font-size:1.15rem">${pair(p.statement_en, p.statement_zh)}</p>
<p class="muted">${pair(p.status_en, p.status_zh)} <a href="${esc(cfg.repo_url)}/blob/main/${esc(p.lean_file)}" rel="noopener">${t("statement_file")}</a></p>
<div class="note small">${t("unsolved_note")}</div>
<h2>${t("ladder")}</h2><p class="muted small">${t("ladder_help")}</p>
${rungs}
<h2>${t("names_here")}</h2>
${names.length ? names.map(nameRow).join("\n") : `<p class="muted">${t("be_first")}</p>`}
<div class="btns" style="margin-top:20px">${supportBlock("../")}</div>`,
  });
}

function nameRow(s) {
  const u = safeUrl(s.url);
  const p = bySlug[s.problem];
  return `<div class="name" id="n-${Number(s.n)}"><span><span class="n">#${Number(s.n)}</span>${u ? `<a href="${u}" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</span><span class="small muted">${p ? pair(p.name_en, p.name_zh) : ""} · ${esc(s.date)} <button class="btn sm" type="button" data-copy="#n-${Number(s.n)}">${t("copy_link")}</button></span></div>`;
}

function namesPage() {
  const counts = {};
  for (const r of verified) counts[r.proved_by] = (counts[r.proved_by] || 0) + 1;
  const contrib = Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([who, c]) => `<div class="name"><span>${ghUser(who)}</span><span class="small muted"><span class="fig">${c}</span> ${t("rungs")}</span></div>`).join("\n");
  return page({
    title: `The record · ${cfg.site_name}`, root: "",
    body: `<h1>${t("record_title")}</h1><p class="muted">${t("record_lead")}</p>
${supporters.length ? supporters.map(nameRow).join("\n") : `<p class="card muted">${t("be_first")}</p>`}
<h2 id="support">${t("support_title")}</h2>
<p>${t("support_1")}</p><p>${t("support_2")}</p><p class="muted small">${t("support_3")}</p>
<div class="btns">${supportBlock("")}</div>
<h2>${t("contributors")}</h2>
${contrib || `<p class="muted">${t("be_first")}</p>`}`,
  });
}

function joinPage() {
  const open = records.filter((r) => r.status === "open").map((r) => {
    const p = bySlug[r.problem], tx = rungText(p, r);
    return { en: `${p.name_en}: ${tx.en}`, zh: `${p.name_zh}：${tx.zh}`, href: `p/${p.slug}.html#r-${r.bound}` };
  });
  const clone = `git clone ${cfg.repo_url}.git`;
  const step = (k, a, b) => `<div class="step"><div class="k">${k}</div><div><h3>${t(a)}</h3><p class="muted" style="margin:0">${t(b)}</p></div></div>`;
  return page({
    title: `Send your AI · ${cfg.site_name}`, root: "",
    body: `<h1>${t("join_title")}</h1><p class="muted">${t("join_lead")}</p>
<div style="margin:28px 0">${step(1, "step1_t", "step1_d")}${step(2, "step2_t", "step2_d")}${step(3, "step3_t", "step3_d")}</div>
<pre>${esc(clone)}</pre>
<div class="btns"><button class="btn sm" type="button" data-copy="${esc(clone)}">${t("copy")}</button><a class="btn sm" href="${esc(cfg.repo_url)}/blob/main/AGENTS.md" rel="noopener">${t("agents_link")}</a></div>
<div class="btns" style="margin-top:24px"><button class="btn primary" id="pick" type="button">${t("pick")}</button></div>
<p id="picked" hidden>${t("picked")} <a id="picked-link" href="#"></a></p>
<div class="note"><h3>${t("keys_title")}</h3><p class="small" style="margin:0">${t("keys_body")}</p></div>`,
    extra: `<script type="application/json" id="open-data">${JSON.stringify(open).replace(/</g, "\\u003c")}</script>`,
  });
}

function aboutPage() {
  const sec = (a, b) => `<h2>${t(a)}</h2><p>${t(b)}</p>`;
  return page({
    title: `How it works · ${cfg.site_name}`, root: "",
    body: `<h1>${t("about_title")}</h1>
${sec("about_judge_t", "about_judge_d")}${sec("about_fixed_t", "about_fixed_d")}${sec("about_not_t", "about_not_d")}${sec("about_sec_t", "about_sec_d")}${sec("about_lic_t", "about_lic_d")}
<p><a href="${esc(cfg.repo_url)}" rel="noopener">${esc(cfg.repo_url)}</a></p>`,
  });
}

// ---------- write ----------
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/p", { recursive: true });
writeFileSync("dist/index.html", home());
for (const p of problems) writeFileSync(`dist/p/${p.slug}.html`, problemPage(p));
writeFileSync("dist/names.html", namesPage());
writeFileSync("dist/join.html", joinPage());
writeFileSync("dist/about.html", aboutPage());
writeFileSync("dist/feed.json", JSON.stringify({ build: sha, problems, records, supporters }, null, 1));
writeFileSync("dist/.nojekyll", "");
console.log(`built ${4 + problems.length} pages: ${verified.length} verified, ${records.length - verified.length} open, ${supporters.length} supporters`);
