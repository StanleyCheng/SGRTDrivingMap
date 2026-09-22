# 新加坡實時交通資訊

**Build report · 2026-09-21**

A bilingual (English / 繁體中文) single-page map of every official camera and detection
point that the Singapore Government publishes as open data, plus the still-live LTA
traffic snapshot images.

- App: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · MapLibre GL JS
- Map data: `data.gov.sg` (SPF / LTA datasets) + LTA DataMall (`Traffic-Imagesv2`)
- Run: `npm install && npm run dev` → http://localhost:3000 (see `README.md`)

---

## 1. Official APIs and data sources used

### 1.1 Data.gov.sg dataset download API

```
GET https://api-open.data.gov.sg/v1/public/api/datasets/{DATASET_ID}/poll-download
    headers: x-api-key: public        ← required, otherwise HTTP 403
    → { "code": 0, "data": { "url": "<presigned S3 URL>" } } → GET that URL
GET https://api-production.data.gov.sg/v2/public/api/datasets/{DATASET_ID}/metadata
    → authoritative revision date per dataset ("data version" shown in the UI)
GET https://api-production.data.gov.sg/v2/public/api/collections/{COLLECTION_ID}/metadata
    → "childDatasets": [...]  (used to prove that the DSECS collection publishes no dataset)
```

Anonymous access is rate-limited to roughly **one request per 10 seconds**; the server
serialises data.gov.sg calls with an 11 s gap, retries HTTP 429 with back-off, and caches
the result for 6 hours (see §5).

### 1.2 Datasets actually plotted

| Layer | Dataset (agency) | Dataset ID | Format | Records used | Source revision |
|---|---|---|---|---|---|
| Red-light | Red Light Cameras — RLC (SPF) | `d_5f140c79c9dbee0bbb07c753afd788d8` | GeoJSON | **240** | 13 Nov 2025 |
| Red-light (cross-check) | Digital Traffic Red Light Cameras — DTRLS (SPF) | `d_0b7ddc0979dfc183e8b0e056878b14af` | GeoJSON | same 240 locations | 02 Dec 2025 |
| Speed | Fixed Speed Cameras — FSC (SPF) | `d_5fdeb9dccf757dbdf698240fed29f441` | GeoJSON | 20 | 13 Nov 2025 |
| Speed | Police Speed Laser Cameras — PSLC (SPF) | `d_763b60398a7749f793f1eae2fe97c775` | GeoJSON | 48 | 02 Dec 2025 |
| Speed | Mobile Speed Cameras — MSC (SPF) | `d_e411f01a5ac504f88434d7a02388c9ce` | GeoJSON | 3 | 13 Nov 2025 |
| Speed | Location of Speed Cameras in Singapore — consolidated list (SPF) | `d_983804de2bc016f53e44031d85d1ec8a` | CSV | 91 rows (33 fixed incl. 13 LTA KPE/MCE, 53 laser, 5 mobile) | 06 Jun 2024 |
| Traffic snapshot | LTA Road Camera — camera locations (LTA) | `d_147f4906651f5b32925dfe6560296161` | GeoJSON | **254** | 06 Jun 2024 |
| Traffic snapshot (live) | Traffic Images v2 (LTA DataMall) | `Traffic-Imagesv2` | JSON | **8 live stills** (+ timestamp) | live, polled every 60 s |

Verified dataset → collection mapping (via `collections/{id}/metadata`):

| Collection | Name | childDatasets |
|---|---|---|
| 581 | SPF Red Light Cameras | `d_5f140c79…` |
| 592 | SPF **Digital Speed Enforcement Cameras (DSECS)** | **none — empty** |
| 593 | SPF Digital Traffic Red Light Cameras | `d_0b7ddc09…` |
| 595 | SPF Fixed Speed Cameras | `d_5fdeb9dc…` |
| 596 | SPF Mobile Speed Cameras | `d_e411f01a…` |
| 597 | SPF Police Speed Laser Cameras | `d_763b6039…` |

### 1.3 LTA DataMall

```
GET https://datamall2.mytransport.sg/ltaodataservice/Traffic-Imagesv2
    headers: AccountKey: <your DataMall Account Key>
    → { value: [ { CameraID, Latitude, Longitude, ImageLink (15-min presigned S3) } ] }
```

The Account Key is used **server-side only** (`.env.local`, git-ignored) so it never
reaches the browser.

> **Note on the supplied SDK key.** a separate SDK account key (redacted here) plus the
> *Extended OBU Library SDK Developer Guide* is the **EXTOL SDK** — a Bluetooth library for
> connecting to the ERP 2.0 On-Board Unit to read ERP/traffic messages *in a vehicle*. It
> requires physical OBU hardware and exposes no camera or map data, so it is not used by
> this website. The DataMall **Account Key** is the credential that authorises
> `Traffic-Imagesv2`.

