import { describe, expect, it } from "vitest";
import { loadScoringConfig, type ScoringConfig } from "../src/lib/config.js";
import {
  effectiveAadt,
  gradeScore,
  runQualityScore,
  scoreConfidence,
  staticScore,
  surfaceScore,
  trafficScore,
} from "../src/scoring/components.js";
import { legalDirections, scoreDirectedSegment, type BlockGradeInput, type BlockInput } from "../src/scoring/scoreSegment.js";

const cfg: ScoringConfig = loadScoringConfig();

describe("trafficScore", () => {
  const t = cfg.traffic;
  it("is 1 at or below the full-score AADT and 0 at or above the zero-score AADT", () => {
    expect(trafficScore({ aadt: t.aadtFullScore / 2 }, t)).toBe(1);
    expect(trafficScore({ aadt: t.aadtFullScore }, t)).toBeCloseTo(1);
    expect(trafficScore({ aadt: t.aadtZeroScore }, t)).toBeCloseTo(0);
    expect(trafficScore({ aadt: t.aadtZeroScore * 3 }, t)).toBe(0);
  });

  it("decays logarithmically (geometric midpoint scores 0.5)", () => {
    const mid = Math.sqrt(t.aadtFullScore * t.aadtZeroScore);
    expect(trafficScore({ aadt: mid }, t)).toBeCloseTo(0.5, 6);
  });

  it("returns null without AADT and applies bonuses", () => {
    expect(trafficScore({ aadt: null }, t)).toBeNull();
    const mid = Math.sqrt(t.aadtFullScore * t.aadtZeroScore);
    expect(trafficScore({ aadt: mid, hasBikeLane: true }, t)).toBeCloseTo(0.5 + t.bikeLaneBonus, 6);
  });
});

describe("effectiveAadt", () => {
  it("prefers measured, then imputes by functional class, else null", () => {
    expect(effectiveAadt(4200, "local", cfg.traffic)).toEqual({ aadt: 4200, imputed: false });
    expect(effectiveAadt(null, "local", cfg.traffic)).toEqual({ aadt: cfg.traffic.imputedAadtByFunctionalClass.local, imputed: true });
    expect(effectiveAadt(null, null, cfg.traffic)).toEqual({ aadt: null, imputed: false });
    expect(effectiveAadt(null, "unknown_class", cfg.traffic)).toEqual({ aadt: null, imputed: false });
  });
});

describe("surfaceScore", () => {
  const s = cfg.surface;
  it("rescales PCI between the configured bounds and applies the material factor", () => {
    expect(surfaceScore({ pci: s.condition.pciFullScore, surface: "asphalt" }, s)).toBeCloseTo(s.materialFactor.asphalt!);
    expect(surfaceScore({ pci: s.condition.pciZeroScore, surface: "asphalt" }, s)).toBe(0);
    expect(surfaceScore({ pci: 100, surface: "concrete" }, s)).toBeCloseTo(s.materialFactor.concrete!);
  });
  it("is null (drops out) when PCI is missing", () => {
    expect(surfaceScore({ pci: null, surface: null }, s)).toBeNull();
  });
});

describe("gradeScore", () => {
  const g = cfg.grade;
  it("follows the curve, with penalties for roughness and a steep finish", () => {
    expect(gradeScore({ gradeMeanPct: 2.5, gradeStdPct: 0, gradeLast20mPct: 2 }, g)).toBeCloseTo(1);
    expect(gradeScore({ gradeMeanPct: 2.5, gradeStdPct: 1, gradeLast20mPct: 2 }, g)).toBeCloseTo(1 - g.stdPenaltyPerPct);
    expect(gradeScore({ gradeMeanPct: 2.5, gradeStdPct: 0, gradeLast20mPct: g.steepLast20mThresholdPct + 1 }, g)).toBeCloseTo(
      1 - g.steepLast20mPenalty,
    );
    expect(gradeScore({ gradeMeanPct: null, gradeStdPct: null, gradeLast20mPct: null }, g)).toBeNull();
  });
});

describe("runQualityScore", () => {
  it("uses only the sub-factors present", () => {
    const r = cfg.runQuality;
    expect(runQualityScore({ lengthM: r.lengthCapM / 2 }, r)).toBeCloseTo(0.5);
    expect(runQualityScore({ lengthM: r.lengthCapM * 2 }, r)).toBe(1);
    expect(runQualityScore({ lengthM: null }, r)).toBeNull();
  });
});

