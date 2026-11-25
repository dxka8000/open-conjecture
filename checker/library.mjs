// The open-problem library (site/library/library.json, built by tools/build_library.mjs) as research-note targets.
// Every library problem gets a folder name that is legal everywhere: notes/<folder>/<login>-<slug>.md.
// Library ids contain ":", ".", "_", capitals and Unicode, and differ only in case or symbols, so the folder is a
// readable slug plus 6 hex digits of the id's SHA-256: "fc:green_27.equivalent" -> "lib-green-27-equivalent-xxxxxx".
// Board problems ("ph:<record id>") keep their record id as the folder.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

export const LIBRARY_FILE = "site/library/library.json";

/** The notes folder for a library id. Always matches ^[a-z0-9-]{1,60}$. */
export function libFolder(id) {
  id = String(id);
  if (id.startsWith("ph:")) return id.slice(3);
  const slug = id.slice(id.indexOf(":") + 1).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 44).replace(/-+$/, "") || "x";
  return `lib-${slug}-${createHash("sha256").update(id).digest("hex").slice(0, 6)}`;
}

/** Library problems that are not board records: Map folder -> entry (with .folder). Empty when there is no library. */
export function readLibrary(root = ".") {
  const out = new Map();
  const f = `${root}/${LIBRARY_FILE}`;
  if (!existsSync(f)) return out;
  let d;
  try { d = JSON.parse(readFileSync(f, "utf8")); } catch { return out; }
  for (const e of Array.isArray(d && d.entries) ? d.entries : []) {
    if (!e || typeof e.id !== "string" || e.id.startsWith("ph:")) continue;
    const folder = libFolder(e.id);
    if (out.has(folder)) throw new Error(`library: ${e.id} and ${out.get(folder).id} share the notes folder ${folder}`);
    out.set(folder, { ...e, folder });
  }
  return out;
}
