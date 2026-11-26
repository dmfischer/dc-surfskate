/**
 * Pure scoring components (CLAUDE.md rule 5). Each takes normalized inputs plus
 * config and returns a 0–1 score, or null when its inputs are missing so the
 * component drops out of the weighted average (rule 4) instead of scoring 0.
 */
import type { ScoringConfig } from "../lib/config.js";
import { evalCurve } from "../lib/curve.js";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export interface SurfaceInput {
  pci: number | null;
  surface: string | null;
}

/**
 * condition (PCI rescaled between pciZeroScore and pciFullScore) × materialFactor.
 * Freshness (paving date) is not scored yet: no paving-date source is joined.
 */
export function surfaceScore(input: SurfaceInput, cfg: ScoringConfig["surface"]): number | null {
  if (input.pci == null) return null;
  const { pciZeroScore, pciFullScore } = cfg.condition;
  const condition = clamp01((input.pci - pciZeroScore) / (pciFullScore - pciZeroScore));
  const material = input.surface == null ? 1 : (cfg.materialFactor[input.surface] ?? cfg.materialFactor.other ?? 1);
  return clamp01(condition * material);
}

// ---------------------------------------------------------------------------
// Grade (directional: + = downhill in the direction of travel)
// ---------------------------------------------------------------------------

export interface GradeInput {
  gradeMeanPct: number | null;
  gradeStdPct: number | null;
  gradeLast20mPct: number | null;
}

export function gradeScore(input: GradeInput, cfg: ScoringConfig["grade"]): number | null {
  if (input.gradeMeanPct == null) return null;
  let s = evalCurve(cfg.curve, input.gradeMeanPct);
  if (input.gradeStdPct != null) s -= input.gradeStdPct * cfg.stdPenaltyPerPct;
  if (input.gradeLast20mPct != null && input.gradeLast20mPct > cfg.steepLast20mThresholdPct) s -= cfg.steepLast20mPenalty;
  return clamp01(s);
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

export interface AadtEstimate {
  aadt: number | null;
  imputed: boolean;
}

/** Measured AADT when present; otherwise the configured default for the functional class. */
export function effectiveAadt(
  measured: number | null,
  functionalClass: string | null,
  cfg: ScoringConfig["traffic"],
): AadtEstimate {
  if (measured != null) return { aadt: measured, imputed: false };
  const guess = functionalClass == null ? undefined : cfg.imputedAadtByFunctionalClass[functionalClass];
  return guess == null ? { aadt: null, imputed: false } : { aadt: guess, imputed: true };
}

export interface TrafficInput {
  aadt: number | null;
  hasBikeLane?: boolean;
  speedLimitMph?: number;
}

/** Log decay: 1 at ≤ aadtFullScore, 0 at ≥ aadtZeroScore, plus optional bonuses. */
export function trafficScore(input: TrafficInput, cfg: ScoringConfig["traffic"]): number | null {
  if (input.aadt == null) return null;
  const lo = Math.log(cfg.aadtFullScore);
  const hi = Math.log(cfg.aadtZeroScore);
  let s = 1 - (Math.log(Math.max(input.aadt, 1)) - lo) / (hi - lo);
  if (input.hasBikeLane) s += cfg.bikeLaneBonus;
  if (input.speedLimitMph != null && input.speedLimitMph <= 20) s += cfg.speedLimit20Bonus;
  return clamp01(s);
}

// ---------------------------------------------------------------------------
// Run quality
// ---------------------------------------------------------------------------

export interface RunQualityInput {
  lengthM: number | null;
  bottomControl?: "stop" | "signal" | "none";
  crashCount3yr?: number;
}

/** Weighted average of the available sub-factors (length, bottom control, crashes). */
export function runQualityScore(input: RunQualityInput, cfg: ScoringConfig["runQuality"]): number | null {
  const parts: [number, number][] = [];
  if (input.lengthM != null) parts.push([cfg.weights.length, clamp01(input.lengthM / cfg.lengthCapM)]);
  if (input.bottomControl != null) parts.push([cfg.weights.bottomControl, cfg.bottomControlScore[input.bottomControl] ?? 0]);
  if (input.crashCount3yr != null) parts.push([cfg.weights.crashes, clamp01(1 - input.crashCount3yr * cfg.crashPenaltyPerCrash3yr)]);
  return weightedAverage(parts);
}

// ---------------------------------------------------------------------------
// Combination
// ---------------------------------------------------------------------------

/** Σ w·s / Σ w over the parts present; null when none are. */
export function weightedAverage(parts: readonly (readonly [number, number])[]): number | null {
  const wsum = parts.reduce((a, [w]) => a + w, 0);
  return wsum > 0 ? parts.reduce((a, [w, s]) => a + w * s, 0) / wsum : null;
}

export interface ComponentScores {
  surface: number | null;
  grade: number | null;
  traffic: number | null;
  runQuality: number | null;
}

/**
 * Share of the static weight backed by data (0–1). A score built from fewer
 * components can still reach 1.0, so the map shows confidence alongside it.
 */
export function scoreConfidence(scores: ComponentScores, weights: ScoringConfig["staticWeights"]): number {
  const keys = Object.keys(weights) as (keyof ComponentScores)[];
  const total = keys.reduce((a, k) => a + weights[k], 0);
  return total > 0 ? keys.filter((k) => scores[k] != null).reduce((a, k) => a + weights[k], 0) / total : 0;
}

/** Static score: weighted average of the non-null components, weights renormalized. */
export function staticScore(scores: ComponentScores, weights: ScoringConfig["staticWeights"]): number | null {
  const parts = (Object.keys(weights) as (keyof ComponentScores)[])
    .filter((k) => scores[k] != null)
    .map((k) => [weights[k], scores[k]!] as const);
  return weightedAverage(parts);
}
