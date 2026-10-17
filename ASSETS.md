# Assets — what is included, what you can add, and how to optimise it

The site works fully with what is in this repository. The machine, tooling, workpiece,
chips, coolant and inspection set are built in code (`assets/js/scene/`), with procedural
surface textures (mill scale, feed marks, brushed steel, paint, granite, concrete) generated
at load time. Real downloaded models are **optional upgrades**: drop a file in, name it in
the manifest, and the scene uses it instead of the procedural part.

## 1. Included

| File | What | Size | Source |
|---|---|---|---|
| `assets/hdri/autoshop_01_1k.hdr` | Image-based lighting (reflections), medium tier + first frame | 1.6 MB | Poly Haven, CC0 |
| `assets/hdri/autoshop_01_2k.hdr` | Sharper reflections, high tier (swapped in after the first frame) | 6.5 MB | Poly Haven, CC0 |
| `assets/img/renders/stage-*` | One still per story stage, landscape 2560/1920/1280 + portrait 1080/720, AVIF + WebP | ~0.4 MB per orientation | rendered from the scene |
| `assets/img/renders/part-*` | Typical-part renders, 320/640/960 px wide (1×/2×/3×), AVIF + WebP, transparent | ~0.5 MB total | rendered from the scene |
| `assets/img/renders/about-part-*` | About page image of the finished part | small | rendered from the scene |
| `assets/video/story-*` | Scroll-scrubbed story for the low tier: landscape 2560×1440 and 1920×1080, portrait 1080×1920, H.264 MP4 + VP9 WebM | 3–7 MB each | rendered from the scene |
| `assets/img/og-image.png` | Social preview, 1200×630 | — | rendered from the scene |
| `assets/img/brushed@2x.webp` | Card brushed-metal texture (2×) | 22 KB | generated |

Why the HDRI is `autoshop_01`: neutral grey, lit by long ceiling strip lights. Strip lights are
what give turned steel its long, clean highlights; no coloured walls or floors tint the metal.

## 2. Optional models (drop-in upgrades)

Put files in `assets/models/` and name them in `assets/models/manifest.json`:

```json
{
  "lathe":    { "desktop": "cnc-lathe.glb", "mobile": "cnc-lathe-1k.glb" },
  "caliper":  "caliper.glb",
  "workshop": "workshop.glb"
}
```

`null` (the default) means "use the procedural version". A model is only requested when its
entry names a file, so nothing is ever fetched that does not exist.

### Coordinate contract (all models)

* Units: **1 unit = 50 mm** (a 200 mm chuck is 4 units across).
* Spindle axis = **+X** through the origin; Y up; the operator/door side faces **+Z**.
* The chuck's front face sits at **x = −1.97**; the bar stock is Ø50 mm (radius 0.5).
* Author the model in these world coordinates with the root at identity.

### `lathe` — CNC turning centre

