# Credits & licences

Everything shown on this website is either made for it or used under a licence listed here.

## 3D scene, renders and videos

The CNC turning centre, tooling, workpiece, chips, coolant, inspection bench, caliper and
workshop background on the home page — and every render made from them (stage stills,
scroll videos, typical-part images, About page image, social preview image) — are built
procedurally in code for this site (`assets/js/scene/`). They are **illustrations**, not
photographs of our workshop. No third-party models are used.

| Asset | Source | Author | Licence | Attribution required |
|---|---|---|---|---|
| Image-based lighting: **Autoshop 01** HDRI (`assets/hdri/autoshop_01_1k.hdr`, `…_2k.hdr`) | [Poly Haven](https://polyhaven.com/a/autoshop_01) | Oliksiy Yakovlyev | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | No (credited anyway, in the footer) |

If you add any of the optional models listed in [ASSETS.md](ASSETS.md), add a row here with
its source page, author and licence, and — for CC-BY assets — the attribution text the
licence requires in the site footer.

## Code libraries (loaded from public CDNs)

| Library | Version | Licence |
|---|---|---|
| [three.js](https://threejs.org) | 0.169.0 | MIT |
| [postprocessing](https://github.com/pmndrs/postprocessing) (pmndrs) | 6.37.8 | Zlib |
| [N8AO](https://github.com/N8python/n8ao) | 1.10.1 | CC0 1.0 |
| [detect-gpu](https://github.com/pmndrs/detect-gpu) (pmndrs) | 5.0.70 | MIT |
| [GSAP + ScrollTrigger](https://gsap.com) | 3.12.5 | [GSAP standard licence](https://gsap.com/standard-license) (free) |
| [Lenis](https://github.com/darkroomengineering/lenis) | 1.1.13 | MIT |

## Fonts

[Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) and
[Inter](https://fonts.google.com/specimen/Inter) via Google Fonts — SIL Open Font License 1.1.

## Render tools (not part of the website)

`tools/` uses [puppeteer-core](https://pptr.dev) (Apache-2.0), [sharp](https://sharp.pixelplumbing.com)
(Apache-2.0) and [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) (GPL-3.0 ffmpeg build)
to render, convert and encode images and videos on your own computer.
