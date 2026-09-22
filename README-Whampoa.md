# 新加坡實時交通資訊

A bilingual (English / 繁體中文) map of every official camera and detection point the
Singapore Government publishes as open data — red-light cameras, speed-enforcement cameras
and LTA traffic snapshot cameras — plus the still-streaming live traffic images.

- **Live site (GitHub Pages):** https://stanleycheng.github.io/SGRTDrivingMap/
- **Repository:** https://github.com/StanleyCheng/SGRTDrivingMap
- **Build report & decisions:** [`doc/2026-09-21-design.md`](doc/2026-09-21-design.md)
- **Road-condition feature notes:** [`doc/2026-09-22.md`](doc/2026-09-22.md)
- **UI design system:** [`DESIGN.md`](DESIGN.md)

## Two ways to run it

| Mode | Command | Data path |
|---|---|---|
| Self-hosted (Node server) | `npm run dev` / `npm run build && npm start` | own API routes; live images from LTA **DataMall** with the key held server-side |
| Static (GitHub Pages) | `npm run build:static` → `out/` | baked camera snapshot + keyless **data.gov.sg** mirror of the same live feed |

The static export is what CI deploys; it needs no server, no API key and no database.

## Live road conditions · 實時路況

The self-hosted app adds four driver-facing LTA DataMall overlays. They are live operational
reports, distinct from the published camera-location layers above.

| Map layer | Official feed(s) | Map treatment |
|---|---|---|
| Traffic speed segments · 車速路段 | Traffic Speed Bands v4 | Current speed band, shown as a straight start/end segment. It is a **schematic endpoint line**, not the authoritative road shape. |
| Live incidents · 實時事故 | Traffic Incidents | Point reports for incidents such as accidents, breakdowns, obstructions and diversions. |
| Hazards · 路面警報 | PUB Flood Alerts; Faulty Traffic Lights | Flood alerts map where coordinates are supplied; faulty-light reports remain in the status/list view because the official feed supplies no coordinates. |
| Roadworks & openings · 道路工程及通車 | Approved Road Works; Planned Road Openings | Official road-name and schedule reports. They are deliberately unmapped when LTA supplies no site or extent geometry. |

All six feeds require `DATAMALL_ACCOUNT_KEY` and are fetched only by the Node server:
Traffic Speed Bands v4 (5 min cache), Traffic Incidents (2 min), PUB Flood Alerts (3 min),
Faulty Traffic Lights (2 min), Approved Road Works (24 h), and Planned Road Openings (24 h).
The API paginates DataMall results in 500-record pages, keeps an in-memory and disk cache, and
returns a recent last-successful payload as `stale` if a refresh fails. Refresh timing is enforced
server-side so public callers cannot bypass the upstream TTLs. The HTTP response permits a
60-second cache with up to five minutes of stale-while-revalidate.

Road conditions are unavailable in the static GitHub Pages export. Static hosting has no
server-side credential proxy, so it never ships the private DataMall key or attempts a
credentialed browser request; the camera map and keyless live traffic-image mirror still work.

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
- Live road conditions use six server-only LTA DataMall feeds with source-specific 2 min to
  24 h TTLs. Coordinate-free official reports are retained as unmapped records rather than
  guessed onto the map; speed-band lines are schematic start/end endpoints.
- Reset the cache with `rm -rf .cache`; re-seed the bundled snapshot with
  `cp .cache/cameras.json src/data/cameras-seed.json`.
