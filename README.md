# Sunrise Engimach — website

A static, ready-to-deploy website for **Sunrise Engimach**, a CNC turning unit in Rajkot, Gujarat. It uses plain HTML, CSS and JavaScript (ES modules), so there is no build step.

- **Home** (`index.html`): a 3D scroll story. A procedural lathe faces, turns, grooves, threads and inspects a shaft as you scroll.
- **About** (`about.html`): company story, founder note, mission/vision/values, why Rajkot, commitments.
- **Services** (`services.html`): operations, materials, machine capability cards, typical parts.
- **Contact** (`contact.html`): quote form that opens a pre-filled WhatsApp message, a map and a Get Directions button.

The libraries load from CDNs: Three.js 0.169 (jsDelivr), GSAP 3.12.5 + ScrollTrigger (cdnjs), Lenis 1.1.13 (unpkg), and Google Fonts (Space Grotesk + Inter).

---

## 1. Edit your business details: `assets/js/config.js`

All business data lives in **one file**. Open `assets/js/config.js` in any text editor (Notepad, VS Code) and change the values in quotes. Every page reads this file when it loads.

| What | Key in `config.js` | Notes |
|---|---|---|
| Postal address | `location.address` | Edit this single line. |
| Map pin | `location.lat`, `location.lng` | Decimal numbers, e.g. `22.2734`, `70.7512`. Used by the map, Get Directions and SEO. |
| Phone (display) | `contact.phoneDisplay` | Shown on the site, e.g. `+91 79906 36261`. |
| Phone (dialling) | `contact.phoneTel` | Used for click-to-call, e.g. `+917990636261`. |
| WhatsApp number | `contact.whatsappNumber` | International format, digits only: `917990636261`. |
| WhatsApp greeting | `contact.whatsappGreeting` | Pre-filled text for the floating WhatsApp button. |
| Founded year | `company.foundedYear` | e.g. `2026`. |
| Machine specs | `machine.*` | `machineType`, `maxTurningDiameter`, `maxTurningLength`, `typicalTolerance`, `batchSize`. |
| Form dropdowns | `services`, `materials` | Options in the quote form. |
| Website address | `site.url` | Your live domain, used in the SEO schema. |

### Placeholders show as "On request"

A value written in square brackets with blanks, such as `'[___ mm]'`, counts as **not filled in yet**:

- Machine spec cards show **"On request"** with a small "Confirmed per job" note.
- A placeholder address shows as **"Rajkot, Gujarat, India"**.

When you have a real value, replace the whole thing, brackets included:

```js
maxTurningDiameter: '250 mm',
typicalTolerance: '± 0.02 mm',
address: 'Plot No. 12, Shapar Industrial Area, Rajkot, Gujarat – 360024',
```

### Get exact coordinates from Google Maps

1. Open [Google Maps](https://maps.google.com) on a computer and find your workshop.
2. **Right-click** exactly on your building.
3. The first line of the menu is the coordinates, e.g. `22.27341, 70.75123`. **Click it** to copy.
4. Paste the two numbers into `config.js`:
   ```js
   lat: 22.27341,
   lng: 70.75123,
   ```

The embedded map, the **Get Directions** button and the SEO data all update automatically.

### Update your domain in the page `<head>`

Search engines and social apps read some tags before any JavaScript runs, so these hold the domain directly in each HTML file. The site is set up for `https://sunriseengimach.co.in`. If the domain ever changes, do a find-and-replace across all four `.html` files:

```
https://sunriseengimach.co.in   →   https://your-new-domain.com
```

Then set the same value in `site.url` in `config.js`, and update the `CNAME` file.

---

## 2. Preview on your computer

ES modules don't run from a double-clicked file (`file://`), so you need a small local server. Any one of these works:

- **VS Code:** install the "Live Server" extension, right-click `index.html`, then choose **Open with Live Server**.
- **Node.js:** `npx serve .` in this folder, then open the address it prints.
- **Python:** `python -m http.server 8080`, then open <http://localhost:8080>.

---

## 3. Deploy for free

### Netlify (drag and drop, easiest)

1. Go to <https://app.netlify.com/drop> and sign in (free).
2. Drag this **whole folder** (the one containing `index.html`) onto the page.
3. Netlify gives you a live link in a few seconds, like `https://random-name.netlify.app`.
4. Optional: in **Site configuration → Change site name**, rename it, e.g. `sunrise-engimach`. To use your own domain, go to **Domain management → Add a domain**.

To update the site later, open your site in Netlify, go to **Deploys**, and drag the folder in again.

### GitHub Pages (current live setup)

The site is hosted on GitHub Pages from the `main` branch of
<https://github.com/rajdeeprathod9636/sunrise-engimach>, at **https://sunriseengimach.co.in**.

To update the live site, commit your changes and run `git push`. GitHub republishes within a minute or two.

The `CNAME` file holds the custom domain, so don't delete it. The empty `.nojekyll` file tells GitHub to serve the files as-is.

DNS records at the domain registrar:

| Type  | Host / Name | Value                         |
|-------|-------------|-------------------------------|
| A     | `@`         | `185.199.108.153`             |
| A     | `@`         | `185.199.109.153`             |
| A     | `@`         | `185.199.110.153`             |
| A     | `@`         | `185.199.111.153`             |
| CNAME | `www`       | `rajdeeprathod9636.github.io` |

### Vercel or any shared hosting

Upload the folder as-is. It's plain static files, with no build command and no server code.

---

## 4. File structure

```
index.html            Home — 3D scroll experience
about.html            About Us
services.html         Services & Capabilities
contact.html          Contact form + map
assets/css/style.css  Design system and all styles
assets/js/config.js   ← all editable business data
assets/js/main.js     Navigation, smooth scroll, reveals, page transitions, home story wiring
assets/js/scene.js    Three.js lathe scene (home story + About page preview)
assets/js/contact.js  Quote form validation + WhatsApp hand-off
assets/img/logo.svg   Full logo (symbol + wordmark)
assets/img/favicon.svg Symbol-only icon
assets/img/og-image.png Social share preview (1200×630)
```

---

## 5. How things work (for whoever maintains the site)

- **3D story:** each story section on the home page has a GSAP ScrollTrigger. Together they produce one progress value from 0 to 6, and `scene.js` derives everything from it: spindle speed, bar profile (a `LatheGeometry` rebuilt from the profile), tool path, chips, camera. Scrolling backwards reverses the machining exactly.
- **Performance:** the pixel ratio is capped (2 on desktop, 1.5 on mobile), and mobile uses fewer particles and geometry segments. Rendering pauses when the tab is hidden or the scene has faded out below the story.
- **Fallbacks:** if the visitor has *Reduce motion* turned on, or WebGL isn't available, the 3D canvas is replaced by a static illustration of the finished shaft. All content stays readable.
- **Loader:** a branded loader shows while the 3D scene prepares. It always disappears within about 2 seconds.
- **Quote form → WhatsApp:** nothing is sent to a server. The form builds a formatted message and opens `wa.me/<number>?text=…`. On phones it opens the WhatsApp app directly; on desktop it opens WhatsApp Web in a new tab. The visitor then taps **Send**, and can attach a drawing.
- **Get Directions:** opens `https://www.google.com/maps/dir/?api=1&destination=LAT,LNG`. On phones it opens in the same tab, so Android/iOS hand it straight to the Google Maps app.

### Changing colours

The colour tokens are at the top of `assets/css/style.css` (`--bg`, `--surface`, `--accent`, …). Change them there and the whole site follows. The 3D scene's background and accent light are at the top of `assets/js/scene.js` (`BG`, `ACCENT`).
