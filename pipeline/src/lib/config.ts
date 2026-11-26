import { readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./paths.js";

export interface CurvePoint {
  pct: number;
  score: number;
}

/** Shape of config/scoring.json. Conditions (live weather) are typed when the API is built. */
export interface ScoringConfig {
  hardFilters: {
    excludedFunctionalClasses: string[];
    /** DDOT ROADTYPE codes, e.g. 3 = ramp. */
    excludedRoadTypes: number[];
    maxDownhillGradePct: number;
    maxAadt: number;
    excludedSurfaces: string[];
  };
  staticWeights: { surface: number; grade: number; traffic: number; runQuality: number };
  surface: {
    freshness: { fullScoreMonths: number; zeroScoreMonths: number };
    condition: { pciZeroScore: number; pciFullScore: number };
    materialFactor: Record<string, number>;
    potholePenaltyPerOpenRequest: number;
  };
  grade: {
    curve: CurvePoint[];
    stdPenaltyPerPct: number;
    steepLast20mThresholdPct: number;
    steepLast20mPenalty: number;
  };
  traffic: {
    aadtFullScore: number;
    aadtZeroScore: number;
    imputedAadtByFunctionalClass: Record<string, number>;
    bikeLaneBonus: number;
    speedLimit20Bonus: number;
  };
  runQuality: {
    lengthCapM: number;
    weights: { length: number; bottomControl: number; crashes: number };
    bottomControlScore: Record<string, number>;
    crashPenaltyPerCrash3yr: number;
  };
  [section: string]: unknown;
}

export function loadScoringConfig(file = path.join(CONFIG_DIR, "scoring.json")): ScoringConfig {
  return JSON.parse(readFileSync(file, "utf8")) as ScoringConfig;
}
