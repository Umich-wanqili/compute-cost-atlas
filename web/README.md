# Compute Cost Atlas — web prototype v0

Static site (no server code), intended for GitHub Pages. Not deployed yet.

- `index.html`, `app.js`, `style.css` — map (MapLibre GL JS 4.7.1 from unpkg), controls, county profile, comparison.
- `model.js` — JavaScript port of the cost model and token layer. The Python code (`src/cost_model.py`,
  `src/monte_carlo.py`, `src/token_cost.py`) is the source of truth; parity is checked by `tests/test_web_parity.py`
  (needs `pip install quickjs`; every county within 0.1% for baseline + 10 scenarios).
- `about.html` — plain-language about / methods / limitations / data licences.
- `data/` — written by `python src/export_web_data.py` (do not edit by hand): `params.json` (from the YAML configs),
  `counties.json` (model inputs, flags), `counties.geojson` + `states.geojson` (simplified boundaries), `dc_pnnl.geojson`
  (ODbL), `dc_epoch.geojson` (CC BY 4.0), `counties_baseline.csv` (download).

Run locally (any static server; `fetch` does not work from `file://`):

    python -m http.server 8765 --directory web

then open http://localhost:8765/.

Views are shareable through the URL hash, e.g. `#theme=tradeoff&metric=bivCo2&carbon=190&diff=rank&3d=1&layers=epoch,cities`.
Reproducible desktop screenshots (installed Microsoft Edge via Playwright, `pip install playwright`; no browser download):

    python tests/web_screenshots.py
