# Jet Lag Game Region Renderer

An interactive, high-fidelity mapping application built with **MapLibre GL JS** and **Turf.js** to render custom game regions and transit stations. Each station features a toggleable, geographically-accurate **0.25-mile hiding region** buffer.

Designed with a premium glassmorphic dark theme and a responsive layout optimized for both desktop and mobile devices.

## 🚀 Live Demo & Hosting on GitHub Pages

This repository is ready to be hosted directly on **GitHub Pages**.

### Steps to Deploy:
1. Push this codebase to a public GitHub repository.
2. In the repository settings, go to the **Pages** tab (under *Code and automation*).
3. Under **Build and deployment**, set the source to **Deploy from a branch**.
4. Choose your branch (e.g., `main` or `master`) and select `/ (root)` folder.
5. Click **Save**. Within a minute, your interactive game map will be live at:
   `https://<your-username>.github.io/<your-repo-name>/`

---

## ✨ Features

- **Geographically Accurate Buffers**: Uses **Turf.js** to compute exact 0.25-mile (402-meter) circles around stations, adjusting correctly for latitude distortion.
- **Glassmorphic Control Center**: Floating, semi-transparent controls with blur effects, providing real-time data stats and visibility filters.
- **Dual Map Themes**: Quick toggle between custom dark-mode (CartoDB Dark Matter) and light-mode (CartoDB Positron) styles without reloading the page.
- **Station Search & Filtering**: Fast search to instantly filter stations in the sidebar and on the map.
- **Dynamic Selection Sync**: Hovering or selecting stations dynamically syncs state between the map markers, map popups, and the sidebar list.
- **On-Screen Viewport Filtering**: The sidebar station list dynamically updates as you pan/zoom to only show station toggles that are currently visible on your screen.
- **Numbered & Labeled Map Markers**: Every station marker displays its numeric ID directly inside the circle, with its station name offset below. Uses text-collision avoidance to keep labels clean and text-halos for crisp readability.
- **Saved View Profiles**: Save your current map viewport (center & zoom) and active dataset/visibility settings into named profiles stored in `localStorage`. Includes inline renaming, custom deletions, and map-move divergence checks.
- **Responsive Mobile Layout**: Collapsible sidebar drawer on smaller viewports, maximizing interactive map real estate.
- **Zero API Keys**: Built using open-source tile styles, ensuring it runs out-of-the-box without any cost or rate limits.

---

## 🛠️ Tech Stack

- **Core**: Vanilla HTML5, CSS3, ES6 JavaScript
- **Map Library**: [MapLibre GL JS](https://maplibre.org/)
- **GIS Engine**: [Turf.js](https://turfjs.org/) (specifically `@turf/circle` and `@turf/bbox`)
- **Icons**: FontAwesome v6.4.0
- **Map Styles**: CartoDB Basemaps (Vector Tiles)

---

## 📂 File Structure

- `index.html` — Application structure, layout, and external asset links.
- `style.css` — Core styles, glassmorphism config, responsive overrides, and custom UI transitions.
- `app.js` — State management, map setup, geographic computations, and event handling.
- `game-region.geojson` — Play area geometry (polygon).
- `stations.geojson` — Original game station locations (points).
- `all-metro-stations.geojson` — LA Metro Rail station locations extracted and converted from the shapefile (points).

---

## 💻 Local Development

To run the application locally, you need a local web server (because of browser security policies governing local `fetch` requests).

You can run one of the following commands in the project directory:

**Using Python 3:**
```bash
python3 -m http.server 8000
```

**Using Node.js (npx):**
```bash
npx serve
```

Once running, open your browser and navigate to `http://localhost:8000`.