describe("staticScore", () => {
  it("renormalizes weights over the components present", () => {
    const w = { surface: 0.4, grade: 0.2, traffic: 0.2, runQuality: 0.2 };
    expect(staticScore({ surface: 1, grade: 0, traffic: 1, runQuality: 0 }, w)).toBeCloseTo(0.6);
    // Surface missing: average of the other three, equally weighted here.
    expect(staticScore({ surface: null, grade: 1, traffic: 0.5, runQuality: 0 }, w)).toBeCloseTo(0.5);
    expect(staticScore({ surface: null, grade: null, traffic: null, runQuality: null }, w)).toBeNull();
  });
});

describe("scoreConfidence", () => {
  it("is the share of weight backed by data", () => {
    const w = { surface: 0.4, grade: 0.2, traffic: 0.2, runQuality: 0.2 };
    expect(scoreConfidence({ surface: 0.5, grade: 0.5, traffic: 0.5, runQuality: 0.5 }, w)).toBeCloseTo(1);
    expect(scoreConfidence({ surface: null, grade: 0.5, traffic: 0.5, runQuality: 0.5 }, w)).toBeCloseTo(0.6);
  });
});

describe("scoreDirectedSegment", () => {
  const block: BlockInput = {
    BlockID: "B1",
    length_m: 200,
    roadtype: 1,
    oneway: false,
    oneway_direction: null,
    pci: 90,
    pci_surface: "asphalt",
    aadt: null,
    functional_class: "local",
  };
  const grade = (mean: number, flag: string | null = null): BlockGradeInput =>
    ({
      grade_mean: mean,
      grade_std: 0.2,
      grade_first20m: mean,
      grade_last20m: mean,
      grade_flag: flag,
    }) as BlockGradeInput;

  it("emits both directions for two-way and one for one-way blocks", () => {
    expect(legalDirections({ oneway: false, oneway_direction: null })).toEqual({ directions: ["AB", "BA"], assumed: false });
    expect(legalDirections({ oneway: true, oneway_direction: "BA" })).toEqual({ directions: ["BA"], assumed: false });
    expect(legalDirections({ oneway: null, oneway_direction: null })).toEqual({ directions: ["AB", "BA"], assumed: true });
  });

  it("flips grade sign for BA and scores the downhill direction higher", () => {
    const ab = scoreDirectedSegment(block, grade(3), "AB", cfg);
    const ba = scoreDirectedSegment(block, grade(3), "BA", cfg);
    expect(ab.grade_mean).toBe(3);
    expect(ba.grade_mean).toBe(-3);
    expect(ab.scores.grade!).toBeGreaterThan(ba.scores.grade!);
    expect(ab.aadt_imputed).toBe(true);
    expect(ab.scores.static).not.toBeNull();
  });

  it("hard-filters steep downhills only in the downhill direction", () => {
    const steep = cfg.hardFilters.maxDownhillGradePct + 1;
    expect(scoreDirectedSegment(block, grade(steep), "AB", cfg).filter_reasons).toContain("downhill_over_max");
    expect(scoreDirectedSegment(block, grade(steep), "BA", cfg).filter_reasons).toEqual([]);
  });

  it("filters missing elevation, freeways, ramps and heavy traffic, with null scores", () => {
    expect(scoreDirectedSegment(block, null, "AB", cfg).filter_reasons).toEqual(["missing_elevation"]);
    expect(scoreDirectedSegment({ ...block, functional_class: "interstate" }, grade(2), "AB", cfg).filter_reasons[0]).toMatch(/^functional_class/);
    expect(scoreDirectedSegment({ ...block, roadtype: 3 }, grade(2), "AB", cfg).filter_reasons[0]).toMatch(/^roadtype/);
    const busy = scoreDirectedSegment({ ...block, aadt: cfg.hardFilters.maxAadt + 1 }, grade(2), "AB", cfg);
    expect(busy.filter_reasons).toEqual(["aadt_over_max"]);
    expect(busy.scores.static).toBeNull();
  });

  it("keeps bridge blocks but drops their unreliable grade from the score", () => {
    const s = scoreDirectedSegment(block, grade(2, "bridge"), "AB", cfg);
    expect(s.filter_reasons).toEqual([]);
    expect(s.grade_reliable).toBe(false);
    expect(s.scores.grade).toBeNull();
    expect(s.scores.static).not.toBeNull();
    expect(s.confidence).toBeLessThan(1);
  });

  it("drops surface when PCI is missing instead of scoring it 0", () => {
    const s = scoreDirectedSegment({ ...block, pci: null, pci_surface: null }, grade(2), "AB", cfg);
    expect(s.scores.surface).toBeNull();
    expect(s.scores.static).toBeGreaterThan(0);
  });
});
