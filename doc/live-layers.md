# Live driver overlays · 實時路況圖層

**Feature note · 2026-09-22**

The server-hosted map now adds official live driver overlays from LTA DataMall and data.gov.sg.
These overlays complement the camera inventory; they are not inferred traffic data and no location,
charge or speed limit is invented when an official source does not publish one.

Nine layers, in the agreed priority order. Layers 1–2 start switched on, the other seven start off.

| # | Driver layer | Source | Cache TTL | What is shown |
|---|---|---:|---:|---|
| 1 | Live congestion | Traffic Speed Bands v4 | 5 min | Speed band + published min/max speed over the feed's start/end coordinates — a **schematic endpoint segment**, not full road geometry. |
| 2 | Accidents & breakdowns | Traffic Incidents | 2 min | Point incidents: accidents, breakdowns, obstructions, diversions. |
| 3 | Flood alerts & signal faults | PUB Flood Alerts; Faulty Traffic Lights | 3 min / 2 min | Flood alerts where the published circle is readable as coordinates; faulty-light reports are listed but unmapped (no coordinates published). |
| 4 | Roadworks & planned closures | Approved Road Works; Planned Road Openings; live works in Traffic Incidents | 24 h / 24 h / 2 min | Permit register (unmapped, no site geometry) plus live works that carry direction and lane. |

## Layers 5–9 · route-aware extras

| # | Driver layer | Source | Cache TTL | What is shown |
|---|---|---:|---:|---|
| 5 | Parking availability | Carpark Availability v2 (`CarParkAvailabilityv2`) + HDB Carpark Information | 1 h / 24 h | One row per carpark and LTA lot type (C/H/Y), with live `AvailableLots`, the development/area and the published gantry height. The two datasets are joined on the official carpark code (`CarParkID` = `car_park_no`); URA/LTA carparks simply have no gantry height and the detail panel says "Not published". The feed also returns an undocumented `S` lot type, shown as the raw code rather than mislabelled. |
| 6 | ERP gantries & charges | LTA Gantry (data.gov.sg, 106 ERP spans) + ERP rate table | 24 h / 6 h | A route cost summary in the panel, not many markers: each zone shows the current charge and window plus the next one. Zone names come from ANNEX D of the LTA DataMall API guide, kept verbatim in `src/data/erp-zones.json`. Gantry spans appear on the map only from zoom 14. |
| 7 | EV charging | EV Charging Points Batch (`EVCBatch`) | 5 min | One row per (location, connector, power rating) so the connector filter stays exact; live availability is counted from the published status codes (0 occupied, 1 available, 100 unavailable). The live feed reports the rating in `powerRating` (kW); the separate `chargingSpeed` documented in the API guide is read when present. |
| 8 | School & silver zones | LTA School Zone (211) + LTA Silver Zone (20), data.gov.sg GeoJSON | 24 h | Boundaries as a **zoom-gated overlay from zoom 14**, with the statutory zone limit (school zone 40 km/h; a silver-zone sign may set 30 km/h on a particular street). Multi-part zones are drawn parcel by parcel so no published boundary is dropped. |
| 9 | Expressway times & EMAS | Estimated Travel Times + VMS / EMAS | 5 min / 2 min | Compact corridor cards (segment times summed per corridor and direction, ending at the published far end point) and a short list of the messages currently displayed on EMAS signboards. Deliberately **no map layer** — this is the one place where map markers would be clutter. |

### Two official gaps, reported not filled

- **ERP charges.** LTA removed the live `ERPRates` API on 30 Sep 2024 and publishes the rate table as
a static file; the endpoint now answers HTTP 404. The layer therefore reports `partial`, links to
the official OneMotoring table and shows **no amount** rather than a guessed charge. The rate parser
is left in place (flat and nested payload shapes both handled) so the summary starts working again
if LTA republishes a machine-readable table.
- **Speed limits.** No official per-road speed-limit dataset is published as open data. Only the
statutory zone limits are shown, and the panel states that a silver-zone sign may set 30 km/h on a
particular street.

## Server behaviour · 伺服器模式

`/api/road-conditions` aggregates all nine layers: eleven credentialled LTA DataMall feeds and four
keyless data.gov.sg datasets. The DataMall Account Key stays in `DATAMALL_ACCOUNT_KEY` on the server
and is never sent to the browser. Each paginated feed is read through DataMall's 500-record `$skip`
pages, with at most 320 pages accepted to prevent an unbounded response; the EV batch endpoint is
followed through its short-lived presigned link.

Fresh responses are retained in memory and `.cache` using the source TTLs above. A request after
expiry refreshes the source; if the upstream is unavailable, a recent successful payload is served
as `stale` only within that feed's maximum stale age. With no usable cache, that source is reported
as unavailable; mixed source health is reported as `partial`. Public callers cannot bypass source
TTLs. The API response uses `Cache-Control: public, max-age=60, stale-while-revalidate=300` when
healthy and `no-store` when degraded.

`?layers=` narrows only the returned feature list, so the browser fetches the geometry it has
switched on while layer counts and feed health stay complete for every layer.

## Static GitHub Pages behaviour · 靜態模式

GitHub Pages has no Node API route or protected credential store. In static mode the driver overlays
are explicitly unavailable rather than making a credentialed request from the browser or embedding
`DATAMALL_ACCOUNT_KEY`. The static camera snapshot and keyless data.gov.sg traffic-image feed
continue to work; the overlays require the server-hosted app even where their upstream happens to be
keyless, because they all arrive through the one aggregation route.
