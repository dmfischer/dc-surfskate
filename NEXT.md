# NEXT

Session handoff notes. Update at the end of every branch.

## Current focus

First pass of the data layers that feed scoring, for **Wards 1 and 4** (`config/area.json`):
DDOT blocks joined with **PCI FY-25** and **along-street grade from the 2024 1 m DTM**, exported for a map viewer.

## Done

- `chore/pipeline-foundation`: deps, `config/area.json`, `config/pipeline.json`, ArcGIS client (`lib/arcgis.ts`), ward loader (`lib/area.ts`).
- `feat/pci-fetch`, `feat/dtm-grade`: see sections below. Merged into `feat/data-layers`.
- `feat/data-layers`: export stage (`stages/export.ts`) writes `data/output/segments.geojson` (EPSG:4326) and
  `data/output/summary.json`. `npm run build` runs fetch → join → fetch:dtm → grade → export (`-- --refresh` re-downloads).
  Ward 1: 873 segments (1 duplicate DDOT block dropped), 110.4 km; PCI on 450, |grade| <1% 335 / 1–4% 387 / 4–6% 114 /
  6–8% 21 / >8% 16; 6 bridge-flagged.
  Reprojection uses proj4 NAD83 → WGS84 with no datum shift; ArcGIS's own outSR=4326 differs by ~0.9 m (HARN transform). Fine for display.
- `feat/map-viewer`: `/web` (Vite + React + MapLibre 6). `npm run pipeline` then `npm run web`. Loads
  `data/output/segments.geojson` via a small Vite plugin that serves `/data/*` in dev and copies it into `dist/data` on build.
  Modes: Pavement condition, Grade (|mean|), Smooth & gentle (PCI ≥ 80 and 1–4%). Styling and breaks in `config/map.json`.
  Basemap: OpenFreeMap Positron (no API key). Bridge / unreliable grades render dashed gray.
  Gotchas: MapLibre 6 loads `maplibre-gl-worker.mjs` relative to its module, so `optimizeDeps.exclude: ["maplibre-gl"]`
  is required; and it has no default export (use named imports). `window.__map` is exposed in dev for debugging.
- `feat/ward-4`: `config/area.json` takes `wards: [1, 4]`. Raw downloads record an `areaKey` and re-fetch when the
  configured wards change; fetch writes ward polygons to `data/raw/area.json`; export tags each segment with the ward
  containing its midpoint (`ward`, null when it lies just outside, e.g. a border block whose midpoint is in Ward 2).
  Result: 3,076 segments (Ward 1: 772, Ward 4: 2,179, outside: 125), 399 km; PCI on 1,202; 18 bridge + 1 tunnel flagged.
  DTM: 20 tiles; the NE corner tile is all nodata (Maryland, outside DC LiDAR) and is kept with a warning, not an error.
  DDOT returns 3 duplicate blocks across the two wards (dropped in export).

## Next

- DSM bridge correction; dedupe the duplicate block in `join`; null-PCI policy for scoring; Adams Mill Rd jump check.

## Open questions

1. Null PCI (423 of 873 Ward 1 blocks): drop the surface sub-factor (rule 4) or back-fill from FY-24 and earlier?
2. DSM bridge correction method and validation.

## feat/dtm-grade

**Done.** `npm run fetch:dtm -w pipeline` then `npm run grade -w pipeline`.

- **Service:** `Lidar/Hydro_Enforced_DTM_2024/ImageServer` `exportImage` with `f=image` streams the
  GeoTIFF directly (`f=json` returns an href instead). `imageSR=bboxSR=26985`, F32, `noData=-9999`, bilinear.
  Tiles come back with ProjectedCSTypeGeoKey 26985, PixelIsArea, origin = requested bbox corner, GDAL_NODATA
  = requested value. Service max export 15000 × 4100 px; we use 2000 px tiles (~16.8 MB, ~3.5 s each).
- **Ward 1:** 6 tiles (≈1354 × 1709 px) covering the ward bbox + 300 m (`dtm.tileMarginM`; blocks that touch
  the ward run up to ~220 m past the 50 m-buffered bbox). 0 nodata pixels; z 2.5–99.5 m.
- **Grade stage** on 874 real Ward 1 blocks (873 unique BlockIDs): 873 graded; |grade_mean| <1 % 338,
  1–4 % 384, 4–6 % 114, 6–8 % 21, >8 % 16 (max 11.7 %, Lamont St dead end). Flags: **bridge 6**,
  **insufficient_elevation 0**, **tunnel 0**, outside_dtm 0.
- **Validation:** Calvert St Biltmore → Woodley (bridge block) +1.83 %, std 65.8 vs the research doc's DTM
  +1.86 %, std 66.2. Five blocks re-sampled server-side with `getSamples` (native 2804) agree on
  `grade_mean` within 0.03 pp and `last20m` within 0.13 pp, so the 26985 reprojection is harmless for grade.
  The research doc's other Calvert blocks (39th St, Shoreham → 28th) are in Ward 3, not Ward 1.
