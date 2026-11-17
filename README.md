# Compute Cost Atlas (preview)

**Preview — not yet officially released.** All numbers are provisional and may change.

An interactive map of what it would cost to build and run an AI data center in each of the 3,144 U.S. counties, and
what that means for the carbon and water behind AI use. It accompanies a working paper by the Urban Information Lab,
UT Austin. The site presents descriptive information; it is not a siting recommendation, and associations shown are
not causal effects.

## What is in this repository

Only the static website is published here:

- `web/` — the site (HTML, CSS, JavaScript; no server code). MapLibre GL JS 4.7.1 is self-hosted in `web/vendor/`.
  - `web/model.js` — JavaScript version of the cost model; it is checked against the research code (Python) and agrees
    within 0.1% for every county.
  - `web/data/` — compact county data and boundaries generated from the research pipeline. Licences:
    `web/data/LICENSE-DATA.md`.
- `.github/workflows/pages.yml` — deploys `web/` to GitHub Pages.

The research pipeline (raw data, analysis code, figures) is not part of this repository.

## Run locally

```
python -m http.server 8765 --directory web
```

Then open http://localhost:8765/.

## Licences (provisional)

- Code: MIT (`LICENSE`).
- Model results: CC BY 4.0.
- Data-center counts derived from the PNNL IM3 atlas (OpenStreetMap): ODbL 1.0, in a separate file.
- Frontier AI campuses: Epoch AI, CC BY 4.0.
- Basemap: Natural Earth (public domain). Boundaries: U.S. Census Bureau (public domain).

Details and sources: `web/about.html` and `web/data/LICENSE-DATA.md`.
