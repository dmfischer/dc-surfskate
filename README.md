# DC Surfskate Spots

A web app that finds good surf skating streets in Washington, DC by combining public data on **recently paved roads**, **street gradients**, **traffic volume**, and **live weather**.

> Status: planning / pre-implementation. The scoring model is defined (below); the data pipeline and frontend are not built yet.

---

## How it works

Every block-length street segment in DC is scored **once per direction of travel** (A→B and B→A), because a 3% grade is a cruise downhill and a slog uphill.

```
finalScore = staticScore (batch, from city data) × conditionsMultiplier (live, from weather/time)
```

- **Static score** is computed by a scheduled Node pipeline and written to a GeoJSON file. It only changes when DC publishes new data.
- **Conditions multiplier** is computed at request time from the NWS forecast. DC spans only a few NWS grid cells, so this is a handful of cached API calls.

## Architecture

```
┌────────────────────┐   weekly/nightly    ┌──────────────────────────┐
│ pipeline/ (Node)   │ ──────────────────▶ │ segments.scored.geojson  │
│ fetch → join →     │                     │ (static hosting / CDN)   │
│ grade → score      │                     └────────────┬─────────────┘
└────────────────────┘                                  │
                                                        ▼
┌────────────────────┐   /api/conditions   ┌──────────────────────────┐
│ api/ (serverless)  │ ◀────────────────── │ web/ (React + map)       │
│ NWS proxy + cache  │ ──────────────────▶ │ static × conditions      │
└────────────────────┘                     └──────────────────────────┘
```

- **No always-on server needed for v1.** The heavy lifting (joining datasets, sampling 1 m LiDAR) is batch work.
- **One serverless function** proxies the NWS API so it can send a proper `User-Agent` and cache responses (~30 min per grid cell).
- A full Node server (Express + PostGIS) only becomes necessary for accounts, saved spots, or user-submitted reports.

### Planned layout

```
/pipeline        Node scripts: fetch datasets, join to segments, compute grade, score
/api             Serverless function(s): GET /api/conditions
/web             React app (Vite + TypeScript), MapLibre GL or Leaflet
/config          scoring.json — all weights, thresholds, and curves
/data            Generated artifacts (gitignored): raw downloads, intermediate files, scored GeoJSON
/labels          Hand-labeled ground-truth segments for tuning weights
```

### Planned stack

| Area | Choice |
|---|---|
| Frontend | React, TypeScript, Vite, MapLibre GL (or Leaflet) |
| Pipeline | Node + TypeScript, `@turf/turf`, `geotiff`, ArcGIS REST queries |
| API | Serverless function (Vercel / Netlify) or a small Express route |
| Storage (later) | PostGIS, if spatial queries or user data are needed |

---

## Scoring model

All numbers below are **starting guesses** to be tuned against hand-labeled segments. They live in `config/scoring.json`, never hard-coded.

### Hard filters (segment excluded entirely)

- Freeways, ramps, limited-access roads
- Directional grade steeper than **8% downhill**
- AADT above **15,000**
- Brick, cobble, or unpaved surface
- No elevation data (LiDAR redaction zones in the federal core)

### Static score

```ts
staticScore = 0.35 * surface + 0.25 * grade + 0.25 * traffic + 0.15 * runQuality
```

**Surface (0.35)**
- `freshness`: 1.0 if paved < 6 months ago, decaying to 0 at ~3 years
- `condition`: DDOT pavement condition rating normalized to 0–1
- `surface = max(freshness, condition) × materialFactor` (asphalt 1.0, concrete 0.6)
- Penalty for open 311 pothole requests on the segment

**Grade (0.25)**, for downhill grade in the direction of travel

| Directional grade | Score |
|---|---|
| 0–1% downhill | 0.6 (flat is pumpable) |
| 1–4% downhill | 1.0 (sweet spot) |
| 4–6% downhill | 0.6 |
| 6–8% downhill | 0.2 |
| Uphill | 0.6 tapering to 0.2 at ~3% uphill |

