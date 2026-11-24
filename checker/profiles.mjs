// Contributor profiles: profiles/<github login>.json, set by the contributor with a pull request.
// Shared by the gate, automerge and the site build. Every field is optional except that the file must
// be a JSON object; text is length-capped and free of control characters; links are https only, to the
// expected site for each field. The site escapes everything.
import { readFileSync, readdirSync, existsSync } from "node:fs";

export const PROFILES_DIR = "profiles";
export const PROFILE_MAX_BYTES = 4096;
const TEXT = { display_name: 60, affiliation: 100, bio: 400, country: 40 };
const LINK_HOSTS = {
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  github: ["github.com"],
  orcid: ["orcid.org"],
  scholar: ["scholar.google.com"],
  homepage: null, // any https address
};
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/;

/** Checks one profile. Returns {ok: true, profile} or {ok: false, why}. */
export function checkProfile(fileName, text) {
  const where = `${PROFILES_DIR}/${fileName}`;
  const bad = (why) => ({ ok: false, why: `${where}: ${why}` });
  const m = /^([A-Za-z0-9-]{1,39})\.json$/.exec(fileName);
  if (!m || !LOGIN_RE.test(m[1])) return bad("the file must be named <your GitHub login>.json");
  if (Buffer.byteLength(text, "utf8") > PROFILE_MAX_BYTES) return bad(`a profile is at most ${PROFILE_MAX_BYTES} bytes`);
  let d;
  try { d = JSON.parse(text); } catch { return bad("not valid JSON"); }
  if (!d || typeof d !== "object" || Array.isArray(d)) return bad("must be a JSON object");
  const allowed = new Set([...Object.keys(TEXT), "interests", "links"]);
  for (const k of Object.keys(d)) if (!allowed.has(k)) return bad(`unknown field "${k}" (allowed: ${[...allowed].join(", ")})`);
  const out = { login: m[1] };
  for (const [k, max] of Object.entries(TEXT)) {
    if (d[k] === undefined) continue;
    if (typeof d[k] !== "string" || BAD_CHARS.test(d[k])) return bad(`${k} must be plain text`);
    const v = d[k].replace(/\s+/g, " ").trim();
    if (v.length > max) return bad(`${k} is at most ${max} characters`);
    if (v) out[k] = v;
  }
  if (d.interests !== undefined) {
    if (!Array.isArray(d.interests) || d.interests.length > 8) return bad("interests must be a list of at most 8 short strings");
    const list = [];
    for (const x of d.interests) {
      if (typeof x !== "string" || BAD_CHARS.test(x) || x.trim().length < 1 || x.trim().length > 40) return bad("each interest is 1 to 40 characters of plain text");
      list.push(x.replace(/\s+/g, " ").trim());
    }
    if (list.length) out.interests = list;
  }
  if (d.links !== undefined) {
    if (!d.links || typeof d.links !== "object" || Array.isArray(d.links)) return bad("links must be an object");
    const links = {};
    for (const [k, v] of Object.entries(d.links)) {
      if (!(k in LINK_HOSTS)) return bad(`unknown link "${k}" (allowed: ${Object.keys(LINK_HOSTS).join(", ")})`);
      if (typeof v !== "string" || v.length > 200) return bad(`link ${k} must be an https address of at most 200 characters`);
      let u;
      try { u = new URL(v); } catch { return bad(`link ${k} is not a valid address`); }
      if (u.protocol !== "https:" || u.username || u.password) return bad(`link ${k} must be https`);
      const hosts = LINK_HOSTS[k];
      if (hosts && !hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) return bad(`link ${k} must go to ${hosts.join(" or ")}`);
      links[k] = u.href;
    }
    if (Object.keys(links).length) out.links = links;
  }
  return { ok: true, profile: out };
}

/** All profiles in the repository (throws on the first bad one when strict). */
export function readProfiles(root = ".", { strict = true } = {}) {
  const dir = `${root}/${PROFILES_DIR}`;
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).sort()) {
    const r = checkProfile(f, readFileSync(`${dir}/${f}`, "utf8"));
    if (!r.ok) { if (strict) throw new Error(r.why); continue; }
    out.set(r.profile.login.toLowerCase(), r.profile);
  }
  return out;
}
