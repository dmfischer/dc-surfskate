# CLAUDE.md

Context for AI coding assistants working in this repo. Read README.md for the full scoring model and data sources.

## Project in one paragraph

A React web app that ranks Washington, DC street segments for surf skating. A batch Node pipeline joins DC open data (paving, LiDAR elevation, traffic volume, street attributes) onto **directed street segments** and computes a `staticScore`. A small serverless function proxies the National Weather Service API to compute a live `conditionsMultiplier`. The frontend shows `staticScore × conditionsMultiplier` on a map.

## Current status

Pre-implementation. The scoring model is designed; no code exists yet. The next step is the **data audit**: confirm which fields DC publishes at block level before building the pipeline.

## Stack and conventions

- **TypeScript everywhere** (web, pipeline, api). Node LTS. npm workspaces for `/web`, `/pipeline`, `/api`.
- **Frontend:** React + Vite, MapLibre GL (preferred) or Leaflet. No backend calls except `/api/conditions` and loading the static scored GeoJSON.
- **Pipeline:** plain Node scripts, runnable individually (`fetch`, `join`, `grade`, `score`) and as one `build` command. Use `@turf/turf` for geometry and `geotiff` for raster sampling.
- **Coordinates:** store and serve GeoJSON in WGS84 (EPSG:4326). DC ArcGIS services often return Web Mercator (3857); reproject on ingest. Compute distances/grades in meters with a projected CRS or geodesic math, never raw degrees.
- **Generated data goes in `/data` and is gitignored.** Never commit raw downloads, LiDAR tiles, or scored output.

## Rules that matter

1. **All scoring weights, thresholds, and curve breakpoints live in `config/scoring.json`.** Do not hard-code numbers in scoring logic. The current values are guesses meant to be tuned.
2. **Segments are directed.** Every two-way block produces two records (A→B, B→A); one-way blocks produce one, in the legal direction only. Grade sign depends on direction: positive = downhill in the direction of travel.
3. **Hard filters run before scoring** and drop segments entirely (freeways/ramps, > 8% downhill, AADT > 15,000, brick/unpaved, missing elevation). Keep filtered-out segments in a separate debug output with the reason.
4. **Track data confidence.** When a value is imputed (e.g. AADT from functional class) set a flag like `aadt_imputed: true`. Missing optional fields (e.g. `bottom_control`) should drop that sub-factor out of the weighted average, not score as 0.
5. **Scoring functions are pure** and unit-tested. Each component (`surface`, `grade`, `traffic`, `runQuality`, each conditions factor) is its own function taking normalized inputs plus config and returning 0–1.
6. **NWS API:** requests must send an identifying `User-Agent` (e.g. `dc-surfskate/0.1 (contact email)`). Always call it from `/api`, never directly from the browser. Cache per grid cell (~30 min). Store each segment's NWS grid cell during the pipeline so the API doesn't need a `/points` lookup per request.
7. **Don't guess dataset schemas.** DC open data field names change by year (e.g. separate Traffic Volume datasets per year). Before writing a join, fetch a sample and inspect actual field names; record them in `pipeline/sources.ts` with the dataset URL and year.
8. **LiDAR redaction zones** (federal core / White House area) have missing or degraded elevation. Detect nodata values and exclude, don't interpolate across them.

## Segment record shape (target)

```ts
interface ScoredSegment {
  segment_id: string;          // block id + direction suffix, e.g. "12345_AB"
  geometry: GeoJSON.LineString;
  direction: "AB" | "BA";
  functional_class: string;
  oneway: boolean;
  speed_limit_mph?: number;
  surface_material?: "asphalt" | "concrete" | "brick" | "other";
  paved_date?: string;         // ISO date
  condition_rating?: number;   // raw DDOT value
  open_potholes: number;
  grade_mean: number;          // percent, + = downhill in travel direction
  grade_std: number;
  grade_last20m: number;
  length_m: number;
  aadt: number;
  aadt_imputed: boolean;
  has_bike_lane: boolean;
  crash_count_3yr?: number;
  bottom_control?: "stop" | "signal" | "none";
  nws_grid: { office: string; x: number; y: number };
  scores: { surface: number; grade: number; traffic: number; runQuality: number; static: number };
}
```

## Open questions (verify before relying on them)

- Is DDOT pavement condition published per block on Open Data DC?
- Does the paving plan layer include a completion date, or only planned season/status?
- Is there a public intersection-control (stop sign / signal) dataset that can be joined to segment endpoints?
- Best way to obtain the 2024 1 m DTM as GeoTIFF (Open Data DC image service export vs. requesting tiles vs. NOAA Digital Coast mirror).

## Working preferences

- Propose small, testable increments; get one dataset flowing end-to-end before adding the next.
- When adding a data source, update the Data sources table in README.md.
- When changing a scoring rule, update both `config/scoring.json` and the Scoring model section of README.md.
