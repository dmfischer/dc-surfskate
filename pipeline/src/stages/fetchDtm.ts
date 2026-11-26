/**
 * fetch:dtm — export the 2024 1 m DTM for the study area as GeoTIFF tiles in
 * EPSG:26985, verify them, and fetch bridge/tunnel intervals.
 *
 *   npm run fetch:dtm -w pipeline [-- --refresh]
 *
 * Outputs (gitignored):
 *   data/raw/dtm/dtm_<xmin>_<ymin>_<w>x<h>.tif + data/raw/dtm/index.json
 *   data/raw/structures.json
 *
 * exportImage with f=image streams the GeoTIFF directly (verified 2026-11-25),
 * so there is no f=json + href round trip. imageSR=26985 makes the server
 * reproject from the native EPSG:2804 so tiles align with DDOT geometry.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getJson, queryAll, type EsriFeature } from "../lib/arcgis.js";
import { areaQueryParams, loadArea, type Area } from "../lib/area.js";
import type { StructureInterval } from "../lib/grade.js";
import { loadPipelineConfig } from "../lib/pipelineConfig.js";
import { RAW_DIR } from "../lib/paths.js";
import { readGeoTiff, type DtmIndex, type DtmTileEntry, type TileCheck } from "../lib/raster.js";
import { getSource } from "../sources.js";

export const DTM_DIR = path.join(RAW_DIR, "dtm");
export const DTM_INDEX = path.join(DTM_DIR, "index.json");
export const STRUCTURES_FILE = path.join(RAW_DIR, "structures.json");

const WORK_EPSG = 26985;

interface ImageServiceInfo {
  maxImageWidth: number;
  maxImageHeight: number;
  pixelSizeX: number;
  pixelType: string;
  capabilities: string;
}

/** Split the area bbox (snapped outward to the pixel grid) into export tiles. */
export function planTiles(bbox: Area["bbox"], pixelSizeM: number, tilePx: number): DtmTileEntry[] {
  const snapDown = (v: number) => Math.floor(v / pixelSizeM) * pixelSizeM;
  const snapUp = (v: number) => Math.ceil(v / pixelSizeM) * pixelSizeM;
  const [x0, y0, x1, y1] = [snapDown(bbox[0]), snapDown(bbox[1]), snapUp(bbox[2]), snapUp(bbox[3])];
  const step = tilePx * pixelSizeM;
  const tiles: DtmTileEntry[] = [];
  for (let ty = y0; ty < y1; ty += step) {
    for (let tx = x0; tx < x1; tx += step) {
      const xmax = Math.min(tx + step, x1);
      const ymax = Math.min(ty + step, y1);
      const width = Math.round((xmax - tx) / pixelSizeM);
      const height = Math.round((ymax - ty) / pixelSizeM);
      tiles.push({ file: `dtm_${tx}_${ty}_${width}x${height}.tif`, bbox: [tx, ty, xmax, ymax], width, height });
    }
  }
  return tiles;
}

