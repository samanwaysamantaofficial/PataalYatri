#!/usr/bin/env node
/* Builds the website into dist/ from three inputs:

     content.json   releases, collaborators, on repeat, contact, tunnel settings
     art/           images for the tunnel, covers and the portrait
     src/           the page template, styles, scripts and fonts

   npm run build

   content.json is checked first; a mistake stops the build with a message
   saying where it is. Spotify links are turned into cover art at build time,
   so the published page never has to ask Spotify for anything. */
import { readFile, writeFile, readdir, stat, mkdir, rm, cp, copyFile } from "node:fs/promises";
import { join, dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = join(dirname(HERE), "..");
export const PATHS = {
  root: ROOT,
  content: join(ROOT, "content.json"),
  art: join(ROOT, "art"),
  src: join(ROOT, "src"),
  dist: join(ROOT, "dist"),
  cache: join(ROOT, ".cache")
};

const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);
const SMALL_EDGE = 800;                    // longest side of a tunnel copy, px
const HEAVY = 1.5 * 1024 * 1024;           // originals above this get a warning when they cannot be shrunk
const SPOTIFY_TTL = 24 * 3600 * 1000;      // how long a looked-up cover is trusted locally

/* ---------------------------------------------------------- helpers */
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad2 = (n) => String(n).padStart(2, "0");
const urlPath = (rel) => rel.split("/").map(encodeURIComponent).join("/");

async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

