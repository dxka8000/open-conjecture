// Trusted auto-merge. Runs from the default branch, never from a pull request.
// It never checks out or executes code from a pull request: it reads file lists, one JSON record
// through the GitHub API, as data, and merges only the exact commit the Lean checker passed.
//
// MODE=run   : triggered when "Lean checker" finishes on a pull request. Posts the verdict
//              (ACCEPTED / REJECTED / FAULT) and merges if the pull request qualifies.
// MODE=sweep : every 15 minutes. Retries recent pull requests whose check passed (for example after a
//              transient API failure) and merges the ones that qualify. Posts nothing on failure.
//
// Three shapes qualify:
//   proof     : exactly two files: adds Proofs/<Statement>.lean, flips an open record to "verified"
//   refute    : exactly two files: adds Proofs/Refute_<Statement>.lean, flips an open record to "refuted"
//   split     : adds 1-4 Proposals/Step_<Name>.lean, one new step record each, and Proposals/Split_<Parent>.lean
//               (Lean has checked that the steps imply the parent; CI ran the triviality and filler checks).
//               Nothing else. It then needs the AI review: it gets the label needs-review, and merges only
//               when the repository owner's account has applied review-ok AND posted the verdict comment
//               "AI review: review-ok for <head sha>" for the exact commit. Labels applied by anyone else,
//               or a verdict for an older commit, do not count.
import { readFileSync, readdirSync, existsSync } from "node:fs";

const { GH_TOKEN, HEAD_SHA, REPO, CONCLUSION, RUN_URL } = process.env;
const MODE = process.env.MODE || "run";
const CHECK_WORKFLOW = "Lean checker";
// Accounts whose AI review verdicts count: the repository's owner and the reviewers named in
// site/config.json (the owner's personal account, since the repository belongs to an organization).
const OWNER = String(REPO || "").split("/")[0];
let CONFIG_REVIEWERS = [];
try { CONFIG_REVIEWERS = JSON.parse(readFileSync("site/config.json", "utf8")).reviewers || []; } catch {}
const REVIEWERS = new Set([OWNER, ...CONFIG_REVIEWERS].filter((x) => typeof x === "string" && /^[A-Za-z0-9-]{1,39}$/.test(x)).map((x) => x.toLowerCase()));
const REVIEW = { need: "needs-review", ok: "review-ok", rejected: "review-rejected" };
const API = process.env.GITHUB_API || "https://api.github.com"; // overridden only by the local simulation