Penalties: high grade variance along the segment (dips/kickers), and a steep last 20 m ("hot into the intersection").

**Traffic (0.25)**
- Log decay on AADT: 1.0 at < 1,000 → 0 at 15,000
- Missing AADT is imputed from functional class (e.g. local ≈ 800, collector ≈ 5,000) and flagged `aadt_imputed`
- Bonuses: bike lane, 20 mph limit

**Run quality (0.15)**
- Segment length (longer is better, capped ~400 m)
- Controlled stop at the bottom of a downhill (positive)
- Crash history (penalty)
- Width / parking lanes, if available

### Conditions multiplier (live, 0–1, product of factors)

| Factor | Rule |
|---|---|
| Wetness | 0 if raining now or > ~2 mm in the last 6 h; otherwise scaled by precipitation probability |
| Temperature | 1.0 between 50–85°F; trends to 0 below ~35°F |
| Wind | Penalty above ~15 mph sustained |
| Daylight | Drops to ~0.3 after dark |
| Leaf season | Small fixed penalty in Oct–Nov (wet leaves on downhills) |

---

## Data sources

| Data | Source | Notes |
|---|---|---|
| Street segments (join key) | Open Data DC: Roadway Blocks / Street Centerlines | Geometry, functional class, one-way, speed limit |
| Paving projects | DDOT Paving Plan / PaveDC (ArcGIS item `76784c82ddcb4fb798769138f27c0ed3`) | Open-data copy may lag; the live PaveDC map layer may be fresher. Paving season is spring–fall. |
| Paving (secondary) | DDOT Weekly Construction Updates | Press releases, two-week lookahead, not an API |
| Pavement condition | DDOT Pavement Management System | **Unverified** whether block-level ratings are public |
| Potholes | Open Data DC: 311 service requests | Snap to nearest segment |
| Elevation / grade | Open Data DC: 2024 LiDAR Hydro-Enforced Digital Terrain Model (1 m) | Redacted areas near federal sites. GeoTIFFs may require emailing open.data@dc.gov; NOAA Digital Coast also mirrors DC DEMs. |
| Traffic volume | Open Data DC: 2024 Traffic Volume (AADT by roadway block) | Counts are on a 3-year cycle at HPMS locations; many local streets have no count |
| Bike lanes, crashes | Open Data DC | |
| Intersection controls | **Unverified** | Hardest field; optional for v1 |
| Weather | National Weather Service API (`api.weather.gov`) | Free, no key; requires an identifying `User-Agent` header |

Useful endpoints:
- 2024 Traffic Volume GeoJSON: `https://opendata.dc.gov/api/download/v1/items/948099175f3a44cca2d6a633cf3ec35a/geojson?layers=5`
- DC GIS ArcGIS REST root: `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/`
- NWS: `GET https://api.weather.gov/points/{lat},{lon}` → `forecastHourly` URL for that grid cell

---

## Roadmap

1. **Data audit**: confirm which schema fields exist at block level (especially pavement condition and intersection controls).
2. **Pipeline v0**: download segments + AADT + paving, join on block ID / geometry, write GeoJSON.
3. **Grade**: sample the 1 m DTM every ~5 m along each segment; compute `grade_mean`, `grade_std`, `grade_last20m` per direction.
4. **Scoring**: implement `scoreSegment()` driven by `config/scoring.json`; add unit tests for each curve.
5. **Conditions API**: serverless NWS proxy with caching.
6. **Frontend**: map colored by final score, segment detail panel showing component breakdown and data confidence.
7. **Tuning**: hand-label 15–20 known DC blocks in `/labels`, adjust weights until rankings match.
8. **Later**: chain adjacent segments into "runs"; user reports; accounts.

## Safety note

Scores are an estimate from public data, not a guarantee of road conditions. Always check the street in person, watch for traffic, and wear protective gear.