### 1.4 Other sources

| Purpose | Source |
|---|---|
| Basemap (default) | OpenFreeMap **Positron** vector style — keyless (`https://tiles.openfreemap.org/styles/positron`) |
| Basemap (automatic fallback) | OpenStreetMap raster tiles, desaturated, if the vector style cannot be reached |
| Official camera names for the 8 live stills | LTA OneMotoring “Traffic Cameras” page (coordinates still come from the API) |

---

## 2. Features that are fully operational

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | **Red-light camera locations on a Singapore map** | ✅ | 240 SPF RLC records plotted; every record selectable |
| 2 | **Bilingual toggle `[Eng \| 繁中]`** | ✅ | Sliding switch in the header; 84 translated strings in each language; switches every panel, marker detail, legend, source list, timestamp locale and `<html lang>`; choice is remembered in `localStorage` and can be set with `?lang=zh` |
| 3 | **Speed enforcement camera locations** | ✅ | 93 points = 20 fixed + 13 LTA-operated KPE/MCE expressway + 54 police laser + 6 mobile, union of four official datasets |
| 4 | **Traffic snapshot camera locations** | ✅ | 254 LTA road-camera locations + the 8 still-streaming cameras |
| 5 | **Layer toggles with live counts per layer** | ✅ | 3 switches with counts (240 / 93 / 262), sub-type breakdown (e.g. “Fixed speed camera 20 · Expressway speed camera (KPE/MCE) 13 · …”), totals line “3 layers · 595 detection points”, and an “all layers hidden” notice |
| 6 | **Interactive markers with name + details** | ✅ | Click a marker → detail card: type chip, place name, travel direction, road, description, coordinates, record ID, per-dataset source links with revision dates, “Zoom to” |
| 7 | **Traffic snapshots: latest image + update timestamp** | ✅ | Clicking a live camera loads the real 1920×1080 LTA still (verified 1920×1080 in-browser), with “Captured hh:mm:ss”, relative age (“54s ago”), “Open full image”, retry on a broken/expired URL |
| 8 | **Clustering / density management** | ✅ | MapLibre cluster sources (radius 46 px, max zoom 14) with counted cluster bubbles per layer; cluster click expands to the child points; overlapping records in the same layer are nudged ~5 m apart on screen so each stays selectable |
| 9 | **“Don’t miss any, tell me how many are in use”** | ✅ | Every published record is plotted: 240 red-light + 93 speed + 262 traffic-camera records = **595**, of which **8 traffic cameras are streaming live images right now** (shown as a live pill + pulsing halo + header/footer counters) |
| 10 | **Retractable control panel / icon-only controls with tooltips** | ✅ | Panel collapses to a pill on desktop; on mobile it is a bottom sheet that gets out of the way when a detail card opens. Map controls, close/collapse buttons and the data-source button are icon-only with `.tip` tooltips and `aria-label`s |
| 11 | **Responsive desktop + mobile** | ✅ | Verified at 1440×900 and 390×844: no horizontal overflow, bottom-sheet layout on mobile, floating cards on desktop |
| 12 | **Status indicators** | ✅ | Per-layer status (loaded / partly available / unavailable + retry), loading skeletons, traffic-feed “loading / live / temporarily unavailable” states, stale-cache notice, and honest empty states |
| 13 | **Data attribution + links to official sources** | ✅ | “Data sources” dialog lists every agency, dataset, revision date and outbound link, plus the licence/disclaimer and basemap credits |
| 14 | **Real data only, no mock data** | ✅ | See §4 |
| 15 | **Error handling without fabricated results** | ✅ | Upstream failures surface as an explicit reason (HTTP status / rate-limit text) with a Retry button; a failed image falls back to an error card, never a blank box |
| 16 | **No authentication** | ✅ | No accounts, logins or cookies; the only stored value is the language preference |

### Extra (not requested, included because they are one line in the layer config)

- **Real-time freshness chip** for the LTA image feed (count + SGT feed time + 60 s auto-refresh).
- **Live SGT clock** in the header for an “instrument panel” feel.

---

## 3. What could not be completed, and why

