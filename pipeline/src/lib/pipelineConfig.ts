import { readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./paths.js";

export interface PipelineConfig {
  crs: { work: string; output: string };
  arcgis: { userAgent: string; pageSize: number; requestDelayMs: number };
  dtm: { exportTilePx: number; pixelSizeM: number; nodataValue: number; nodataBelowM: number };
  grade: {
    sampleSpacingM: number;
    endWindowM: number;
    localGradeWindowM: number;
    medianWindow: number;
    minCoverage: number;
    maxGapM: number;
  };
}

export interface AreaConfig {
  name: string;
  ward: number;
  bufferM: number;
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(CONFIG_DIR, name), "utf8")) as T;
}

export const loadPipelineConfig = (): PipelineConfig => readJson<PipelineConfig>("pipeline.json");
export const loadAreaConfig = (): AreaConfig => readJson<AreaConfig>("area.json");
