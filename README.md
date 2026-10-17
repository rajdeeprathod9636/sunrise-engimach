# Sunrise Engimach — website

A static, ready-to-deploy website for **Sunrise Engimach**, a CNC turning unit in Vavdi, Rajkot (Gujarat). Plain HTML, CSS and JavaScript (ES modules) — **no build step**.

- **Home** (`index.html`): a cinematic scroll story on a slant-bed CNC turning centre. The door closes, the spindle spins up, the turret indexes, a hot-rolled bar is faced, turned, grooved and threaded (chips and coolant included), then the part is measured on a granite surface plate and shown in a studio pose. Scrolling backwards reverses the machining exactly.
- **About** (`about.html`): company story, founder note, mission/vision/values, why Rajkot, commitments — with the finished part turning in 3D.
- **Services** (`services.html`): operations, materials, machine capability cards, typical parts (photoreal renders).
- **Contact** (`contact.html`): quote form that opens a pre-filled WhatsApp message, both phone numbers, the address, a map and Get Directions.

Libraries load from CDNs with pinned versions: three.js 0.169.0, postprocessing 6.37.8, N8AO 1.10.1, detect-gpu 5.0.70 (jsDelivr), GSAP 3.12.5 + ScrollTrigger (cdnjs), Lenis 1.1.13 (unpkg), Google Fonts (Space Grotesk + Inter). See [CREDITS.md](CREDITS.md).

---

## 1. Edit your business details: `assets/js/config.js`

All business data lives in **one file**. Open `assets/js/config.js` in any text editor and change the values in quotes. Every page reads it when it loads.

| What | Key in `config.js` | Notes |
|---|---|---|
| Phone numbers | `contact.phones` | A list. Each entry has `label`, `display` (shown) and `tel` (dialled, e.g. `+919510654646`). The **first** is the primary number (header, SEO `telephone`); others appear everywhere both numbers are listed and in the SEO `contactPoint`. Delete an entry and its slots disappear from every page. |
| WhatsApp number | `contact.whatsappNumber` | Digits only, with country code: `919510654646`. Used by the quote form, the floating button and every WhatsApp button. |
| WhatsApp greeting | `contact.whatsappGreeting` | Pre-filled text for the WhatsApp buttons. |
| Address (display) | `location.addressLines` | One entry per line, shown on the contact page and footer. |
| Address (SEO) | `location.streetAddress`, `locality`, `region`, `postalCode`, `countryCode` | Used in the Google-readable business schema. |
| Map search | `location.mapQuery` | What the map and Get Directions search for while there are no coordinates. |
| Map pin | `location.lat`, `location.lng` | `null` for now — see below. |
| Founded year | `company.foundedYear` | e.g. `2026`. |
| Machine specs | `machine.*` | `machineType`, `maxTurningDiameter`, `maxTurningLength`, `typicalTolerance`, `batchSize`. |
| Form dropdowns | `services`, `materials` | Options in the quote form. |
| Website address | `site.url` | Your live domain, used in the SEO schema. |

The HTML files also contain the current numbers and address as plain text, so the page is correct even before JavaScript runs. If you change a number or the address, also do a find-and-replace across the four `.html` files (old → new) so search engines and no-JavaScript visitors see the new value.

### Add exact map coordinates (later)

While `lat` and `lng` are `null`, the embedded map shows a search for **"Tecno Cast, Vavdi, Rajkot 360004"** and Get Directions opens `https://www.google.com/maps/dir/?api=1&destination=Tecno%20Cast%2C%20Vavdi%2C%20Rajkot%20360004`.

To pin the exact unit:

