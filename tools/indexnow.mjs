// Tell IndexNow search engines (Bing, Yandex, ...) about every page in the live sitemap.
// Run after a deploy: node tools/indexnow.mjs
import { readFileSync } from "node:fs";
const key = readFileSync(new URL("../site/indexnow-key.txt", import.meta.url), "utf8").trim();
const host = "proofhive.github.io";
const xml = await (await fetch(`https://${host}/sitemap.xml`)).text();
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const r = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList }),
});
console.log(r.status, urlList.length, "urls");