const api = async (path, opts = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
  if (!res.ok && res.status !== 404) throw new Error(`${opts.method || "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 404 ? null : res.status === 204 ? {} : res.json();
};
const comment = (pr, body) => api(`/repos/${REPO}/issues/${pr.number}/comments`, { method: "POST", body: JSON.stringify({ body }) });

// Records on main (this checkout is main).
const mainRecords = new Map();
for (const f of readdirSync("records/collatz")) {
  try { const r = JSON.parse(readFileSync(`records/collatz/${f}`, "utf8")); mainRecords.set(r.id, r); } catch {}
}
async function fileAtHead(pr, path) {
  const got = await api(`/repos/${pr.head.repo.full_name}/contents/${path}?ref=${pr.head.sha}`);
  return got && got.content ? Buffer.from(got.content, "base64").toString("utf8") : null;
}

async function checkPassed(sha) {
  const runs = await api(`/repos/${REPO}/actions/runs?head_sha=${sha}&event=pull_request&per_page=20`);
  const mine = (runs?.workflow_runs || []).filter((r) => r.name === CHECK_WORKFLOW).sort((a, b) => b.id - a.id);
  return mine.length > 0 && mine[0].status === "completed" && mine[0].conclusion === "success";
}

// Returns {ok: true, kind, summary} or {ok: false, why}.
async function evaluate(pr) {
  const author = pr.user.login;
  const files = await api(`/repos/${REPO}/pulls/${pr.number}/files?per_page=100`);
  if (files && files.some((f) => /^OpenConjecture\/Collatz\/Proposals\//.test(f.filename))) return evaluateSplit(pr, files, author);
  if (!files || files.length !== 2) return { ok: false, why: `it must change exactly two files, but it changes ${files ? files.length : "?"}.` };
  const proof = files.find((f) => /^OpenConjecture\/Collatz\/Proofs\/[A-Za-z0-9_]+\.lean$/.test(f.filename));
  const rec = files.find((f) => /^records\/collatz\/[a-z0-9-]+\.json$/.test(f.filename));
  if (!rec) return { ok: false, why: "it must change one record under records/collatz/." };
  let head;
  try { head = JSON.parse(await fileAtHead(pr, rec.filename)); } catch { return { ok: false, why: "its record is not valid JSON." }; }
  const id = rec.filename.split("/").pop().replace(/\.json$/, "");

  if (proof) {
    if (proof.status !== "added" || rec.status !== "modified") return { ok: false, why: "a proof adds one new file under Proofs/ and modifies one existing record." };
    const base = mainRecords.get(id);
    if (!base) return { ok: false, why: `record ${id} does not exist on main.` };
    if (base.status !== "open") return { ok: false, why: `lemma ${id} is already settled.` };
    const fileName = proof.filename.split("/").pop().replace(/\.lean$/, "");
    const refute = fileName.startsWith("Refute_");
    const want = refute ? `Refute_${base.statement}` : base.statement;
    if (fileName !== want) return { ok: false, why: `the file must be named ${want}.lean for lemma ${id}.` };
    const newStatus = refute ? "refuted" : "verified";
    const changeable = new Set(["status", "proved_by", "model", "verified_at"]);
    for (const k of new Set([...Object.keys(base), ...Object.keys(head)]))
      if (!changeable.has(k) && JSON.stringify(base[k]) !== JSON.stringify(head[k])) return { ok: false, why: `field "${k}" of the record must not change.` };
    if (head.status !== newStatus) return { ok: false, why: `the record's status must be "${newStatus}".` };
    if (String(head.proved_by).toLowerCase() !== author.toLowerCase()) return { ok: false, why: `proved_by must be your GitHub login (${author}).` };
    const day = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / 864e5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(head.verified_at) || Math.abs(day(head.verified_at) - Math.floor(Date.now() / 864e5)) > 2)
      return { ok: false, why: "verified_at must be today's date (UTC), as YYYY-MM-DD." };
    return { ok: true, kind: refute ? "refute" : "proof", summary: `${refute ? "Refuted" : "Checked"}: ${id} by ${author}`,
      accepted: refute ? `**ACCEPTED**. Lean checked a proof that \`${base.statement}\` is false. Merged as refuted, credited to @${author}.`
                       : `**ACCEPTED**. Lean checked every step of \`${base.statement}\`. Merged; it appears on the site within a few minutes, credited to @${author}.` };
  }

  return { ok: false, why: "it must add one file under OpenConjecture/Collatz/Proofs/ and change its record, or be a split (see AGENTS.md)." };
}

const day = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / 864e5);
const labelsOf = (pr) => new Set((pr.labels || []).map((l) => (typeof l === "string" ? l : l && l.name)));
async function addLabel(pr, name) {
  if (!labelsOf(pr).has(name)) await api(`/repos/${REPO}/issues/${pr.number}/labels`, { method: "POST", body: JSON.stringify({ labels: [name] }) });
}
async function removeLabel(pr, name) {
  if (labelsOf(pr).has(name)) await api(`/repos/${REPO}/issues/${pr.number}/labels/${encodeURIComponent(name)}`, { method: "DELETE" });
}
async function pages(path) {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const list = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(list) || list.length === 0) break;
    all.push(...list);
    if (list.length < 100) break;
  }
  return all;
}
// The AI review verdict counts only if the owner's account applied the label (issue events) and posted the
// verdict for this exact head commit (issue comments). Returns "ok", "rejected" or null.
async function reviewVerdict(pr) {
  const labels = labelsOf(pr);
  const events = await pages(`/repos/${REPO}/issues/${pr.number}/events`);
  const lastLabelBy = (name) => {
    let who = null;
    for (const e of events) {
      if (!e || !e.label || e.label.name !== name) continue;
      if (e.event === "labeled") who = e.actor && e.actor.login;
      else if (e.event === "unlabeled") who = null;
    }
    return who;
  };
  const isOwner = (login) => typeof login === "string" && REVIEWERS.has(login.toLowerCase());
  const comments = await pages(`/repos/${REPO}/issues/${pr.number}/comments`);
  const verdictFor = (word) => comments.some((c) => c && c.user && isOwner(c.user.login) && typeof c.body === "string"
    && c.body.includes(`AI review: ${word} for ${pr.head.sha}`));
  if (labels.has(REVIEW.ok) && isOwner(lastLabelBy(REVIEW.ok)) && verdictFor(REVIEW.ok)) return "ok";
  if (labels.has(REVIEW.rejected) && isOwner(lastLabelBy(REVIEW.rejected)) && verdictFor(REVIEW.rejected)) return "rejected";
  return null;
}

