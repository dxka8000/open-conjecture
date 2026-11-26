// Campaigns: one per problems/<slug>.json. Each campaign has its own Lean folder and records folder:
//   problems/<slug>.json            name, order (1 = headline campaign), lean_file (…/Basic.lean), lean_namespace
//   OpenConjecture/<Dir>/Lemmas.lean the protected statements (unsolved problems and checkable milestones)
//   OpenConjecture/<Dir>/Proofs/     proofs and refutations      OpenConjecture/<Dir>/Proposals/  outside agents' splits
//   records/<slug>/<id>.json         one record per statement; record ids are unique across all campaigns
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SLUG_RE = /^[a-z0-9-]{1,30}$/;
const NS_RE = /^[A-Z][A-Za-z0-9]{0,30}$/;

/** Every campaign, headline first: {slug, order, dir: "OpenConjecture/X", ns: "OpenConjecture.X", name_en, name_zh, ...}. */
export function readCampaigns(root = ".") {
  const dir = join(root, "problems");
  const out = [];
  for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith(".json")).sort() : []) {
    const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!SLUG_RE.test(p.slug || "") || f !== `${p.slug}.json`) throw new Error(`problems/${f}: slug must be lowercase letters, digits and hyphens, and the file <slug>.json`);
    if (!NS_RE.test(p.lean_namespace || "")) throw new Error(`problems/${f}: lean_namespace must be one capitalised word`);
    if (p.lean_file !== `OpenConjecture/${p.lean_namespace}/Basic.lean`) throw new Error(`problems/${f}: lean_file must be OpenConjecture/${p.lean_namespace}/Basic.lean`);
    out.push({ ...p, order: Number.isInteger(p.order) ? p.order : 99, dir: `OpenConjecture/${p.lean_namespace}`, ns: `OpenConjecture.${p.lean_namespace}` });
  }
  out.sort((a, b) => a.order - b.order || (a.slug < b.slug ? -1 : 1));
  if (!out.length) throw new Error("problems/: no campaign");
  return out;
}

/** The campaign a repository path belongs to (records/<slug>/… or OpenConjecture/<Dir>/…), or null. */
export function campaignOfPath(camps, path) {
  const m = /^records\/([a-z0-9-]+)\//.exec(path) || /^OpenConjecture\/([A-Za-z0-9]+)\//.exec(path);
  if (!m) return null;
  return camps.find((c) => c.slug === m[1] || c.lean_namespace === m[1]) || null;
}

/** Every record of every campaign as {campaign (slug), f, where, r}; the record itself is not changed. */
export function readRecordFiles(root = ".", camps = readCampaigns(root)) {
  const out = [];
  for (const c of camps) {
    const dir = join(root, "records", c.slug);
    for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith(".json")).sort() : []) {
      const where = `records/${c.slug}/${f}`;
      let r;
      try { r = JSON.parse(readFileSync(join(root, where), "utf8")); } catch { throw new Error(`${where}: invalid JSON`); }
      out.push({ campaign: c.slug, f, where, r });
    }
  }
  return out;
}

/** Statement definitions in a Lemmas.lean: Map name -> body (one line). */
export function lemmaBodies(text) {
  return new Map([...String(text).matchAll(/^def ([A-Za-z0-9_]+) : Prop := (.*)$/gm)].map((m) => [m[1], m[2]]));
}