/* ---------------------------------------------------------- 1. read and check content.json */
const SPOTIFY = /^(?:https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|artist|playlist|episode|show)\/([A-Za-z0-9]{22})|spotify:(track|album|artist|playlist|episode|show):([A-Za-z0-9]{22}))(?:[/?#].*)?$/i;

function checker(errors, warnings, art) {
  const c = {
    obj(x, at, keys) {
      if (!x || typeof x !== "object" || Array.isArray(x)) { errors.push(`${at}: should be an object, written { ... }`); return false; }
      for (const k of Object.keys(x)) {
        if (!k.startsWith("_") && !keys.includes(k)) warnings.push(`${at}.${k}: unknown field, ignored. Expected one of: ${keys.join(", ")}`);
      }
      return true;
    },
    list(x, at) {
      if (x == null) return [];
      if (!Array.isArray(x)) { errors.push(`${at}: should be a list, written [ ... ]`); return []; }
      return x;
    },
    text(x, at, required) {
      if (x == null || (typeof x === "string" && !x.trim())) {
        if (required) errors.push(`${at}: is required`);
        return "";
      }
      if (typeof x !== "string" && typeof x !== "number") { errors.push(`${at}: should be text in quotes`); return ""; }
      return String(x).trim();
    },
    year(x, at) {
      if (x == null || x === "") return "";
      const n = Number(x);
      if (!Number.isInteger(n) || n < 1900 || n > 2200) { errors.push(`${at}: "${x}" is not a year`); return ""; }
      return n;
    },
    web(x, at) {
      const s = c.text(x, at);
      if (!s) return "";
      try {
        const u = new URL(s);
        if (u.protocol === "https:" || u.protocol === "http:") return u.href;
      } catch { /* fall through */ }
      errors.push(`${at}: "${s}" is not a web link (it should start with https://)`);
      return "";
    },
    spotify(x, at) {
      const s = c.text(x, at);
      if (!s) return "";
      const m = s.match(SPOTIFY);
      if (m) return `https://open.spotify.com/${(m[1] || m[3]).toLowerCase()}/${m[2] || m[4]}`;
      if (/spotify\.link|spoti\.fi/i.test(s)) errors.push(`${at}: short links like "${s}" cannot be read. Open it, then copy the full open.spotify.com link`);
      else errors.push(`${at}: "${s}" is not a Spotify link. Use Share > Copy link in Spotify; it looks like https://open.spotify.com/track/...`);
      return "";
    },
    /* a path to an image in art/, written with or without the leading "art/" */
    image(x, at) {
      const s = c.text(x, at);
      if (!s) return "";
      const rel = s.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^art\//i, "");
      if (art.has(rel)) return art.get(rel);
      const near = [...art.keys()].find((k) => k.toLowerCase() === rel.toLowerCase());
      if (near) errors.push(`${at}: "${s}" does not match the file's capitals. The file is art/${near} (the live site cares about capitals even if your computer does not)`);
      else errors.push(`${at}: there is no file art/${rel}`);
      return "";
    }
  };
  return c;
}

/* "releases #2 (Chita)": entries are counted from 1, and named when they have a name */
const where = (list, i, name) => `${list} #${i + 1}` + (typeof name === "string" && name.trim() ? ` (${name.trim()})` : "");

export function readContent(json, art) {
  const errors = [], warnings = [];
  let raw;
  try { raw = JSON.parse(json); }
  catch (e) {
    errors.push(`content.json is not valid JSON: ${e.message}. Common causes: a missing comma between entries, a comma after the last entry, or curly quotes instead of straight ones`);
    return { errors, warnings };
  }
  const c = checker(errors, warnings, art);
  if (!c.obj(raw, "content.json", ["releases", "collaborators", "onRepeat", "contact", "portrait", "tunnel"])) return { errors, warnings };

  const releases = c.list(raw.releases, "releases").map((r, i) => {
    const at = where("releases", i, r && r.title);
    if (!c.obj(r, at, ["title", "bengali", "type", "year", "spotify", "cover"])) return null;
    return {
      title: c.text(r.title, `${at}.title`, true),
      bengali: c.text(r.bengali, `${at}.bengali`),
      type: c.text(r.type, `${at}.type`),
      year: c.year(r.year, `${at}.year`),
      spotify: c.spotify(r.spotify, `${at}.spotify`),
      cover: c.image(r.cover, `${at}.cover`)
    };
  }).filter(Boolean);

  const collaborators = c.list(raw.collaborators, "collaborators").map((p, i) => {
    const at = where("collaborators", i, p && p.name);
    if (!c.obj(p, at, ["name", "role", "on", "year", "url"])) return null;
    return {
      name: c.text(p.name, `${at}.name`, true),
      role: c.text(p.role, `${at}.role`),
      on: c.text(p.on, `${at}.on`),
      year: c.year(p.year, `${at}.year`),
      url: c.web(p.url, `${at}.url`)
    };
  }).filter(Boolean);

  const onRepeat = c.list(raw.onRepeat, "onRepeat").map((t, i) => {
    const at = where("onRepeat", i, t && t.title);
    if (!c.obj(t, at, ["artist", "title", "length", "spotify", "cover"])) return null;
    const length = c.text(t.length, `${at}.length`);
    if (length && !/^\d{1,3}:[0-5]\d$/.test(length)) errors.push(`${at}.length: "${length}" should look like 3:20`);
    return {
      artist: c.text(t.artist, `${at}.artist`, true),
      title: c.text(t.title, `${at}.title`, true),
      length,
      spotify: c.spotify(t.spotify, `${at}.spotify`),
      cover: c.image(t.cover, `${at}.cover`)
    };
  }).filter(Boolean);

  const contact = { email: "", links: [] };
  if (raw.contact != null && c.obj(raw.contact, "contact", ["email", "links"])) {
    contact.email = c.text(raw.contact.email, "contact.email");
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      errors.push(`contact.email: "${contact.email}" is not an email address`);
      contact.email = "";
    }
    contact.links = c.list(raw.contact.links, "contact.links").map((l, i) => {
      const at = where("contact.links", i, l && l.label);
      if (!c.obj(l, at, ["label", "url"])) return null;
      return { label: c.text(l.label, `${at}.label`, true), url: c.web(l.url, `${at}.url`) };
    }).filter(Boolean);
  }

  const tunnel = { tint: "#E0321F", max: 60 };
  if (raw.tunnel != null && c.obj(raw.tunnel, "tunnel", ["tint", "max"])) {
    if ("tint" in raw.tunnel) {
      const t = raw.tunnel.tint;
      if (t === "" || t === null) tunnel.tint = "";
      else if (typeof t === "string" && /^#[0-9a-f]{6}$/i.test(t.trim())) tunnel.tint = t.trim();
      else errors.push(`tunnel.tint: "${t}" should be a colour like "#E0321F", or "" for the art's own colours`);
    }
    if ("max" in raw.tunnel) {
      const n = Number(raw.tunnel.max);
      if (Number.isInteger(n) && n > 0) tunnel.max = n;
      else errors.push(`tunnel.max: "${raw.tunnel.max}" should be a whole number above 0`);
    }
  }

  const portrait = c.image(raw.portrait, "portrait");
  return { errors, warnings, content: { releases, collaborators, onRepeat, contact, tunnel, portrait } };
}

/* ---------------------------------------------------------- 2. art: small copies into dist/art */
async function buildArt(log) {
  let sharp = null;
  try { sharp = (await import("sharp")).default; } catch { /* optional */ }
  const cacheDir = join(PATHS.cache, "art");
  const used = new Set();
  const map = new Map();                   // "albums/x.jpg" -> "art/albums/x.jpg.webp"
  const files = (await walk(PATHS.art)).filter((p) => IMAGE.has(extname(p).toLowerCase()));

  for (const path of files) {
    const rel = relative(PATHS.art, path).split(sep).join("/");
    const info = await stat(path);
    let from = path, outRel = rel;
    if (sharp) {
      /* the cache name carries the original's size and date, so a replaced file is redone */
      const cached = join(cacheDir, `${rel}.${info.size}-${Math.round(info.mtimeMs)}.webp`);
      used.add(cached);
      try {
        if (!(await stat(cached).catch(() => null))) {
          await mkdir(dirname(cached), { recursive: true });
          await sharp(path)
            .rotate()
            .resize({ width: SMALL_EDGE, height: SMALL_EDGE, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 74 })
            .toFile(cached);
        }
        from = cached; outRel = rel + ".webp";
      } catch (err) {
        log.warnings.push(`art/${rel}: could not be shrunk (${err.message}); the original is used`);
      }
    }
    if (from === path && info.size > HEAVY) {
      log.warnings.push(`art/${rel}: ${(info.size / 1048576).toFixed(1)} MB will be sent to visitors at full size. Run \`npm install\` so the build can shrink it`);
    }
    const dest = join(PATHS.dist, "art", ...outRel.split("/"));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(from, dest);
    map.set(rel, "art/" + urlPath(outRel));
  }
  if (sharp) for (const p of await walk(cacheDir)) if (!used.has(p)) await rm(p, { force: true });
  return { map, shrunk: !!sharp };
}

/* the art folder's file list, without processing anything (used to check content.json first) */
async function listArt() {
  const map = new Map();
  for (const p of await walk(PATHS.art)) {
    if (IMAGE.has(extname(p).toLowerCase())) map.set(relative(PATHS.art, p).split(sep).join("/"), true);
  }
  return map;
}

/* ---------------------------------------------------------- 3. covers from Spotify */
async function spotifyCovers(links, log) {
  const file = join(PATHS.cache, "spotify.json");
  let cache = {};
  try { cache = JSON.parse(await readFile(file, "utf8")); } catch { /* first run */ }
  const now = Date.now();
  const todo = [...new Set(links)].filter((u) => !(cache[u] && now - cache[u].at < SPOTIFY_TTL));
  let failed = 0;
  await Promise.all(todo.map(async (u) => {
    try {
      const r = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(u), { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (!j.thumbnail_url || !/^https:\/\//.test(j.thumbnail_url)) throw new Error("no cover");
      cache[u] = { cover: j.thumbnail_url, at: now };
    } catch {
      failed++;
    }
  }));
  if (failed) log.warnings.push(`Spotify: ${failed} cover${failed === 1 ? "" : "s"} could not be fetched (offline, or the link is private or not out yet). Drawn sleeves are used for those`);
  if (todo.length) {
    await mkdir(PATHS.cache, { recursive: true });
    await writeFile(file, JSON.stringify(cache, null, 1));
  }
  return (u) => (cache[u] && cache[u].cover) || "";
}

/* ---------------------------------------------------------- 4. HTML */
const ARROW = "&#8599;";
const ext = (href, label, cls, body) => `<a class="${cls}" href="${h(href)}" target="_blank" rel="noopener" aria-label="${h(label)}">${body}</a>`;

function renderRelease(r) {
  const label = [r.type, r.year].filter(Boolean).join(", ");
  return `<article class="rel fade">
        <span class="rel-y">${h(r.year)}</span>
        <span class="rel-th"><canvas width="160" height="160" data-sleeve="${h(r.title)}"></canvas>${r.cover ? `<img src="${h(r.cover)}" alt="" loading="lazy">` : ""}</span>
        <span><h3 class="rel-t">${h(r.title)}</h3></span>
        <span class="rel-bn" lang="bn">${h(r.bengali)}</span>
        <span class="rel-meta">${h(r.type)}</span>
        ${r.spotify ? ext(r.spotify, `Listen to ${r.title}${label ? ` (${label})` : ""} on Spotify`, "rel-go", ARROW) : "<span></span>"}
      </article>`;
}

function renderCollaborator(p) {
  const inner = `<span class="cb-y">${h(p.year)}</span><h3 class="cb-n">${h(p.name)}</h3><span class="cb-r">${h(p.role)}</span>${p.on ? `<span class="cb-on">on <b>${h(p.on)}</b></span>` : ""}`;
  return p.url
    ? `<a class="cb fade" href="${h(p.url)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="cb fade">${inner}</div>`;
}

function renderTrack(t, i) {
  return `<article class="trk fade" data-i="${i}" tabindex="0" aria-label="${h(t.title)} by ${h(t.artist)}">
          <span><h3 class="trk-t">${h(t.title)}</h3><span class="trk-a">${h(t.artist)}</span></span>
          <span class="trk-len">${h(t.length)}</span>
          ${t.spotify ? ext(t.spotify, `Open ${t.title} on Spotify`, "trk-go", ARROW) : "<span></span>"}
        </article>`;
}

function renderLines(contact) {
  const rows = [];
  if (contact.email) rows.push(`<li><a class="line" href="mailto:${h(contact.email)}">Email <em>${h(contact.email)}</em></a></li>`);
  for (const l of contact.links) {
    rows.push(l.url
      ? `<li><a class="line" href="${h(l.url)}" target="_blank" rel="noopener">${h(l.label)} <em>Open ${ARROW}</em></a></li>`
      : `<li><span class="line">${h(l.label)} <em>Soon</em></span></li>`);
  }
  return rows.join("\n          ");
}

/* <!-- if:name --> ... <!-- endif:name --> keeps or drops a block;
   <!-- build:name --> is replaced with generated HTML */
function fill(template, flags, parts) {
  let out = template, before;
  do {                                     /* repeat, so blocks inside blocks are resolved too */
    before = out;
    out = out.replace(/<!--\s*if:(\w+)\s*-->([\s\S]*?)<!--\s*endif:\1\s*-->/g, (_, name, body) => {
      if (!(name in flags)) throw new Error(`src/index.html: unknown block if:${name}`);
      return flags[name] ? body : "";
    });
  } while (out !== before);
  out = out.replace(/<!--\s*build:(\w+)\s*-->/g, (_, name) => {
    if (!(name in parts)) throw new Error(`src/index.html: unknown marker build:${name}`);
    return parts[name];
  });
  const left = out.match(/<!--\s*(?:if|endif|build):\w+\s*-->/);
  if (left) throw new Error(`src/index.html: ${left[0]} has no partner`);
  return out;
}

/* ---------------------------------------------------------- the build */
export async function build() {
  const log = { errors: [], warnings: [] };
  const json = await readFile(PATHS.content, "utf8").catch(() => null);
  if (json === null) return { ...log, errors: ["content.json is missing from the project folder"] };

  /* check the content against the art folder before touching dist/ */
  const first = readContent(json.replace(/^\uFEFF/, ""), await listArt());
  log.warnings.push(...first.warnings);
  if (first.errors.length) return { ...log, errors: first.errors };

  await rm(PATHS.dist, { recursive: true, force: true, maxRetries: 4 });
  await mkdir(PATHS.dist, { recursive: true });
  const template = join(PATHS.src, "index.html");          /* filled in below, not copied */
  await cp(PATHS.src, PATHS.dist, { recursive: true, filter: (p) => resolve(p) !== template });
  const art = await buildArt(log);

  /* the same content again, now with the real image addresses */
  const { content } = readContent(json.replace(/^\uFEFF/, ""), art.map);
  const cover = await spotifyCovers(
    [...content.releases, ...content.onRepeat].filter((x) => x.spotify && !x.cover).map((x) => x.spotify),
    log
  );
  let fromSpotify = 0;
  for (const x of [...content.releases, ...content.onRepeat]) {
    if (!x.cover && x.spotify && (x.cover = cover(x.spotify))) fromSpotify++;
  }

  const { releases, collaborators, onRepeat, contact, tunnel, portrait } = content;
  const latest = releases[0];
  const data = {
    tunnel: { tint: tunnel.tint, max: tunnel.max, images: [...art.map.values()] },
    seeds: [...releases.map((r) => r.title), ...collaborators.map((p) => p.name)],
    portrait,
    email: contact.email,
    onRepeat: onRepeat.map((t) => ({ artist: t.artist, title: t.title, length: t.length, spotify: t.spotify, cover: t.cover }))
  };

  const html = fill(await readFile(template, "utf8"), {
    releases: releases.length > 0,
    latest: releases.length > 0,
    collaborators: collaborators.length > 0,
    onRepeat: onRepeat.length > 0,
    redraw: onRepeat.length > 6,
    share: await stat(join(PATHS.src, "assets", "icons", "share.jpg")).then(() => true, () => false)
  }, {
    latest: latest ? h(latest.title) + (latest.type || latest.year ? ` (${h([latest.type, latest.year].filter(Boolean).join(", "))})` : "") : "",
    releases: releases.map(renderRelease).join("\n      "),
    collaborators: collaborators.map(renderCollaborator).join("\n      "),
    onRepeat: onRepeat.slice(0, 6).map(renderTrack).join("\n        "),
    lines: renderLines(contact),
    factReleases: `<dd data-count="${releases.length}" data-pad="2">${pad2(releases.length)}</dd>`,
    factCollaborators: `<dd data-count="${collaborators.length}" data-pad="2">${pad2(collaborators.length)}</dd>`,
    year: String(new Date().getFullYear()),
    data: `<script id="py-data" type="application/json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`
  });
  await writeFile(join(PATHS.dist, "index.html"), html);

  const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  log.summary = [
    n(releases.length, "release"),
    n(collaborators.length, "collaborator"),
    `${onRepeat.length} on repeat`,
    n(art.map.size, "art image") + (art.map.size && !art.shrunk ? " (not shrunk: run `npm install`)" : ""),
    `${fromSpotify} cover${fromSpotify === 1 ? "" : "s"} from Spotify`
  ].join(", ");
  return log;
}

export function report(r) {
  for (const w of r.warnings) console.warn(`  warning  ${w}`);
  for (const e of r.errors) console.error(`  error    ${e}`);
  if (r.errors.length) console.error(`\nNot built: fix the ${r.errors.length === 1 ? "error" : `${r.errors.length} errors`} above in content.json and run it again.`);
  else console.log(`built dist/: ${r.summary}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === HERE.toLowerCase();
if (isMain) {
  build().then((r) => { report(r); process.exit(r.errors.length ? 1 : 0); })
    .catch((err) => { console.error(err.message || err); process.exit(1); });
}
