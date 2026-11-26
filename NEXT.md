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
