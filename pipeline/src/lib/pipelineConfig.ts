import { readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./paths.js";

export interface PipelineConfig {
  crs: { work: string; output: string };
  arcgis: { userAgent: string; pageSize: number; requestDelayMs: number };
  dtm: {
    /** Max width/height (px) of one exportImage tile; clamped to the service's maxImageWidth/Height. */
    exportTilePx: number;
    /**
     * Extra margin (m) around the area bbox when tiling. Blocks that intersect the
     * ward can run well outside it (Ward 1: up to ~220 m beyond the 50 m-buffered bbox).
     */
    tileMarginM: number;
    pixelSizeM: number;
    /** Value passed as exportImage noData= and expected back in the GeoTIFF's GDAL_NODATA tag. */
    nodataValue: number;
    /** Samples below this elevation are treated as nodata. */
    nodataBelowM: number;
    /** Allowed |pixel size − pixelSizeM| when verifying a tile. */
    pixelSizeToleranceM: number;
    /** Valid DTM values outside [plausibleMinM, plausibleMaxM] fail tile verification. */
    plausibleMinM: number;
    plausibleMaxM: number;
    /** Attempts per exportImage request before giving up. */
    requestRetries: number;
  };
  grade: {
    sampleSpacingM: number;
    endWindowM: number;
    localGradeWindowM: number;
    medianWindow: number;
    minCoverage: number;
    maxGapM: number;
    /** A bridge/tunnel interval must overlap a block by more than this (m) to flag it. */
    structureMinOverlapM: number;
  };
  join: {
    /** Minimum fraction (0–1) of a block's length covered by PCI sections before PCI is reported. */
    minPciCoverage: number;
  };
  export: {
    /** Decimal places for output lon/lat (6 ≈ 0.1 m). */
    coordDecimals: number;
    /** Ascending edges for summary PCI buckets. */
    pciBucketEdges: number[];
    /** Ascending edges for summary |grade_mean| buckets (%). */
    absGradeBucketEdges: number[];
  };
}

export interface AreaConfig {
  name: string;
  /** Ward numbers (2022 boundaries) processed together. */
  wards: number[];
  bufferM: number;
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(CONFIG_DIR, name), "utf8")) as T;
}

export const loadPipelineConfig = (): PipelineConfig => readJson<PipelineConfig>("pipeline.json");
export const loadAreaConfig = (): AreaConfig => readJson<AreaConfig>("area.json");