| Requirement | Value |
|---|---|
| Type | Modern **slant-bed CNC lathe**, enclosed: sheet-metal guarding, sliding door with a glass window, hydraulic 3-jaw chuck, disc tool turret with several holders, tailstock, coolant nozzle, chip conveyor/tray |
| Look | Neutral grey / off-white paint with dark grey panels. **Remove every third-party brand logo or name plate** before use |
| Budget | ≤ 150k triangles desktop (≤ 60k mobile LOD), 2k textures desktop / 1k mobile, KTX2 |
| Node names (optional, case-sensitive) | `Spindle` (chuck + jaws; rotates about X) · `Door` (slides along X; closed position as authored) · `Turret` (housing; follows the cross-slide) · `TurretDisc` (disc + tools; indexes about X). Any of these that exist are animated by the story; everything else is treated as the static shell and replaces the procedural cabinet |
| Search terms | "CNC lathe", "CNC turning center", "slant bed lathe", "CNC machine enclosure" |
| Sources | [Sketchfab](https://sketchfab.com/search?features=downloadable&licenses=7c23a1ba438d4306920229c12afcb5f9&licenses=b9ddc40b93e34cdca1fc152f39b9f375&q=cnc+lathe&type=models) filtered to *Downloadable* + **CC0 / CC-BY**; [Poly Haven](https://polyhaven.com/models) (CC0); [CGTrader free](https://www.cgtrader.com/free-3d-models?keywords=cnc%20lathe) (check each licence) |

Fit the model to the contract in Blender: scale so the chuck is ~200 mm, move the spindle axis onto
X at the origin, chuck face to x = −1.97, rename the four nodes, then export glTF binary (+Y up).

### `caliper` — digital vernier caliper (or outside micrometer)

* Node `Slider` (the moving jaw + display) slides along local **+Y**; the measuring face of the
  fixed jaw is at local y = 0; jaws reach toward local −Z. ≤ 20k triangles, 1k textures.
* Search: "digital caliper", "vernier caliper", "micrometer" (Sketchfab CC0/CC-BY, Poly Haven).

### `workshop` — background

* A dim, clean workshop: concrete floor, distant racking. Keep it simple — it is shown
  out of focus. ≤ 80k triangles, 1k textures. Poly Haven has CC0 props that suit it, e.g.
  `steel_frame_shelves_01`, `metal_tool_chest`, `worn_metal_rack`, `industrial_storage_cart`.

### Optimise every model (Draco or Meshopt + KTX2)

Install once: `npm install -g @gltf-transform/cli` (needs the KTX-Software `toktx` tool on PATH for KTX2).

```bash
# Desktop: Meshopt geometry, KTX2 (ETC1S colour, UASTC normals), textures ≤ 2048
gltf-transform optimize in.glb assets/models/cnc-lathe.glb \
  --compress meshopt --texture-compress ktx2 --texture-size 2048 --simplify false

# Mobile LOD: 1k textures, simplified geometry
gltf-transform optimize in.glb assets/models/cnc-lathe-1k.glb \
  --compress meshopt --texture-compress ktx2 --texture-size 1024 --simplify true --simplify-ratio 0.4

# Draco instead of Meshopt (either works — the loader supports both)
gltf-transform draco in.glb out.glb --method edgebreaker
```

Budget for the whole page: **≤ 12 MB on desktop, ≤ 5 MB on mobile** including the HDRI.

## 3. Re-rendering stills, part images, videos and the social image

Everything is rendered from the live scene in headless Chrome on your own GPU:

```bash
cd tools && npm install          # once: puppeteer-core, sharp, ffmpeg-static
cd ..
node tools/render.mjs stills     # → tools/out/stills/   (2560×1440 + 1080×1920)
node tools/render.mjs parts      # → tools/out/parts/    (2× and 3× PNG, transparent)
node tools/render.mjs og         # → assets/img/og-image.png (needs "parts" first)
node tools/render.mjs frames 240 # → tools/out/frames/{landscape,portrait}/frame-0000.png …
node tools/convert-images.mjs    # stills + parts → assets/img/renders/*.avif|webp
node tools/encode-videos.mjs     # frames → assets/video/*.mp4|webm
```

Without the scripts: open `index.html?record=1&frames=240` in Chrome at the target window
size and click **Record to folder**; open `services.html?render=parts` and click **Download**.

### Image export settings

| Format | Settings |
|---|---|
| AVIF | quality 58, effort 6, chroma 4:4:4 (keeps thin bright edges on metal clean) |
| WebP | quality 84, effort 6, smart subsampling |
| Sizes | stills: 2560/1920/1280 landscape, 1080/720 portrait · parts: 320/640/960 (1×/2×/3×) |

Equivalent command-line tools: `avifenc -q 58 -s 4 -y 444 in.png out.avif` and
`cwebp -q 84 -m 6 in.png -o out.webp`.

### Video encoding (what `encode-videos.mjs` runs)

Keyframe every 2 frames so scroll-scrubbing (seeking) stays smooth:

```bash
# H.264 MP4
ffmpeg -framerate 30 -i tools/out/frames/landscape/frame-%04d.png \
  -vf "scale=2560:1440:flags=lanczos,format=yuv420p" -c:v libx264 -preset slow -crf 24 \
  -g 2 -keyint_min 1 -sc_threshold 0 -profile:v high -movflags +faststart -an \
  assets/video/story-landscape-2560.mp4

# VP9 WebM (smaller; served first when supported)
ffmpeg -framerate 30 -i tools/out/frames/landscape/frame-%04d.png \
  -vf "scale=2560:1440:flags=lanczos,format=yuv420p" -c:v libvpx-vp9 -b:v 0 -crf 36 \
  -g 2 -row-mt 1 -deadline good -cpu-used 2 -an assets/video/story-landscape-2560.webm

# AV1 (optional, best compression, slow to encode)
ffmpeg -framerate 30 -i tools/out/frames/landscape/frame-%04d.png \
  -vf "scale=1920:1080:flags=lanczos,format=yuv420p" -c:v libaom-av1 -crf 34 -b:v 0 \
  -g 2 -cpu-used 6 -row-mt 1 -an assets/video/story-landscape-1920-av1.webm
```

Repeat with `scale=1920:1080` (landscape 1920) and with the portrait frames at `scale=1080:1920`.

## 4. Real workshop photos

The site never presents renders as photographs of our workshop. When you have real photos,
put them in `assets/img/photos/` and swap them in — see "Use real photos" in the README.
