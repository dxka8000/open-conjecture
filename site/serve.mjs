// Tiny local preview server for dist/. Usage: node site/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.argv[2] || 4173);
const types = { ".html": "text/html; charset=utf-8", ".json": "application/json" };
createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[\/\\]+/, "");
  if (p === "" || p.endsWith("/") || p.endsWith("\\")) p += "index.html";
  if (p.includes("..")) { res.writeHead(400).end(); return; }
  try { const b = await readFile(join(dist, p)); res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }).end(b); }
  catch { res.writeHead(404).end("not found"); }
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
