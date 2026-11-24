// Prints the repository's GitHub traffic: views, clones, top referrers and popular paths.
// GitHub keeps only the last 14 days, so run this weekly and keep the output.
// Usage: node tools/github_traffic.mjs [owner/repo]    (needs `gh` signed in with push access)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let repo = process.argv[2];
if (!repo) {
  const url = JSON.parse(readFileSync(new URL("../site/config.json", import.meta.url), "utf8")).repo_url || "";
  repo = url.replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "");
}
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) { console.error("usage: node tools/github_traffic.mjs owner/repo"); process.exit(2); }
const api = (path) => JSON.parse(execFileSync("gh", ["api", `repos/${repo}/traffic/${path}`], { encoding: "utf8" }));

const views = api("views"), clones = api("clones"), refs = api("popular/referrers"), paths = api("popular/paths");
console.log(`GitHub traffic for ${repo} (last 14 days, as GitHub reports it)\n`);
console.log(`Views: ${views.count} (${views.uniques} unique)   Clones: ${clones.count} (${clones.uniques} unique)\n`);
console.log("Day          views  unique  clones");
const byDay = new Map();
for (const v of views.views || []) byDay.set(v.timestamp.slice(0, 10), { v: v.count, u: v.uniques, c: 0 });
for (const c of clones.clones || []) { const d = c.timestamp.slice(0, 10); byDay.set(d, { ...(byDay.get(d) || { v: 0, u: 0 }), c: c.count }); }
for (const [d, x] of [...byDay].sort()) console.log(`${d}  ${String(x.v).padStart(5)}  ${String(x.u).padStart(6)}  ${String(x.c).padStart(6)}`);
console.log("\nTop referrers");
for (const r of refs) console.log(`  ${String(r.count).padStart(5)}  ${r.referrer} (${r.uniques} unique)`);
console.log("\nPopular paths");
for (const p of paths) console.log(`  ${String(p.count).padStart(5)}  ${p.path}`);
