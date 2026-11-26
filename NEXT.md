# NEXT

Session handoff notes. Update at the end of every branch.

## Current focus

First pass of the data layers that feed scoring, for one ward (`config/area.json`, Ward 1):
DDOT blocks joined with **PCI FY-25** and **along-street grade from the 2024 1 m DTM**. No UI yet.

## Done

- `chore/pipeline-foundation`: deps (`@turf/turf`, `geotiff`, `proj4`), `config/area.json`,
  `config/pipeline.json` (fetch + grade parameters), ArcGIS client with pagination (`lib/arcgis.ts`),
  ward area loader (`lib/area.ts`). Smoke test: Ward 1 holds 874 blocks and 447 PCI FY-25 sections.

## In progress

- `feat/pci-fetch`: fetch Ward 1 blocks + PCI FY-25, join PCI onto blocks by route-measure overlap.
- `feat/dtm-grade`: export Ward 1 DTM tiles, pure grade functions with synthetic-raster tests.

## Open questions

1. PCI FY-25 has no segment id field matching blocks; join is by ROUTEID + measure overlap. Confirm
   coverage (447 sections vs 874 blocks) and how to treat blocks with no PCI.
2. Is there an IRI (roughness) layer newer than 2014?
3. Bridges: flag in first pass; DSM bridge fix later.

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