// A split: 1-4 new steps under one parent, plus the Lean file proving that together they imply it.
async function evaluateSplit(pr, files, author) {
  const shape = "a split adds 1 to 4 files Proposals/Step_<Name>.lean, one new step record for each, and one file Proposals/Split_<Parent>.lean, and changes nothing else.";
  const stepFiles = files.filter((f) => /^OpenConjecture\/Collatz\/Proposals\/Step_[A-Za-z0-9_]+\.lean$/.test(f.filename));
  const splitFiles = files.filter((f) => /^OpenConjecture\/Collatz\/Proposals\/Split_[A-Za-z0-9_]+\.lean$/.test(f.filename));
  const recFiles = files.filter((f) => /^records\/collatz\/[a-z0-9-]+\.json$/.test(f.filename));
  if (splitFiles.length !== 1 || stepFiles.length < 1 || stepFiles.length > 4 || recFiles.length !== stepFiles.length
      || files.length !== stepFiles.length + recFiles.length + 1 || files.some((f) => f.status !== "added"))
    return { ok: false, why: shape };
  const splitName = splitFiles[0].filename.split("/").pop().replace(/\.lean$/, "");
  const names = new Set(stepFiles.map((f) => f.filename.split("/").pop().replace(/\.lean$/, "")));
  const recs = [];
  for (const f of recFiles) {
    let r;
    try { r = JSON.parse(await fileAtHead(pr, f.filename)); } catch { return { ok: false, why: `${f.filename} is not valid JSON.` }; }
    const id = f.filename.split("/").pop().replace(/\.json$/, "");
    if (mainRecords.has(id)) return { ok: false, why: `record ${id} already exists.` };
    if (!r || r.kind !== "step" || r.status !== "open" || !names.has(r.statement))
      return { ok: false, why: `record ${id} must have kind "step", status "open" and the statement of one of the new step files.` };
    if (String(r.proposed_by).toLowerCase() !== author.toLowerCase()) return { ok: false, why: `proposed_by must be your GitHub login (${author}).` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.proposed_at) || Math.abs(day(r.proposed_at) - Math.floor(Date.now() / 864e5)) > 2)
      return { ok: false, why: "proposed_at must be today's date (UTC), as YYYY-MM-DD." };
    if (r.split !== splitName) return { ok: false, why: `record ${id} must have "split": "${splitName}".` };
    names.delete(r.statement);
    recs.push(r);
  }
  if (names.size) return { ok: false, why: `every new step needs its own record; missing: ${[...names].join(", ")}.` };
  const parent = recs[0].parent;
  if (recs.some((r) => r.parent !== parent)) return { ok: false, why: "all steps of a split must have the same parent." };
  const base = mainRecords.get(parent);
  if (!base || base.status !== "open" || base.kind === "summit") return { ok: false, why: `parent ${parent} is not an open statement on main.` };
  if (splitName !== `Split_${base.statement}`) return { ok: false, why: `the split file must be named Split_${base.statement}.lean.` };
  if ([...mainRecords.values()].some((r) => r.parent === parent && r.kind === "step")) return { ok: false, why: `${parent} is already split.` };

  const verdict = await reviewVerdict(pr);
  const summary = `Split: ${parent} into ${recs.map((r) => r.id).sort().join(", ")} by ${author}`;
  if (verdict === "ok") {
    return { ok: true, kind: "split", summary,
      accepted: `**ACCEPTED**. Lean checked that the ${recs.length} new step(s) imply \`${base.statement}\`, the triviality and filler checks passed, and the AI review found a genuine decomposition. They are now open statements under \`${parent}\`, credited to @${author}.` };
  }
  if (verdict === "rejected") {
    await removeLabel(pr, REVIEW.need);
    return { ok: false, rejected: true, why: "the AI review found this split is a restatement or filler, not a genuine decomposition (see its comment). Push a revised split to be reviewed again." };
  }
  // Not reviewed for this commit yet: ask for review, and clear any verdict that was for an older commit.
  await removeLabel(pr, REVIEW.ok);
  await removeLabel(pr, REVIEW.rejected);
  await addLabel(pr, REVIEW.need);
  return { ok: false, waiting: true, why: "the Lean checker, the triviality check and the filler check passed. Waiting for the AI review, which runs every 2 hours and asks whether this is a genuine decomposition or a restatement." };
}

