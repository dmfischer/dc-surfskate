/**
 * Fetch stage: download the DDOT layers the join needs for the configured area
 * into data/raw/ as GeoJSON in EPSG:26985 (M values kept on coordinates).
 *
 * Before each download the layer metadata is checked against the verified
 * field list in sources.ts (CLAUDE.md rule 7). Cached files are reused unless
 * `--refresh` is passed.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getSource } from "../sources.js";
import { esriToGeoJSON, getLayerInfo, queryAll, type Params } from "../lib/arcgis.js";
import { areaQueryParams, loadArea, type Area } from "../lib/area.js";
import { RAW_DIR } from "../lib/paths.js";

const WORK_WKID = 26985;

interface FetchJob {
  sourceId: string;
  file: string;
  params?: Params;
}

const JOBS: FetchJob[] = [
  { sourceId: "roadway_blocks", file: "blocks.geojson" },
  { sourceId: "pci_fy25", file: "pci_fy25.geojson" },
  // Only current events; TODATE is null for every row today, but keep the filter in case history appears.
  { sourceId: "roadway_segments", file: "roadway_segments.geojson", params: { where: "TODATE IS NULL" } },
];

/** Fail loudly if the live layer no longer has the fields recorded in sources.ts. */
async function assertFields(sourceId: string): Promise<void> {
  const src = getSource(sourceId);
  const info = await getLayerInfo(src.url);
  const live = new Set<string>((info.fields ?? []).map((f: { name: string }) => f.name));
  const missing = Object.keys(src.fields).filter((f) => !live.has(f));
  if (missing.length > 0) {
    throw new Error(
      `[fetch] ${sourceId}: layer ${src.url} is missing expected fields ${missing.join(", ")}. ` +
        `Re-audit the schema and update pipeline/src/sources.ts before fetching.`,
    );
  }
}

async function fetchLayer(job: FetchJob, area: Area): Promise<number> {
  const src = getSource(job.sourceId);
  await assertFields(job.sourceId);
  const features = await queryAll(src.url, {
    ...areaQueryParams(area),
    outSR: WORK_WKID,
    returnGeometry: true,
    returnM: true,
    ...job.params,
  });
  const fc = {
    type: "FeatureCollection",
    // Legacy GeoJSON crs member so desktop GIS reads the projected coordinates correctly.
    crs: { type: "name", properties: { name: `urn:ogc:def:crs:EPSG::${WORK_WKID}` } },
    metadata: { source: src.id, url: src.url, year: src.year ?? null, area: area.name, fetchedAt: new Date().toISOString() },
    features: features.map(esriToGeoJSON),
  };
  writeFileSync(path.join(RAW_DIR, job.file), JSON.stringify(fc));
  return features.length;
}

export async function run(opts: { refresh?: boolean } = {}): Promise<void> {
  const refresh = opts.refresh ?? process.argv.includes("--refresh");
  mkdirSync(RAW_DIR, { recursive: true });
  const pending = JOBS.filter((j) => refresh || !existsSync(path.join(RAW_DIR, j.file)));
  for (const j of JOBS) if (!pending.includes(j)) console.log(`[fetch] ${j.file}: cached (pass --refresh to re-download)`);
  if (pending.length === 0) return;

  const area = await loadArea();
  console.log(`[fetch] area: ${area.name}`);
  for (const job of pending) {
    const n = await fetchLayer(job, area);
    console.log(`[fetch] ${job.file}: ${n} features from ${job.sourceId}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await run();
}