| Item | Cause | Handling |
|---|---|---|
| **Digital Speed Enforcement Cameras (DSECS) dataset** | The dataset does not exist. `collections/592/metadata` returns `"childDatasets": []`; the data.gov.sg page renders “Dataset not found”. `/datasets` has no search API (463 pages of 10, no filters) so an orphaned copy could not be fully excluded — but nothing is published today. | The 13 LTA-operated KPE/MCE enforcement cameras that SPF lists alongside the fixed cameras **are** included, because they appear in the consolidated CSV as “Fixed Speed Camera”. They are labelled `Expressway speed camera (KPE/MCE)`. |
| **Average-speed camera zones (Tanah Merah Coast Road, 12 entry/exit points)** | Published only as an HTML table on police.gov.sg — no dataset, no API. | Not plotted; disclosed in-app in the Data-sources dialog with a link to the SPF page, and recorded here. |
| **All ~79 LTA traffic cameras with live video** | LTA retired most public video feeds (71 cameras switched off in the ERP 2.0 transition); only **8** still publish stills through `Traffic-Imagesv2`. | All 8 live cameras are shown with images; the 254-camera location inventory is shown as locations, with the live count stated everywhere (“262 mapped · 8 live”). |
| **Road names for the 254 LTA inventory points** | The dataset contains only `UNIQUE_ID`, `INC_CRC`, `FMEL_UPD_D` — no name, road or direction field. | Location-only detail cards for those points (“Traffic snapshot camera #id” + coordinates). Names are **not** invented; the 8 named cameras use LTA’s own published names. |
| **Sub-second live refresh** | data.gov.sg allows ≈1 anonymous request / 10 s; LTA image URLs expire after 15 minutes. | Serialised server fetches + 6 h cache for the static camera layers + 45 s TTL for images + 60 s client polling. |
| **Consistency between the SPF GeoJSON files and the consolidated CSV** | The GeoJSON files are 2016 vintage (`FMEL_UPD_D: 2016123…`) although the datasets were re-published in Nov/Dec 2025; the CSV is from Jun 2024 and mislabels two sites (Aviation Park Road = Mobile in the CSV but Police Speed Laser on the SPF page; Yishun Ave 1 appears as both Mobile and Fixed). | Both are plotted as a union with per-dataset revision dates displayed, so nothing is dropped and the user can see which revision each point came from. |
| **Dark mode, native apps, offline use, user accounts** | Not requested; offline is impossible for a real-time feed. | Not implemented. |

---

## 4. Was any mock data used?

**No. There is no mock, sample, seeded-fake or placeholder data anywhere in the app.**

Evidence:

1. Every plotted point originates from a downloaded official file: the app parses the raw
   GeoJSON/CSV payloads in `src/lib/server/sources.ts` (`fromGeoJson`, `fromSpeedCsv`,
   `fromLtaRoadCameras`) and the live feed in `rawTrafficImages()`.
2. The counts on screen are computed from that payload at render time — 240 / 93 / 262,
   total 595 — and match the datasets exactly.
3. `src/data/cameras-seed.json` is **not** mock data: it is a verbatim capture of a real
   refresh (`generatedAt: 2026-09-21T07:30:02.889Z`) used only as a cold-start/offline
   fallback. It carries each dataset’s own revision date, and the UI prints “Updated
   {fetch time}”; when it is older than the 6-hour TTL the server refreshes from upstream in
   the background and serves stale data only with the “Cached copy” notice.
4. The only non-source-derived values are (a) a ~5 m **display-only** nudge for records that
   share one exact coordinate, so two markers never hide each other, and (b) the names of
   the 8 live cameras, taken from LTA’s own OneMotoring camera list (coordinates from the
   API). Both are documented in code comments and in §3.
5. When something cannot be loaded, the UI says so — it never substitutes a value.

---

## 5. Architecture

```
src/
  app/
    layout.tsx                 fonts (Archivo + Instrument Serif) + i18n provider + metadata
    page.tsx                   renders <App/>
    globals.css                design tokens (see DESIGN.md)
    api/cameras/route.ts       → aggregated static camera layers (+ ?refresh=1)
    api/traffic-images/route.ts→ live LTA stills
  components/
    App.tsx                    state, data loading, responsive layout, selection
    MapView.tsx                MapLibre GL: clustering, generated SVG markers, popups, fly-to
    layer-panel.tsx            layer switches, counts, statuses, retry, collapse
    detail-panel.tsx           location detail card + source links
    traffic-image.tsx          live still viewer (loading / broken-URL / empty states)
    app-header.tsx             wordmark, live SGT clock, [Eng|繁中] switch, sources button
    sources-panel.tsx          attribution, legend, revision dates, dataset gap note
    i18n-provider.tsx          language context + persistence
  lib/
    i18n.ts                    EN / 繁體中文 dictionaries (84 keys each, key-parity checked)
    layers.ts                  layer + data-source definitions, colours
    types.ts                   shared contracts
    format.ts                  SGT date/time/age formatting
    server/sources.ts          data.gov.sg + DataMall fetchers, rate limiting, normalisation
    server/cache.ts            memory → disk → bundled-seed cache
  data/cameras-seed.json       real captured snapshot (cold-start fallback)
scripts/smoke.mjs              end-to-end browser checks (Chrome via CDP, no dependencies)
```

**Caching / rate limiting.** `getCameras()` serves memory → `.cache/cameras.json` → the
bundled seed, refreshes in the background when older than 6 h, and exposes `?refresh=1` for
the Retry button. data.gov.sg calls are serialised with an 11 s gap and retried on 429.
`/api/traffic-images` has a 45 s TTL and returns the last good payload with `status: "stale"`
if LTA is unreachable.

---

## 6. Verification performed

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` (eslint, Next core-web-vitals + TS) | clean (0 errors, 0 warnings) |
| `npm run build` (production) | compiled, 4 routes, `/` static, both APIs dynamic |
| `node scripts/smoke.mjs` against `npm run dev` | **15/15 checks pass** (counts, live-image count, language switch both ways, layer toggle, marker click → detail card, live camera still renders 1920×1080, capture time + live badge, sources dialog, mobile 390×844 with no overflow, mobile layer sheet, no console errors) |
| `node scripts/smoke.mjs` against `npm start` (production build) | **11/11 checks pass** (marker-interaction checks are skipped in production because the `window.__map` debug handle is dev-only) |
| `npm run build:static` + local static host under `/SGRTTrafficInfo/` | **14/14 checks pass**, including the live feed fetched browser-side from data.gov.sg |
| `node scripts/smoke.mjs https://stanleycheng.github.io/SGRTTrafficInfo/` | **14/14 checks pass** on the deployed GitHub Pages site |
| Live API calls | `Traffic-Imagesv2` returns 8 cameras; `poll-download` returns the real files; a real image loaded in the browser from the LTA S3 bucket |
| Screenshots | `.cache/screens/desktop-detail.png`, `desktop-live-camera.png`, `desktop-zh.png`, `desktop-sources.png`, `mobile.png` |

Reproduce: `npm run dev` in one terminal, then `node scripts/smoke.mjs` in another.

---

## 7. Deployment

| | |
|---|---|
| Repository | https://github.com/StanleyCheng/SGRTTrafficInfo (public) |
| Live site | **https://stanleycheng.github.io/SGRTTrafficInfo/** |
| Pipeline | `.github/workflows/deploy.yml` — `npm ci` → `npm run verify` → `npm run build:static` → `actions/deploy-pages` on every push to `main` (build type: workflow) |
| Base path | `/SGRTTrafficInfo` (`next.config.ts`, `trailingSlash` on, `images.unoptimized`) |

Because GitHub Pages is static hosting, the deployed build runs in **static mode**
(`NEXT_PUBLIC_STATIC_MODE=1`, set by `scripts/build-static.mjs`):

1. `src/app/api` is moved aside for the duration of the export (route handlers are
   incompatible with `output: 'export'`) and always restored — see the script.
2. Camera layers are baked into `public/data/cameras.json` from the real captured snapshot
   `src/data/cameras-seed.json`, so the map works with no server, no key and no rate limits.
3. Live traffic images are fetched **in the browser** from the keyless official mirror
   `https://api.data.gov.sg/v1/transport/traffic-images` (CORS `*`), which publishes the same
   LTA feed (`images.data.gov.sg` stills, identical 8 cameras, per-image timestamps). The
   DataMall key is therefore never shipped to the browser.
4. Attribution follows the running mode: static mode credits *Traffic Images (live stills,
   data.gov.sg)*, server mode credits *DataMall*; the sources dialog additionally shows the
   static-build note.

To pick up newer camera data on the deployed site, re-capture the snapshot
(`GET /api/cameras?refresh=1` then `cp .cache/cameras.json src/data/cameras-seed.json`) and push.

Verified against the deployed URL: **14/14 browser checks pass**
(`node scripts/smoke.mjs https://stanleycheng.github.io/SGRTTrafficInfo/`), including that the
live feed reports “Feed updated … SGT”, a 1920×1080 official still loads in the browser, and
the console stays clean.

---

## 8. Notes for the operator

- `.env.local` holds `DATAMALL_ACCOUNT_KEY`; `.env.example` documents it. Rotate the key if
  it was shared publicly.
- Set `NEXT_PUBLIC_MAP_STYLE` to any MapLibre style URL (e.g. a CARTO/Stadia/MapTiler style
  with a key) to replace the default keyless basemap, or to `""` to force the OpenStreetMap
  raster fallback.
- The camera layers refresh at most every 6 hours; use **Retry** in the panel (or
  `GET /api/cameras?refresh=1`) to force a re-download from data.gov.sg. A full cold refresh
  takes ≈60–70 s because of the upstream rate limit.
- To re-seed the bundled snapshot: `cp .cache/cameras.json src/data/cameras-seed.json`.
