import { readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./paths.js";

export interface CurvePoint {
  pct: number;
  score: number;
}

/** Shape of config/scoring.json. Extend as scoring components are implemented. */
export interface ScoringConfig {
  hardFilters: {
    excludedFunctionalClasses: string[];
    maxDownhillGradePct: number;
    maxAadt: number;
    excludedSurfaces: string[];
  };
  staticWeights: { surface: number; grade: number; traffic: number; runQuality: number };
  grade: { curve: CurvePoint[] } & Record<string, unknown>;
  [section: string]: unknown;
}

export function loadScoringConfig(file = path.join(CONFIG_DIR, "scoring.json")): ScoringConfig {
  return JSON.parse(readFileSync(file, "utf8")) as ScoringConfig;
}