- `grades.json` is keyed by BlockID, A→B stats (+ = downhill); use `directGrade()` for AB/BA.
  Tunnel blocks get null grades; bridge blocks keep (wrong) DTM values plus `grade_flag: "bridge"`.

**Surprises / follow-ups**

- **DSM bridge fix not done** (out of scope): bridge blocks still carry DTM valley values (Calvert std 66,
  Taft/Connecticut std 24, 16th St over Piney Branch std 30). Next: sample `dsm_2024` inside bridge intervals
  with a 5-point median, `grade_source: "dtm+dsm_bridge"`.
- Bridge intervals in `lrs_bridge` and `lrs_structure` disagree by a few metres (and Taft: 205 vs 402 m);
  we union both. `lrs_structure` has rows with null STRUCTURE_TYPE (3 in Ward 1), currently ignored.
- RoadwayBlocks returns one exact duplicate feature (`11090872-11048752_11090872-11052322_11090872`,
  Warder St Irving → Kenyon); the grade stage warns and keeps one. The blocks stage should dedupe.
- Adams Mill Rd: Ontario → Harvard ends at 26.7 m but Harvard → Irving starts at 21.3 m, and both have
  std ≈ 3. Possibly a culvert/hydro-enforcement trench or a stream crossing not in the bridge layers; check
  against the hydro breaklines (research §4 step 5) before trusting the >8 % there.
- `build.ts` does not call `fetchDtm` yet (outside this branch's file boundary).


## feat/pci-fetch

Delivered: `npm run fetch -w pipeline` (add `-- --refresh` to re-download) writes `data/raw/{blocks,pci_fy25,roadway_segments}.geojson`;
`npm run join -w pipeline` writes `data/intermediate/blocks.geojson` (874 Ward 1 blocks, EPSG:26985, 2D LineStrings).

Contract notes for the grade stage:
- Geometry runs A→B = `FromMeasure`→`ToMeasure` (every block's first/last M equals From/ToMeasure).
- Roadway segment geometry is digitized in increasing measure, so `DIRECTIONALITY` 0 → `oneway_direction: "AB"`, 1 → `"BA"`.
  `oneway` is null (not false) when directionality is 3 or no segment overlaps (7 small blocks: service courts etc.).
- `pci*` fields are null when PCI covers less than `join.minPciCoverage` (config/pipeline.json, 0.5) of the block.

Ward 1 result: PCI on 451/874 blocks (55 of 110 km), min 37.5 / max 100 / mean 86.9. Coverage is all-or-nothing:
423 blocks at 0, 449 at ≥0.99, 2 in between. Directionality: 626 two-way, 119 one-way A→B, 122 one-way B→A, 7 null.

Research answers (verified 2026-11-25, User-Agent `dc-surfskate/0.1`):
1. **PCI ↔ block ids.** No usable id. In `DDOT/PavementConditionIndex/MapServer/5` (FY-25), `HPMSID`, `UNIQUEID`, `NETWORKID`,
   `BRANCHID` are null for all 5,741 rows (`where=HPMSID IS NOT NULL&returnCountOnly=true` → 0, same for the others), and
   `SECTIONID` is a per-route sequence ("001", "029"). No `BlockID`/`STREETSEGID` field. ROUTEID + measure is the only join.
   Sections align with blocks well: 404/447 Ward 1 sections have both ends within 1 m of a block end. Coverage as above;
   the uncovered blocks are mostly local streets (T, V, W, S St, 17th–19th St NW). 103 of them are on routes that have PCI
   elsewhere; the other 320 are on routes with no FY-25 PCI at all. FY-24 and earlier (layers 0–14) may fill gaps; not tried.
2. **IRI newer than 2014.** Yes, but not much newer. `https://maps2.dcgis.dc.gov/DCGIS/rest/services/DDOT/Pavement/MapServer?f=json`
   has only PCI 2012/2013/2014 and IRI 2014 (layer 3, 14,816 rows, fields SSRSEGID, IRI, Lane1..10, BikeLane1..2).
   `https://rh.dcgis.dc.gov/dcgis/rest/services/DDOT/DDOTLRS/MapServer/39` (IRI) is an LRS event layer: ROUTEID, FROMMEASURE,
   TOMEASURE, IRI (int), IRI_DATE, VALUE_DATE, IRI_VALUE_TEXT, FROMDATE, TODATE. 22,412 rows; IRI_DATE 2010-05 to 2020-01
   (2014: 8,150, 2017: 7,129, 2019: 6,607, 2020: 209); TODATE null for all, so several survey years overlap per interval.
   Ward 1: 1,745 events; covers ~51% of block length (40% with 2019+ data only), and nearly the same blocks as PCI
   (only 11 null-PCI blocks gain IRI ≥ 0.5 coverage). It does not fill the local-street gap.

Next: decide what null PCI means for scoring (drop the surface sub-factor per rule 4, or back-fill from older PCI years).
