# Singapore Real-Time Driving Info · 新加坡實時交通資訊

A bilingual (English / 繁體中文) map of every official camera and detection point the
Singapore Government publishes as open data — red-light cameras, speed-enforcement cameras
and LTA traffic snapshot cameras — plus the still-streaming live traffic images.

- **Live site (GitHub Pages):** https://stanleycheng.github.io/SGRTDrivingMap/
- **Repository:** https://github.com/StanleyCheng/SGRTDrivingMap
- **Build report & decisions:** [`doc/2026-09-21-design.md`](doc/2026-09-21-design.md)
- **UI design system:** [`DESIGN.md`](DESIGN.md)

## Two ways to run it

| Mode | Command | Data path |
|---|---|---|
| Self-hosted (Node server) | `npm run dev` / `npm run build && npm start` | own API routes; live images from LTA **DataMall** with the key held server-side |
| Static (GitHub Pages) | `npm run build:static` → `out/` | baked camera snapshot + keyless **data.gov.sg** mirror of the same live feed |

The static export is what CI deploys; it needs no server, no API key and no database.

## Data sources (all official, no mock data)

| Layer | Source |
|---|---|
| Red-light cameras (240) | data.gov.sg — SPF Red Light Cameras `d_5f140c79…`, cross-checked with DTRLS `d_0b7ddc09…` |
| Speed enforcement cameras (93) | data.gov.sg — SPF Fixed Speed `d_5fdeb9dc…`, Police Speed Laser `d_763b6039…`, Mobile Speed `d_e411f01a…`, consolidated list `d_983804de…` |
| Traffic snapshot cameras (262) | data.gov.sg — LTA Road Camera `d_147f4906…` + LTA DataMall `Traffic-Imagesv2` (8 live stills) |
| Basemap | OpenStreetMap standard raster tiles (keyless), with automatic fallback from an optional custom MapLibre style |

## Setup

```bash
npm install
cp .env.example .env.local     # then paste your LTA DataMall Account Key
npm run dev
```

`.env.local`

```
DATAMALL_ACCOUNT_KEY=your_datamall_account_key
# optional: override the default OpenStreetMap basemap with any MapLibre style URL
NEXT_PUBLIC_MAP_STYLE=https://example.com/maplibre-style.json
```

The DataMall key is used **server-side only** — it is never sent to the browser. The standard
OpenStreetMap basemap needs no configuration; if a custom style cannot be loaded, the map falls
back to OpenStreetMap automatically.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | development server (http://localhost:3000) |
| `npm run build` / `npm start` | production build / serve (server mode) |
| `npm run build:static` | static export for GitHub Pages → `out/` |
| `npm run verify` | lint + type check (what CI runs before deploying) |
| `npm run lint` / `npm run typecheck` | individually |
| `node scripts/smoke.mjs [url]` | end-to-end browser checks via Chrome DevTools Protocol (screenshots → `.cache/screens/`) |

### Deployment

`.github/workflows/deploy.yml` runs `npm ci` → `npm run verify` → `npm run build:static` and
publishes `out/` to GitHub Pages on every push to `main`. The static build bakes the camera
datasets into `public/data/cameras.json` from `src/data/cameras-seed.json`, temporarily moves
`src/app/api` aside (route handlers are incompatible with `output: 'export'`) and sets the
`/SGRTDrivingMap` base path — see `scripts/build-static.mjs` and `next.config.ts`.

To refresh the deployed camera data, re-run a real fetch and commit the new snapshot:

```bash
curl -s "http://localhost:3000/api/cameras?refresh=1" > /dev/null   # warm .cache
cp .cache/cameras.json src/data/cameras-seed.json
git commit -am "Refresh camera data snapshot" && git push
```

`scripts/smoke.mjs` drives a real Chrome/Edge (set `CHROME_PATH` if none is found). Run it
against `npm run dev` for the full suite (15 checks, including marker clicks); against a
production server the marker checks are skipped because the `window.__map` debug handle is
dev-only.

## Data pipeline notes

- Static camera layers are fetched from data.gov.sg on the server, cached for 6 hours
  (memory → `.cache/cameras.json` → bundled `src/data/cameras-seed.json`), and refreshed in
  the background. `GET /api/cameras?refresh=1` forces a re-download; a cold refresh takes
  ~60–70 s because data.gov.sg allows about one anonymous request every 10 s.
- Live traffic images come from LTA DataMall (`Traffic-Imagesv2`), cached 45 s and polled by
  the client every 60 s. If LTA is unreachable the last good payload is served with
  `status: "stale"` and a visible notice.
- Reset the cache with `rm -rf .cache`; re-seed the bundled snapshot with
  `cp .cache/cameras.json src/data/cameras-seed.json`.