1. Open [Google Maps](https://maps.google.com) on a computer and find your workshop.
2. **Right-click** exactly on your building. The first line of the menu is the coordinates, e.g. `22.27341, 70.75123`. **Click it** to copy.
3. Paste the two numbers into `config.js`:
   ```js
   lat: 22.27341,
   lng: 70.75123,
   ```

Everything switches automatically to the exact pin: the embedded map, Get Directions (`…destination=22.27341,70.75123`) and the SEO `geo` coordinates. Optionally update the fallback `src` of the map `<iframe>` and the Get Directions `href`s in the HTML files to the coordinate form too.

### Placeholders show as "On request"

A value written in square brackets with blanks, such as `'[___ mm]'`, counts as **not filled in yet**: machine spec cards show **"On request"** with a small "Confirmed per job" note. When you have a real value, replace the whole thing, brackets included: `maxTurningDiameter: '250 mm',`.

### Update your domain in the page `<head>`

Search engines and social apps read some tags before any JavaScript runs, so these hold the domain directly in each HTML file (`https://sunriseengimach.co.in`). If the domain changes, find-and-replace it across the four `.html` files, set `site.url` in `config.js`, and update the `CNAME` file.

---

## 2. Quality tiers (how the home page decides what to show)

| Tier | Who gets it | What it shows |
|---|---|---|
| **High** | Desktop GPUs that benchmark ≥ 60 fps (detect-gpu tier 3) | Full real-time scene: MSAA ×4 + SMAA, full-resolution ambient occlusion (N8AO), depth of field with rack focus, bloom on emissives only, faint film grain, 2k HDRI, area light, maximum chips, render scale up to 2×. |
| **Medium** | Most laptops with integrated graphics, recent phones and tablets (tier 2, or tier 3 on mobile) | Full real-time scene with SMAA, half-resolution AO, bloom, 1k HDRI, fewer chips, render scale up to 1.5×. |
| **Low** | Older or blocklisted GPUs (tier 0–1), very low memory, Data Saver | A **pre-rendered video** of the same story, scrubbed by scroll — portrait 1080×1920 on phones, landscape 1920×1080 or 2560×1440 elsewhere. |
| **Static** | *Reduce motion* turned on, or no WebGL | One high-resolution still per stage (AVIF/WebP), cross-faded as you scroll. |

At run time the scene watches its own frame rate:

- **Adaptive resolution** steps the render scale down (2 → 1.75 → 1.5 → 1.25 → 1) when it drops below ~50 fps and back up when there is headroom. It never goes below 1.0 on desktop.
- If even the lowest scale is too slow, **High** drops MSAA, depth of field and grain and halves AO; if **Medium** still can't hold ~30 fps, the page switches to the video.
- Rendering pauses when the tab is hidden or the story has scrolled away.

For testing, force a tier with `?tier=high`, `?tier=medium`, `?tier=low` or `?tier=static` (add `&ao=0&dof=0&msaa=0&bloom=0&smaa=0` to switch single effects off). `?aniso=circ` streaks the steel highlights around the circumference instead of across the lay; `?tm=neutral` uses Neutral tone mapping instead of AgX.

---

## 3. Re-record the fallback videos, stills and renders

The low-tier videos, the static stills, the typical-part images, the About image and the social preview image are all rendered from the real-time scene. After changing the scene (or to make higher-quality versions), re-render them on any computer with Chrome and Node.js:

```bash
cd tools
npm install            # once
cd ..
node tools/render.mjs all          # stills, parts, og image, video frames
node tools/convert-images.mjs      # → assets/img/renders/*.avif / *.webp
node tools/encode-videos.mjs       # → assets/video/*.mp4 / *.webm
```

Without the scripts, open `index.html?record=1&frames=240` in Chrome (sized 2560×1440 for landscape, or 1080×1920 for portrait), click **Record to folder**, and encode the PNGs with the ffmpeg commands in [ASSETS.md](ASSETS.md). Part images: open `services.html?render=parts` and click **Download**.

Real 3D models (a downloaded CNC lathe, caliper or workshop) can replace the procedural ones without code changes — see [ASSETS.md](ASSETS.md) for what to download, the coordinate contract and the `gltf-transform` optimisation commands.

---

## 4. Use real workshop photos

The site never presents renders as photographs of our workshop — renders are labelled as illustrations. When you have real photos:

1. Export each photo as AVIF + WebP at two widths (e.g. 1280 and 2560 px) into `assets/img/photos/` — e.g. `workshop-1280.avif`, `workshop-1280.webp`, `workshop-2560.avif`, `workshop-2560.webp`. (Commands in [ASSETS.md](ASSETS.md) §3.)
2. **Typical parts** (`services.html`): each card has a `<picture>` inside `<div class="part__art">`. Replace its `srcset`s with your photo files (keep `width`/`height`, `loading="lazy"` and `decoding="async"`), and update the `alt` text. Then remove the "Illustrative 3D renders" note below the grid if all cards are photos.
3. **About page image**: replace the `<picture>` inside `<div class="showcase__fallback">`. To show only the photo (no 3D), remove the `data-showcase` canvas.

---

## 5. Preview on your computer

ES modules don't run from a double-clicked file (`file://`), so use a small local server:

- **Node.js:** `node tools/serve.mjs`, then open <http://localhost:8765>.
- **VS Code:** the "Live Server" extension → right-click `index.html` → **Open with Live Server**.
- **Python:** `python -m http.server 8080`, then open <http://localhost:8080>.

---

## 6. Deploy on GitHub Pages (current live setup)

The site is hosted on GitHub Pages from the `main` branch of
<https://github.com/rajdeeprathod9636/sunrise-engimach>, at **https://sunriseengimach.co.in**.

1. Commit your changes and push: `git add -A && git commit -m "…" && git push`.
2. GitHub republishes within a minute or two (**Actions** tab shows progress).

Keep the `CNAME` file (custom domain) and the empty `.nojekyll` file (serve files as-is). `tools/node_modules/` and `tools/out/` are git-ignored; everything the site needs is committed.

DNS records at the domain registrar:

| Type  | Host / Name | Value                         |
|-------|-------------|-------------------------------|
| A     | `@`         | `185.199.108.153`             |
| A     | `@`         | `185.199.109.153`             |
| A     | `@`         | `185.199.110.153`             |
| A     | `@`         | `185.199.111.153`             |
| CNAME | `www`       | `rajdeeprathod9636.github.io` |

Netlify (drag the folder onto <https://app.netlify.com/drop>), Vercel or any static host also work — no build command, no server code.

---

## 7. File structure

```
index.html            Home — 3D scroll story
about.html            About Us (3D part preview)
services.html         Services & capabilities (part renders)
contact.html          Contact form, phones, address, map
assets/css/style.css  Design system and all styles
assets/js/config.js   ← all editable business data
assets/js/main.js     Navigation, smooth scroll, reveals, transitions, tier routing, story wiring, callouts
assets/js/contact.js  Quote form validation + WhatsApp hand-off
assets/js/scene.js    3D entry point (re-exports the scene modules)
assets/js/scene/
  quality.js          tiers, GPU detection, adaptive resolution
  renderer.js         renderer, tone-mapping helpers, resize handling
  assets.js           HDRI + glTF loading (Draco/Meshopt/KTX2), progress
  textures.js         procedural surface textures
  materials.js        shared materials (anisotropic turned steel, mill scale, …)
  workpiece.js        part profiles + turned-geometry builder (helical threads)
  machine.js          procedural CNC turning centre
  set.js              floor, background, inspection bench + caliper
  chips.js            instanced helical chips
  coolant.js          coolant stream, mist, droplets
  timeline.js         story state and camera keyframes (all from P = 0…6)
  post.js             post-processing chain
  story.js            home scene controller
  showcase.js         About page part
  parts.js            typical-part renders (?render=parts)
  record.js           frame capture (?record=1)
assets/hdri/          Poly Haven HDRI (CC0)
assets/models/        optional glTF models + manifest.json
assets/video/         low-tier scroll videos
assets/img/renders/   stills and part renders (AVIF/WebP)
assets/img/photos/    your real photos (see §4)
tools/                render / convert / encode scripts (not needed to host the site)
ASSETS.md             assets guide · CREDITS.md licences
```

---

## 8. How things work (for whoever maintains the site)

- **One progress value:** each story section has a ScrollTrigger; together they give P from 0 to 6, and `scene/timeline.js` derives everything from it — door, spindle speed, turret index angle, tool path, the bar's profile, coolant, wet sheen, part transfer, caliper, studio lights and camera. The chip pile is also derived from P, so scrolling back un-machines the part exactly.
- **Camera framing:** every keyframe frames a sphere that contains the whole workpiece, sized to the free area beside (landscape) or above (portrait) the text card. The page measures the cards and tells the scene where they are, so the part is never under a card.
- **Text stays HTML** (always sharp); the inspection dimension callouts are an SVG overlay projected from 3D points every frame.
- **Loader:** shows real progress (HDRI bytes, build, shader compile). Shaders compile asynchronously so the page stays responsive; the loader always disappears within about 2 seconds.
- **Quote form → WhatsApp:** nothing is sent to a server. The form builds a formatted message and opens `wa.me/919510654646?text=…`. On phones it opens the WhatsApp app directly; on desktop, WhatsApp Web in a new tab.
- **Get Directions:** opens Google Maps directions to the address search (or to `LAT,LNG` once coordinates are set). On phones it opens in the same tab so Android/iOS hand it to the Maps app.

### Changing colours

The colour tokens are at the top of `assets/css/style.css` (`--bg`, `--surface`, `--accent`, …). The 3D scene's brand colours are at the top of `assets/js/scene/util.js` (`BG`, `ACCENT`, light colours).