async function exportTile(url: string, tile: DtmTileEntry, file: string): Promise<void> {
  const { arcgis, dtm } = loadPipelineConfig();
  const params = new URLSearchParams({
    bbox: tile.bbox.join(","),
    bboxSR: String(WORK_EPSG),
    imageSR: String(WORK_EPSG),
    size: `${tile.width},${tile.height}`,
    format: "tiff",
    pixelType: "F32",
    noData: String(dtm.nodataValue),
    interpolation: "RSP_BilinearInterpolation",
    f: "image",
  });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= dtm.requestRetries; attempt++) {
    try {
      const res = await fetch(`${url}/exportImage?${params}`, { headers: { "User-Agent": arcgis.userAgent } });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("tiff")) {
        throw new Error(`exportImage HTTP ${res.status} (${type}): ${(await res.text()).slice(0, 300)}`);
      }
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`[fetch:dtm] ${tile.file} attempt ${attempt} failed: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, arcgis.requestDelayMs * attempt * 5));
    }
  }
  throw lastErr;
}

/** Read a tile back and fail loudly unless it is what we asked for. */
export async function verifyTile(file: string, tile: DtmTileEntry): Promise<TileCheck> {
  const { dtm } = loadPipelineConfig();
  const { raster, check } = await readGeoTiff(file);
  const fail = (msg: string): never => {
    throw new Error(`[fetch:dtm] ${path.basename(file)} failed verification: ${msg}`);
  };
  if (check.epsg !== WORK_EPSG) fail(`ProjectedCSTypeGeoKey ${check.epsg}, expected ${WORK_EPSG}`);
  if (check.rasterType !== 1) fail(`GTRasterTypeGeoKey ${check.rasterType}, expected 1 (PixelIsArea)`);
  for (const p of [check.pixelSizeX, check.pixelSizeY]) {
    if (Math.abs(p - dtm.pixelSizeM) > dtm.pixelSizeToleranceM) fail(`pixel size ${p}, expected ${dtm.pixelSizeM}`);
  }
  if (raster.width !== tile.width || raster.height !== tile.height) fail(`size ${raster.width}x${raster.height}, expected ${tile.width}x${tile.height}`);
  if (Math.abs(raster.originX - tile.bbox[0]) > dtm.pixelSizeToleranceM || Math.abs(raster.originY - tile.bbox[3]) > dtm.pixelSizeToleranceM) {
    fail(`origin (${raster.originX}, ${raster.originY}), expected (${tile.bbox[0]}, ${tile.bbox[3]})`);
  }
  if (check.gdalNodata !== dtm.nodataValue) fail(`GDAL_NODATA ${check.gdalNodata}, expected ${dtm.nodataValue}`);

  let min = Infinity;
  let max = -Infinity;
  let nodataCount = 0;
  for (const v of raster.data) {
    if (Number.isNaN(v) || v === dtm.nodataValue || v < dtm.nodataBelowM) {
      nodataCount++;
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const total = raster.data.length;
  if (nodataCount === total) fail("every pixel is nodata");
  if (min < dtm.plausibleMinM || max > dtm.plausibleMaxM) fail(`elevation range ${min.toFixed(2)}–${max.toFixed(2)} m outside plausible ${dtm.plausibleMinM}–${dtm.plausibleMaxM} m`);
  return { ...check, min, max, nodataCount, total };
}

// ---------------------------------------------------------------------------
// Bridges and tunnels

/** Fail if a layer no longer has the fields we rely on (CLAUDE.md rule 7). */
async function assertFields(layerUrl: string, required: string[]): Promise<void> {
  const info = await getJson<{ fields?: { name: string }[] }>(layerUrl);
  const names = new Set((info.fields ?? []).map((f) => f.name));
  const missing = required.filter((f) => !names.has(f));
  if (missing.length) throw new Error(`[fetch:dtm] ${layerUrl} is missing fields ${missing.join(", ")}; update sources.ts`);
}

export async function fetchStructures(area: Area): Promise<StructureInterval[]> {
  const bridge = getSource("lrs_bridge");
  const structure = getSource("lrs_structure");
  const bridgeFields = ["ROUTEID", "FROMMEASURE", "TOMEASURE", "TODATE", "BRIDGE_NAME", "BRIDGE_TYPE", "BRKEY"];
  const structureFields = ["ROUTEID", "FROMMEASURE", "TOMEASURE", "TODATE", "STRUCTURE_TYPE", "VALUETEXT"];
  await assertFields(bridge.url, bridgeFields);
  await assertFields(structure.url, structureFields);

  const common = { ...areaQueryParams(area), returnGeometry: false };
  const bridges = await queryAll(bridge.url, { ...common, where: "TODATE IS NULL", outFields: bridgeFields.join(",") });
  const structs = await queryAll(structure.url, {
    ...common,
    where: "TODATE IS NULL AND STRUCTURE_TYPE IN (1,2)",
    outFields: structureFields.join(","),
  });

  const str = (v: unknown) => (typeof v === "string" && v.trim() && v !== "-1" ? v.trim() : null);
  const toInterval = (f: EsriFeature, type: StructureInterval["type"], name: string | null, source: string): StructureInterval => ({
    routeId: String(f.attributes.ROUTEID),
    from: Number(f.attributes.FROMMEASURE),
    to: Number(f.attributes.TOMEASURE),
    type,
    name,
    source,
  });
  return [
    // BRIDGE_TYPE is "Bridge" or "Pedestrian"; either way the route is on a deck, not the DTM ground.
    ...bridges.map((f) => toInterval(f, "bridge", str(f.attributes.BRIDGE_NAME) ?? str(f.attributes.BRKEY), bridge.id)),
    ...structs.map((f) =>
      toInterval(f, f.attributes.STRUCTURE_TYPE === 2 ? "tunnel" : "bridge", str(f.attributes.VALUETEXT), structure.id),
    ),
  ];
}

// ---------------------------------------------------------------------------

export async function run(opts: { refresh?: boolean } = {}): Promise<void> {
  const cfg = loadPipelineConfig();
  const src = getSource("dtm_2024");
  const info = await getJson<ImageServiceInfo>(src.url);
  if (!info.capabilities?.includes("Image")) throw new Error(`[fetch:dtm] ${src.url} lacks the Image capability (${info.capabilities})`);
  if (info.pixelType !== "F32") throw new Error(`[fetch:dtm] unexpected service pixelType ${info.pixelType}`);
  const tilePx = Math.min(cfg.dtm.exportTilePx, info.maxImageWidth, info.maxImageHeight);

  const area = await loadArea();
  const tiles = planTiles(area.bbox, cfg.dtm.pixelSizeM, tilePx);
  console.log(
    `[fetch:dtm] ${area.name}: bbox ${area.bbox.map((v) => v.toFixed(0)).join(",")} → ${tiles.length} tiles of ≤ ${tilePx} px ` +
      `(service max ${info.maxImageWidth}×${info.maxImageHeight})`,
  );

  mkdirSync(DTM_DIR, { recursive: true });
  for (const [i, t] of tiles.entries()) {
    const file = path.join(DTM_DIR, t.file);
    const cached = existsSync(file) && !opts.refresh;
    if (!cached) {
      await exportTile(src.url, t, file);
      await new Promise((r) => setTimeout(r, cfg.arcgis.requestDelayMs));
    }
    const c = await verifyTile(file, t);
    console.log(
      `[fetch:dtm] ${i + 1}/${tiles.length} ${t.file} ${cached ? "(cached)" : "(downloaded)"} ` +
        `EPSG:${c.epsg} ${c.pixelSizeX}×${c.pixelSizeY} m, z ${c.min.toFixed(2)}–${c.max.toFixed(2)} m, ` +
        `nodata ${c.nodataCount}/${c.total} (${((100 * c.nodataCount) / c.total).toFixed(2)}%)`,
    );
  }

  const index: DtmIndex = {
    source: src.id,
    url: src.url,
    crs: `EPSG:${WORK_EPSG}`,
    pixelSizeM: cfg.dtm.pixelSizeM,
    nodata: cfg.dtm.nodataValue,
    fetchedAt: new Date().toISOString(),
    tiles,
  };
  writeFileSync(DTM_INDEX, JSON.stringify(index, null, 2));
  console.log(`[fetch:dtm] wrote ${path.relative(process.cwd(), DTM_INDEX)}`);

  const structures = await fetchStructures(area);
  writeFileSync(STRUCTURES_FILE, JSON.stringify(structures, null, 2));
  const count = (t: string) => structures.filter((s) => s.type === t).length;
  console.log(`[fetch:dtm] wrote ${structures.length} structure intervals (bridge ${count("bridge")}, tunnel ${count("tunnel")}) → ${path.relative(process.cwd(), STRUCTURES_FILE)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await run({ refresh: process.argv.includes("--refresh") });
}
