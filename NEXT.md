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
  See the `feat/dtm-grade` section below.

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

## Open questions

1. PCI FY-25 has no segment id field matching blocks; join is by ROUTEID + measure overlap. Confirm
   coverage (447 sections vs 874 blocks) and how to treat blocks with no PCI.
2. Is there an IRI (roughness) layer newer than 2014?
3. Bridges: flag in first pass; DSM bridge fix later.