async function merge(pr, result) {
  const merged = await api(`/repos/${REPO}/pulls/${pr.number}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: "squash", sha: pr.head.sha, commit_title: `${result.summary} (#${pr.number})` }),
  });
  if (!merged || !merged.merged) { console.log(`Merge of #${pr.number} did not happen: ${JSON.stringify(merged)}`); return false; }
  console.log(`Merged #${pr.number}: ${result.summary}`);
  await comment(pr, result.accepted);
  return true;
}

async function openPulls() {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const list = await api(`/repos/${REPO}/pulls?state=open&per_page=100&page=${page}`);
    if (!list || list.length === 0) break;
    all.push(...list);
  }
  return all;
}

let mergedAny = false;
if (MODE === "run") {
  const pr = (await openPulls()).find((p) => p.head.sha === HEAD_SHA);
  if (!pr) { console.log("No open pull request at the checked commit; nothing to do."); process.exit(0); }
  if (CONCLUSION !== "success") {
    if (CONCLUSION === "failure") await comment(pr, `**REJECTED** by the Lean checker at ${HEAD_SHA.slice(0, 7)}. The reason is in the run log: ${RUN_URL}\n\nPush a fixed file to this pull request and it is checked again, or take another lemma.`);
    else await comment(pr, `**FAULT**: the check did not finish (${CONCLUSION}). This says nothing about your submission. Details: ${RUN_URL}`);
    console.log(`Posted ${CONCLUSION} verdict on #${pr.number}`);
    process.exit(0);
  }
  const result = await evaluate(pr);
  if (result.ok) mergedAny = await merge(pr, result);
  else {
    console.log(`Not merging #${pr.number}: ${result.why}`);
    await comment(pr, result.waiting ? `Checks passed: ${result.why}`
      : result.rejected ? `Not merged: ${result.why}`
      : `The Lean checker passed, but this pull request can't be merged automatically: ${result.why}\n\nSee AGENTS.md for the exact shape of a submission.`);
  }
} else {
  // Pull requests are judged when their check finishes; the sweep only retries recent ones, to stay
  // well inside the API budget.
  const recent = Date.now() - 2 * 3600e3;
  for (const pr of await openPulls()) {
    const waitingReview = labelsOf(pr).has(REVIEW.need) || labelsOf(pr).has(REVIEW.ok);
    if (!waitingReview && Date.parse(pr.updated_at) < recent) continue;
    try {
      if (!(await checkPassed(pr.head.sha))) continue;
      const result = await evaluate(pr);
      if (result.ok) mergedAny = (await merge(pr, result)) || mergedAny;
    } catch (e) {
      console.log(`Skipping #${pr.number}: ${e.message}`);
    }
  }
}
if (mergedAny)
  for (const wf of ["check.yml", "site.yml"])
    await api(`/repos/${REPO}/actions/workflows/${wf}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
