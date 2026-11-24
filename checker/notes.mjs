// Research notes: notes/<record-id>/<handle>-<slug>.md. Shared by the gate, the site build and the simulation.
// A note is plain Markdown with a fixed header and six sections. No HTML, no scripts; links must be https.
// Everything is escaped when the site renders it.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";

export const NOTES_DIR = "notes";
export const NOTE_MAX_BYTES = 20480;
export const NOTE_SECTIONS = ["Problem in plain words", "Known results", "Attack routes", "Where each route is stuck", "Candidate splits", "Open questions"];
// Scholarly hosts, for reference only: any https link is allowed.
export const NOTE_HOSTS = ["arxiv.org", "doi.org", "dx.doi.org", "github.com", "link.springer.com", "www.sciencedirect.com",
  "www.cambridge.org", "onlinelibrary.wiley.com", "www.ams.org", "msp.org", "cs.uwaterloo.ca", "projecteuclid.org",
  "www.jstor.org", "academic.oup.com", "www.worldscientific.com", "eudml.org", "zbmath.org", "www.impan.pl", "londmathsoc.onlinelibrary.wiley.com"];
// File name: <GitHub login>-<slug>.md. Logins and slugs may both contain hyphens, so the login is taken from
// the "Author: @login" line, and the file name must start with exactly "<login>-".
const FILE_SHAPE = /^[A-Za-z0-9-]{1,39}-[a-z0-9-]{1,60}\.md$/;
const FILE_RULE = "the file name must be <your GitHub login>-<slug>.md: the login exactly as on the Author line, then a hyphen, then a slug of 1-60 lowercase letters, digits or hyphens";
export const NOTE_DATE_SLACK_DAYS = 7;
const ID_RE = /^[a-z0-9-]{1,60}$/;


/** Checks one note. Returns {ok: true, note} or {ok: false, why}. */
export function checkNote(recordId, fileName, text, bytes) {
  const where = `${NOTES_DIR}/${recordId}/${fileName}`;
  const bad = (why) => ({ ok: false, why: `${where}: ${why}` });
  if (!ID_RE.test(recordId)) return bad("the folder must be a record id");
  if (!FILE_SHAPE.test(fileName)) return bad(FILE_RULE);
  if (bytes > NOTE_MAX_BYTES) return bad(`a note is at most ${NOTE_MAX_BYTES} bytes, this one is ${bytes}`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/.test(text)) return bad("control or bidi characters are not allowed");
  if (/<[A-Za-z!\/?]/.test(text)) return bad('HTML is not allowed: "<" may not be followed directly by a letter, "!", "/" or "?" (write "x < n" with spaces)');
  if (/javascript:|data:|vbscript:/i.test(text)) return bad('"javascript:", "data:" and "vbscript:" may not appear anywhere');
  const lines = text.split(/\r?\n/);
  if (!/^# \S/.test(lines[0] || "")) return bad('the first line must be the title, "# ..."');
  const head = lines.slice(1, 10).join("\n");
  const rec = /^Record: ([a-z0-9-]+)\s*$/m.exec(head), au = /^Author: @([A-Za-z0-9-]{1,39})\s*$/m.exec(head), da = /^Date: (\d{4}-\d{2}-\d{2})\s*$/m.exec(head);
  if (!rec || rec[1] !== recordId) return bad(`a line "Record: ${recordId}" must follow the title`);
  if (!au) return bad('a line "Author: @<your GitHub login>" must follow the title');
  const login = au[1], slug = fileName.slice(login.length + 1, -3);
  if (fileName.slice(0, login.length + 1).toLowerCase() !== (login + "-").toLowerCase() || !/^[a-z0-9-]{1,60}$/.test(slug))
    return bad(`${FILE_RULE}; expected "${login}-<slug>.md"`);
  if (!da || !Number.isFinite(Date.parse(da[1] + "T00:00:00Z"))) return bad('a line "Date: YYYY-MM-DD" must follow the title');
  // Sections, in order, each with some text.
  const heads = lines.map((l, i) => [l, i]).filter(([l]) => /^## /.test(l));
  const names = heads.map(([l]) => l.slice(3).trim());
  let at = -1;
  for (const want of NOTE_SECTIONS) {
    const k = names.indexOf(want);
    if (k < 0) return bad(`missing section "## ${want}"`);
    if (k <= at) return bad(`section "## ${want}" is out of order`);
    at = k;
  }
  const section = (name) => {
    const k = names.indexOf(name), from = heads[k][1] + 1, to = k + 1 < heads.length ? heads[k + 1][1] : lines.length;
    return lines.slice(from, to).join("\n");
  };
  for (const name of NOTE_SECTIONS) if (section(name).replace(/\s+/g, "").length < 20) return bad(`section "## ${name}" needs at least 20 non-space characters`);
  // Links: https only.
  for (const m of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)\]>]+/gi)) {
    let u;
    try { u = new URL(m[0]); } catch { return bad(`bad link ${m[0].slice(0, 80)}`); }
    if (u.protocol !== "https:") return bad(`links must be https: ${m[0].slice(0, 80)}`);
  }
  const known = section("Known results");
  if (!/https:\/\/(arxiv\.org|(dx\.)?doi\.org)\//.test(known)) return bad('"## Known results" needs at least one arXiv or DOI link');
  const md = /^Model: ([A-Za-z0-9 ._+-]{1,40})\s*$/m.exec(head), tl = /^Tool: ([A-Za-z0-9 ._+-]{1,40})\s*$/m.exec(head);
  if (/^Model: /m.test(head) && !md) return bad('the "Model:" line may use letters, digits, spaces and ._+- (max 40)');
  if (/^Tool: /m.test(head) && !tl) return bad('the "Tool:" line may use letters, digits, spaces and ._+- (max 40)');
  return { ok: true, note: { record: recordId, who: login, model: md ? md[1].trim() : "", tool: tl ? tl[1].trim() : "", date: da[1], title: lines[0].slice(2).trim().slice(0, 160), file: fileName, path: where } };
}

/** All notes in the repository (throws on the first bad one when strict). */
export function readNotes(root = ".", { strict = true } = {}) {
  const dir = `${root}/${NOTES_DIR}`;
  const out = [];
  if (!existsSync(dir)) return out;
  for (const rid of readdirSync(dir).sort()) {
    const sub = `${dir}/${rid}`;
    if (!statSync(sub).isDirectory()) { if (strict) throw new Error(`${NOTES_DIR}/${rid}: only folders named by record id go here`); continue; }
    for (const f of readdirSync(sub).sort()) {
      const buf = readFileSync(`${sub}/${f}`);
      const r = checkNote(rid, f, buf.toString("utf8"), buf.length);
      if (!r.ok) { if (strict) throw new Error(r.why); continue; }
      out.push({ ...r.note, text: buf.toString("utf8") });
    }
  }
  return out;
}
