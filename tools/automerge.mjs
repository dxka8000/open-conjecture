// Trusted auto-merge. Runs from the default branch, never from a pull request.
// It never checks out or executes code from a pull request: it reads file lists, one JSON record and
// reviews through the GitHub API, as data, and merges only the exact commit the Lean checker passed.
//
// MODE=run   : triggered when "Lean checker" finishes on a pull request. Posts the verdict
//              (ACCEPTED / REJECTED / FAULT) and merges if the pull request qualifies.
// MODE=sweep : every 15 minutes. Re-examines every open pull request (proposals gather their
//              approvals over time) and merges the ones that now qualify. Posts nothing on failure.
//
// Three shapes qualify, each changing exactly two files:
//   proof     : adds Proofs/<Statement>.lean, flips an open record to "verified"
//   refute    : adds Proofs/Refute_<Statement>.lean, flips an open record to "refuted"
//   proposal  : adds Proposals/Step_<Name>.lean and a new "step" record; needs 2 approvals
import { readFileSync, readdirSync, existsSync } from "node:fs";

const { GH_TOKEN, HEAD_SHA, REPO, CONCLUSION, RUN_URL } = process.env;
const MODE = process.env.MODE || "run";
const CHECK_WORKFLOW = "Lean checker";
const APPROVALS_NEEDED = 2;

const api = async (path, opts = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
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
const provers = new Set([...mainRecords.values()].filter((r) => r.status !== "open").map((r) => String(r.proved_by).toLowerCase()));

async function fileAtHead(pr, path) {
  const got = await api(`/repos/${pr.head.repo.full_name}/contents/${path}?ref=${pr.head.sha}`);
  return got && got.content ? Buffer.from(got.content, "base64").toString("utf8") : null;
}

async function checkPassed(sha) {
  const runs = await api(`/repos/${REPO}/actions/runs?head_sha=${sha}&event=pull_request&per_page=20`);
  const mine = (runs?.workflow_runs || []).filter((r) => r.name === CHECK_WORKFLOW).sort((a, b) => b.id - a.id);
  return mine.length > 0 && mine[0].status === "completed" && mine[0].conclusion === "success";
}

// Returns {ok: true, kind, summary} or {ok: false, why, waiting?}.
async function evaluate(pr) {
  const author = pr.user.login;
  const files = await api(`/repos/${REPO}/pulls/${pr.number}/files?per_page=100`);
  if (!files || files.length !== 2) return { ok: false, why: `it must change exactly two files, but it changes ${files ? files.length : "?"}.` };
  const proof = files.find((f) => /^OpenConjecture\/Collatz\/Proofs\/[A-Za-z0-9_]+\.lean$/.test(f.filename));
  const prop = files.find((f) => /^OpenConjecture\/Collatz\/Proposals\/Step_[A-Za-z0-9_]+\.lean$/.test(f.filename));
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

  if (prop) {
    if (prop.status !== "added" || rec.status !== "added") return { ok: false, why: "a proposal adds one new file under Proposals/ and one new record." };
    const name = prop.filename.split("/").pop().replace(/\.lean$/, "");
    if (head.kind !== "step" || head.statement !== name || head.status !== "open") return { ok: false, why: `the new record must have kind "step", statement "${name}" and status "open".` };
    if (String(head.proposed_by).toLowerCase() !== author.toLowerCase()) return { ok: false, why: `proposed_by must be your GitHub login (${author}).` };
    if (!mainRecords.has(head.parent)) return { ok: false, why: `parent ${head.parent} is not an existing lemma.` };
    const reviews = await api(`/repos/${REPO}/pulls/${pr.number}/reviews?per_page=100`);
    const latest = new Map();
    for (const r of reviews || []) {
      const who = r.user && r.user.login;
      if (!who || who.toLowerCase() === author.toLowerCase() || !provers.has(who.toLowerCase())) continue;
      if (r.commit_id !== pr.head.sha || !["APPROVED", "CHANGES_REQUESTED"].includes(r.state)) continue;
      latest.set(who.toLowerCase(), r.state);
    }
    const yes = [...latest.values()].filter((s) => s === "APPROVED").length;
    const no = [...latest.values()].filter((s) => s === "CHANGES_REQUESTED").length;
    if (yes < APPROVALS_NEEDED || no >= yes)
      return { ok: false, waiting: true, why: `a proposal needs ${APPROVALS_NEEDED} approvals on its latest commit from people who have a checked result here (not the proposer), and more approvals than change requests. It has ${yes} approval(s) and ${no} change request(s).` };
    return { ok: true, kind: "proposal", summary: `New step: ${id} by ${author}`,
      accepted: `**ACCEPTED**. The statement compiles and ${yes} reviewers approved it. \`${name}\` is now an open lemma under \`${head.parent}\`.` };
  }

  return { ok: false, why: "it must add one file under OpenConjecture/Collatz/Proofs/ or OpenConjecture/Collatz/Proposals/, plus its record." };
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
    await comment(pr, result.waiting
      ? `The Lean checker passed. Waiting for review: ${result.why} This is re-checked every 15 minutes.`
      : `The Lean checker passed, but this pull request can't be merged automatically: ${result.why}\n\nSee AGENTS.md for the exact shape of a submission.`);
  }
} else {
  for (const pr of await openPulls()) {
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
