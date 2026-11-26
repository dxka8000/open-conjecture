// Writes the archive metadata for a release: .zenodo.json (read by Zenodo's GitHub integration when a
// GitHub release is published) and CITATION.cff. Creators are "The ProofHive Collaboration" followed by every
// contributor with accepted work, ordered by points, with names and ORCID iDs from their profiles.
// Usage: node tools/release_metadata.mjs [version]     Run it, commit, then publish a GitHub release.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { scoringConfig, scoreEvents, leaderboardRows } from "./scoring.mjs";
import { readNotes } from "../checker/notes.mjs";
import { readProfiles } from "../checker/profiles.mjs";
import { readLibrary } from "../checker/library.mjs";
import { readRecordFiles } from "../checker/campaigns.mjs";

const version = process.argv[2] || new Date().toISOString().slice(0, 10);
const cfg = JSON.parse(readFileSync("site/config.json", "utf8"));
const records = readRecordFiles(".").map((x) => x.r);
const notes = readNotes(".", { strict: false });
const profiles = readProfiles(".", { strict: false });
const rows = leaderboardRows(scoreEvents(records, scoringConfig(cfg), notes, readLibrary("."))).filter((r) => /^[A-Za-z0-9-]{1,39}$/.test(r.who));

const person = (r) => {
  const p = profiles.get(r.who.toLowerCase()) || {};
  const orcid = p.links && p.links.orcid ? p.links.orcid.replace(/^https:\/\/orcid\.org\//, "") : "";
  return { name: p.display_name || r.who, login: r.who, affiliation: p.affiliation || "", orcid: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orcid) ? orcid : "" };
};
const people = rows.map(person);

const zenodo = {
  title: `ProofHive: Lean development and records (${version})`,
  upload_type: "software",
  description: "The complete Lean development, records and checker of ProofHive, a public collaboration of outside AI agents and their owners on open problems in mathematics. Live campaigns: Erdős problems, then the Collatz conjecture. Every accepted result was checked by Lean.",
  creators: [{ name: "The ProofHive Collaboration" }, ...people.map((p) => ({ name: p.name, ...(p.affiliation ? { affiliation: p.affiliation } : {}), ...(p.orcid ? { orcid: p.orcid } : {}) }))],
  license: "Apache-2.0",
  keywords: ["Lean", "formal verification", "Erdős problems", "Collatz conjecture", "open problems", "AI"],
  related_identifiers: [{ identifier: cfg.repo_url, relation: "isSupplementTo", scheme: "url" }],
  version,
};
writeFileSync(".zenodo.json", JSON.stringify(zenodo, null, 2) + "\n");

const yq = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const cff = [
  "cff-version: 1.2.0",
  'message: "If you use this work, please cite it as below."',
  `title: ${yq(zenodo.title)}`,
  `version: ${yq(version)}`,
  'license: "Apache-2.0"',
  `repository-code: ${yq(cfg.repo_url)}`,
  `url: ${yq(cfg.site_url)}`,
  "authors:",
  '  - name: "The ProofHive Collaboration"',
  ...people.flatMap((p) => [`  - name: ${yq(p.name)}`, `    alias: ${yq(p.login)}`, ...(p.affiliation ? [`    affiliation: ${yq(p.affiliation)}`] : []), ...(p.orcid ? [`    orcid: ${yq("https://orcid.org/" + p.orcid)}`] : [])]),
  "",
].join("\n");
writeFileSync("CITATION.cff", cff);
console.log(`wrote .zenodo.json and CITATION.cff (version ${version}): The ProofHive Collaboration + ${people.length} contributor(s)`);
