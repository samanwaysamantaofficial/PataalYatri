# Pataal Yatri

The artist site for Pataal Yatri (পাতাল যাত্রী). A small build turns three inputs into a plain static website in `dist/`, which GitHub Pages publishes.

## What is where

```
PataalYatri/
├── content.json              EDIT THIS: releases, collaborators, on repeat, contact
├── art/                      DROP IMAGES HERE: they become the tunnel
│   ├── artist/               photos, portraits, logos
│   └── albums/               covers
├── src/                      the page itself
│   ├── index.html            page template: headlines, bio, layout
│   ├── 404.html
│   ├── robots.txt
│   └── assets/               css (palette at the top), js, fonts, icons
├── tools/
│   ├── build.mjs             content.json + art/ + src/  ->  dist/
│   └── serve.mjs             local preview that rebuilds on every change
├── dist/                     the finished website (made by the build; not committed)
└── .github/workflows/deploy.yml   builds and publishes on every push to master
```

## Editing content.json

Change the file, save, and either push (the deploy builds it) or run `npm run build` to check it first. If something is wrong, the build stops and names the entry and the field, for example:

```
error    releases #2 (Chita).spotify: "https://youtube.com/..." is not a Spotify link
```

The order of each list in the file is the order on the page.

### releases

Albums, EPs and singles, newest first. The first one is shown as "Latest" at the top of the page.

| field | | |
|---|---|---|
| `title` | required | |
| `bengali` | optional | the title in Bengali, shown beside it |
| `type` | optional | any word: `Album`, `EP`, `Single`... |
| `year` | optional | `2026` |
| `spotify` | optional | the release's Spotify link. Adds the listen arrow, and the cover is fetched from Spotify automatically |
| `cover` | optional | an image in `art/`, e.g. `art/albums/rasatal.jpg`. Overrides the Spotify cover |

With neither a cover nor a Spotify link, a sleeve is drawn for the release.

### collaborators

`name` (required), `role`, `on` (which release), `year`, `url` (optional link to their page; makes the card clickable).

### onRepeat

Other artists' tracks for the "On repeat" section. Six are shown at a time, picked at random, with a "Draw six more" button when there are more than six.

`artist` and `title` (required), `length` (like `3:20`), `spotify` (the track link; its cover is fetched automatically), `cover` (optional, an image in `art/`).

### contact

`email`, and `links`: a list of `{ "label": "Instagram", "url": "https://..." }`. A link with an empty `url` is listed as "Soon".

### portrait, tunnel

- `portrait`: an image in `art/` for the About section. Empty keeps the drawn figure.
- `tunnel.tint`: the colour every tunnel image is washed in, like `"#E0321F"`. `""` shows the art in its own colours.
- `tunnel.max`: the most tunnel images loaded per visit (a random selection if there are more).

### Getting a Spotify link

In Spotify: the `...` menu on the album or track > Share > Copy link. It looks like `https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj?si=...`; paste it as it is. Short `spotify.link/...` links are not accepted: open one in a browser and copy the full address instead.

Covers are looked up from Spotify when the site is built, not when someone visits. A release that is not out yet has no public cover, so it gets a drawn sleeve until it is, and the next build after release picks the cover up.

### Notes inside the file

JSON has no comments. Any key starting with `_`, such as `"_note": "..."`, is ignored, so use that for notes to yourself. Unknown keys (usually typos) are reported as warnings.

## Adding art to the tunnel

Put images in `art/artist/` or `art/albums/` (JPG, PNG, WebP, AVIF, GIF; any shape; PNG transparency is kept) and push. Every image under `art/` goes into the tunnel; the folder names are only for your tidiness. Names starting with `_` or `.` are skipped.

The build saves an 800px copy of each image, and only those copies are published, so full-size originals are fine to drop in. That shrinking needs `npm install` to have been run once; without it, the build still works but publishes the originals.

With no images, the tunnel flies through drawn placeholder sleeves.

## Previewing on your machine

Needs Node 20 or newer. Once:

```
npm install
```

Then:

```
npm run dev
```

Open http://localhost:4173. The preview rebuilds whenever `content.json`, `art/` or `src/` changes; refresh the browser to see it. If `content.json` has a mistake, the error is printed in the terminal and the last good version stays up.

`npm run build` alone just writes `dist/`.

## Publishing on GitHub Pages

One-time setup: in the repository, **Settings > Pages > Build and deployment > Source: GitHub Actions**.

After that, every push to `master` builds and publishes. Pushing to `develop` does nothing, so you can work there and merge when ready. Progress and any build errors are under the **Actions** tab. A mistake in `content.json` fails the build and the live site stays as it was.

### The custom domain

1. **Settings > Pages > Custom domain**: enter the domain and save.
2. At the domain registrar, add the DNS records:
   - For `www.example.com`: a `CNAME` record pointing `www` to `samanwaysamantaofficial.github.io`.
   - For the bare domain `example.com`: four `A` records pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`.
3. Once GitHub shows the DNS check as passed, tick **Enforce HTTPS**.

No `CNAME` file is needed in the repository; with the GitHub Actions source the domain is stored in the Pages settings.

Every path in the site is relative, so it works the same at the custom domain and at the temporary `github.io/PataalYatri/` address. The one exception is `404.html`, which assumes the site sits at the root of its domain.

When the domain is settled, add these to the `<head>` of `src/index.html`:

```html
<link rel="canonical" href="https://YOUR-DOMAIN/">
<meta property="og:url" content="https://YOUR-DOMAIN/">
<meta property="og:image" content="https://YOUR-DOMAIN/assets/icons/share.jpg">
```

`share.jpg` is the picture shown when the link is posted on social media or in a chat: a 1200 x 630 image you add to `src/assets/icons/`.

## Fonts

Anek Bangla (Ek Type), under the SIL Open Font License; the licence text is in `src/assets/fonts/OFL.txt`. It draws Bengali and Latin as one design, so পাতাল যাত্রী and PATAAL YATRI match.
