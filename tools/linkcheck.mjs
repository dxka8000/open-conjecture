// Link audit for the built site: every internal href/src in dist/**/*.html must point at a file that exists, and
// every #anchor must name an id on the target page. External links (https:, mailto:) are not fetched.
// Usage: node tools/linkcheck.mjs [dist]   (exit 1 and a list when anything is broken)
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export function auditLinks(dist) {
  const pages = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".html")) pages.push(p); } };
  walk(dist);
  const idsCache = new Map();
  const idsOf = (file) => {
    if (!idsCache.has(file)) idsCache.set(file, new Set([...readFileSync(file, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
    return idsCache.get(file);
  };
  const broken = [];
  let checked = 0;
  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    // Attributes only, not text inside scripts: strip <script> bodies first.
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    for (const m of markup.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const raw = m[1].replace(/&amp;/g, "&");
      if (!raw || /^(https?:|mailto:|data:|javascript:)/i.test(raw)) continue;
      checked++;
      const [pathPart, anchor = ""] = raw.split("#");
      const path = pathPart.split("?")[0];
      let target = path ? normalize(join(dirname(page), decodeURIComponent(path))) : page;
      if (path.endsWith("/") || (existsSync(target) && statSync(target).isDirectory())) target = join(target, "index.html");
      const from = relative(dist, page).split(sep).join("/");
      if (!relative(dist, target) || relative(dist, target).startsWith("..")) { broken.push(`${from}: ${raw} leaves the site`); continue; }
      if (!existsSync(target)) { broken.push(`${from}: ${raw} (no such file)`); continue; }
      if (anchor && target.endsWith(".html") && !idsOf(target).has(decodeURIComponent(anchor))) broken.push(`${from}: ${raw} (no id "${anchor}")`);
    }
  }
  // Links the library page builds in the browser from library/library.json: each entry's page and internal links.
  const libFile = join(dist, "library", "library.json");
  if (existsSync(libFile)) {
    for (const e of JSON.parse(readFileSync(libFile, "utf8")).entries || []) {
      for (const raw of [e.page, ...(e.links || []).map((l) => l && l.url)]) {
        if (typeof raw !== "string" || !raw || /^https?:/i.test(raw)) continue;
        checked++;
        const [path, anchor = ""] = raw.split("#");
        const target = join(dist, path);
        if (!existsSync(target)) { broken.push(`library.json ${e.id}: ${raw} (no such file)`); continue; }
        if (anchor && !idsOf(target).has(anchor)) broken.push(`library.json ${e.id}: ${raw} (no id "${anchor}")`);
      }
    }
    if (!existsSync(join(dist, "agent.md"))) broken.push("library.html: agent.md (no such file)");
  }
  return { pages: pages.length, checked, broken };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const dist = process.argv[2] || "dist";
  const r = auditLinks(dist);
  for (const b of r.broken) console.log("BROKEN " + b);
  console.log(`link audit: ${r.pages} pages, ${r.checked} internal links, ${r.broken.length} broken`);
  process.exit(r.broken.length ? 1 : 0);
}
