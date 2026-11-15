#!/usr/bin/env node
/* Local preview. Builds the site, serves dist/ at http://localhost:4173, and
   rebuilds whenever content.json, art/ or src/ changes. Refresh to see it.
   If content.json has a mistake, the error is printed and the last good
   build stays up.

   npm run dev            (PORT=5000 npm run dev for another port) */
import { createServer } from "node:http";
import { createReadStream, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { join, normalize, extname, sep } from "node:path";
import { PATHS, build, report } from "./build.mjs";

const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

/* ---- rebuild on change, one build at a time ---- */
let running = false, again = false, timer = null;
async function rebuild(why) {
  if (running) { again = true; return; }
  running = true;
  if (why) console.log(`\n${why} changed, rebuilding...`);
  try { report(await build()); }
  catch (err) { console.error(`  error    ${err.message || err}`); }
  running = false;
  if (again) { again = false; rebuild("more"); }
}
function soon(why) { clearTimeout(timer); timer = setTimeout(() => rebuild(why), 200); }

watch(PATHS.root, (_, name) => { if (name === "content.json") soon("content.json"); });
for (const dir of [PATHS.art, PATHS.src]) {
  try { watch(dir, { recursive: true }, (_, name) => soon(`${dir === PATHS.art ? "art" : "src"}/${String(name || "").split(sep).join("/")}`)); }
  catch (err) { console.warn(`  warning  cannot watch ${dir} (${err.message}); restart to pick up changes there`); }
}

/* ---- serve dist/ ---- */
async function send(res, file, status = 200) {
  const s = await stat(file).catch(() => null);
  if (!s || !s.isFile()) return false;
  res.writeHead(status, {
    "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
    "content-length": s.size,
    "cache-control": "no-store"
  });
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
  return true;
}

await rebuild();
createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(PATHS.dist, path));
    if (!file.startsWith(PATHS.dist + sep)) { res.writeHead(403); return res.end("Forbidden"); }
    if (await send(res, file)) return;
    if (await send(res, join(PATHS.dist, "404.html"), 404)) return;
    res.writeHead(404); res.end("Not found");
  } catch {
    res.writeHead(400); res.end("Bad request");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`\nPataal Yatri preview: http://localhost:${PORT}`);
  console.log("Edit content.json, or drop images into art/, then refresh. Ctrl+C to stop.");
});
