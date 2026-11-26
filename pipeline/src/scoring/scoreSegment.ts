/**
 * Score one directed segment: hard filters first (CLAUDE.md rule 3), then the
 * component scores and the static score. Pure; no I/O.
 */
import type { ScoringConfig } from "../lib/config.js";
import { directGrade, type GradeStats } from "../lib/grade.js";
import type { Direction } from "../types.js";
import {
  effectiveAadt,
  gradeScore,
  runQualityScore,
  scoreConfidence,
  staticScore,
  surfaceScore,
  trafficScore,
  type ComponentScores,
} from "./components.js";

/** Block attributes the scorer needs (from data/intermediate/blocks.geojson). */
export interface BlockInput {
  BlockID: string;
  length_m: number;
  roadtype: number | null;
  oneway: boolean | null;
  oneway_direction: Direction | null;
  pci: number | null;
  pci_surface: string | null;
  aadt: number | null;
  functional_class: string | null;
}

/** Grade stats in digitized A→B order (data/intermediate/grades.json). */
export type BlockGradeInput = GradeStats & { grade_flag: string | null };

/** Grade flags whose values must not be scored (bridges read the valley below the deck). */
const UNRELIABLE_GRADE_FLAGS = new Set(["bridge"]);
/** Grade flags that mean elevation is missing → hard filter. */
const MISSING_ELEVATION_FLAGS = new Set(["insufficient_elevation", "outside_dtm", "tunnel", "bad_geometry"]);

export interface DirectedScore {
  segment_id: string; // BlockID + "_AB" / "_BA"
  block_id: string;
  direction: Direction;
  grade_mean: number | null;
  grade_std: number | null;
  grade_last20m: number | null;
  grade_reliable: boolean;
  aadt: number | null;
  aadt_imputed: boolean;
  direction_assumed: boolean; // true when one-way status is unknown and both directions were emitted
  filter_reasons: string[]; // non-empty → hard-filtered (scores are null)
  scores: ComponentScores & { static: number | null };
  /** Share of static weight backed by data (scoreConfidence); 0 when filtered. */
  confidence: number;
}

/** Legal directions of travel: one for one-way blocks, both for two-way or unknown. */
export function legalDirections(block: Pick<BlockInput, "oneway" | "oneway_direction">): { directions: Direction[]; assumed: boolean } {
  if (block.oneway === true && block.oneway_direction) return { directions: [block.oneway_direction], assumed: false };
  return { directions: ["AB", "BA"], assumed: block.oneway == null };
}

export function scoreDirectedSegment(
  block: BlockInput,
  grade: BlockGradeInput | null,
  direction: Direction,
  cfg: ScoringConfig,
  directionAssumed = false,
): DirectedScore {
  const hf = cfg.hardFilters;
  const reasons: string[] = [];

  if (block.functional_class && hf.excludedFunctionalClasses.includes(block.functional_class)) reasons.push(`functional_class:${block.functional_class}`);
  if (block.roadtype != null && hf.excludedRoadTypes.includes(block.roadtype)) reasons.push(`roadtype:${block.roadtype}`);
  if (block.pci_surface && hf.excludedSurfaces.includes(block.pci_surface)) reasons.push(`surface:${block.pci_surface}`);

  const flag = grade?.grade_flag ?? null;
  const dg = grade ? directGrade(grade, direction) : null;
  if (!dg || (flag && MISSING_ELEVATION_FLAGS.has(flag))) reasons.push(`missing_elevation${flag ? `:${flag}` : ""}`);
  const gradeReliable = !!dg && !(flag && (UNRELIABLE_GRADE_FLAGS.has(flag) || MISSING_ELEVATION_FLAGS.has(flag)));
  if (dg && gradeReliable && dg.grade_mean > hf.maxDownhillGradePct) reasons.push("downhill_over_max");

  const traffic = effectiveAadt(block.aadt, block.functional_class, cfg.traffic);
  if (traffic.aadt != null && traffic.aadt > hf.maxAadt) reasons.push(traffic.imputed ? "aadt_over_max:imputed" : "aadt_over_max");

  const base = {
    segment_id: `${block.BlockID}_${direction}`,
    block_id: block.BlockID,
    direction,
    grade_mean: dg?.grade_mean ?? null,
    grade_std: dg?.grade_std ?? null,
    grade_last20m: dg?.grade_last20m ?? null,
    grade_reliable: gradeReliable,
    aadt: traffic.aadt,
    aadt_imputed: traffic.imputed,
    direction_assumed: directionAssumed,
    filter_reasons: reasons,
  };
  if (reasons.length) return { ...base, scores: { surface: null, grade: null, traffic: null, runQuality: null, static: null }, confidence: 0 };

  const components: ComponentScores = {
    surface: surfaceScore({ pci: block.pci, surface: block.pci_surface }, cfg.surface),
    grade: gradeReliable && dg ? gradeScore({ gradeMeanPct: dg.grade_mean, gradeStdPct: dg.grade_std, gradeLast20mPct: dg.grade_last20m }, cfg.grade) : null,
    traffic: trafficScore({ aadt: traffic.aadt }, cfg.traffic),
    runQuality: runQualityScore({ lengthM: block.length_m }, cfg.runQuality),
  };
  return {
    ...base,
    scores: { ...components, static: staticScore(components, cfg.staticWeights) },
    confidence: scoreConfidence(components, cfg.staticWeights),
  };
}
