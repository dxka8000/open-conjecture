// Trusted auto-merge. Runs from the default branch after "Lean checker" succeeds on a pull request.
// It never checks out or executes code from the pull request: it reads the PR's file list and one
// JSON record through the GitHub API, as data, and merges only the exact commit that was checked.
const { GH_TOKEN, HEAD_SHA, HEAD_REPO, REPO } = process.env;
const api = async (path, opts = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
  if (!res.ok && res.status !== 404) throw new Error(`${opts.method || "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 404 ? null : res.status === 204 ? {} : res.json();
};

let pr = null;
for (let page = 1; page <= 10 && !pr; page++) {
  const list = await api(`/repos/${REPO}/pulls?state=open&per_page=100&page=${page}`);
  if (!list || list.length === 0) break;
  pr = list.find((p) => p.head.sha === HEAD_SHA) || null;
}
if (!pr) { console.log("No open pull request at the checked commit; nothing to do."); process.exit(0); }

const comment = (body) => api(`/repos/${REPO}/issues/${pr.number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
const { CONCLUSION, RUN_URL } = process.env;
if (CONCLUSION !== "success") {
  if (CONCLUSION === "failure") {
    await comment(`**REJECTED** by the Lean checker at ${HEAD_SHA.slice(0, 7)}. The reason is in the run log: ${RUN_URL}\n\nPush a fixed file to this pull request and it is checked again, or take another lemma.`);
  } else {
    await comment(`**FAULT**: the check did not finish (${CONCLUSION}). This says nothing about your proof. Details: ${RUN_URL}`);
  }
  console.log(`Posted ${CONCLUSION} verdict on #${pr.number}`);
  process.exit(0);
}

const reject = async (why) => {
  console.log(`Not merging #${pr.number}: ${why}`);
  await api(`/repos/${REPO}/issues/${pr.number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: `The Lean checker passed, but this pull request can't be merged automatically: ${why}\n\nSee AGENTS.md for the exact shape of a submission.` }),
  });
  process.exit(0);
};

const files = await api(`/repos/${REPO}/pulls/${pr.number}/files?per_page=100`);
if (files.length !== 2) await reject(`it must change exactly two files (one new proof file and its record), but it changes ${files.length}.`);
const proof = files.find((f) => /^OpenConjecture\/Collatz\/Proofs\/[A-Za-z0-9_]+\.lean$/.test(f.filename));
const rec = files.find((f) => /^records\/collatz\/[A-Za-z0-9-]+\.json$/.test(f.filename));
if (!proof || proof.status !== "added") await reject("it must add one new file under OpenConjecture/Collatz/Proofs/.");
if (!rec || rec.status !== "modified") await reject("it must modify one existing record under records/collatz/.");

const fs = await import("node:fs");
let base;
try { base = JSON.parse(fs.readFileSync(rec.filename, "utf8")); } catch { await reject("its record does not exist on main."); }
const got = await api(`/repos/${HEAD_REPO}/contents/${rec.filename}?ref=${HEAD_SHA}`);
let head;
try { head = JSON.parse(Buffer.from(got.content, "base64").toString("utf8")); } catch { await reject("its record is not valid JSON."); }

if (base.status !== "open") await reject(`lemma ${base.id} is already checked.`);
const proofName = proof.filename.split("/").pop().replace(/\.lean$/, "");
if (proofName !== base.statement) await reject(`the proof file must be named ${base.statement}.lean for lemma ${base.id}.`);
const allowedNew = new Set(["status", "proved_by", "model", "verified_at"]);
for (const k of new Set([...Object.keys(base), ...Object.keys(head)])) {
  if (allowedNew.has(k)) continue;
  if (JSON.stringify(base[k]) !== JSON.stringify(head[k])) await reject(`field "${k}" of the record must not change.`);
}
if (head.status !== "verified") await reject(`the record's status must be "verified".`);
if (String(head.proved_by).toLowerCase() !== pr.user.login.toLowerCase()) await reject(`proved_by must be your GitHub login (${pr.user.login}).`);
const day = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / 864e5);
const today = Math.floor(Date.now() / 864e5);
if (!/^\d{4}-\d{2}-\d{2}$/.test(head.verified_at) || Math.abs(day(head.verified_at) - today) > 2) await reject("verified_at must be today's date (UTC), as YYYY-MM-DD.");

const merged = await api(`/repos/${REPO}/pulls/${pr.number}/merge`, {
  method: "PUT",
  body: JSON.stringify({ merge_method: "squash", sha: HEAD_SHA, commit_title: `Checked: ${base.id} by ${pr.user.login} (#${pr.number})` }),
});
if (!merged || !merged.merged) { console.log(`Merge of #${pr.number} did not happen: ${JSON.stringify(merged)}`); process.exit(1); }
console.log(`Merged #${pr.number}: ${base.id} by ${pr.user.login}`);
await comment(`**ACCEPTED**. Lean checked every step of \`${base.statement}\`. Merged; it appears on the site within a few minutes, credited to @${pr.user.login}.`);
for (const wf of ["check.yml", "site.yml"])
  await api(`/repos/${REPO}/actions/workflows/${wf}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
