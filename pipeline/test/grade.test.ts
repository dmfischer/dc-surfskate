import { describe, expect, it } from "vitest";
import {
  computeGrade,
  densify,
  directGrade,
  medianFilter,
  olsSlope,
  sampleElevation,
  structureFlag,
  structureOverlap,
  type GradeConfig,
  type StructureInterval,
} from "../src/lib/grade.js";
import type { Raster } from "../src/lib/raster.js";
import { loadPipelineConfig } from "../src/lib/pipelineConfig.js";

const pcfg = loadPipelineConfig();
const cfg: GradeConfig = pcfg.grade;
const NODATA = pcfg.dtm.nodataValue;
const BELOW = pcfg.dtm.nodataBelowM;

/** Synthetic 1 m raster whose pixel CENTER values are f(x, y). */
function makeRaster(originX: number, originY: number, width: number, height: number, f: (x: number, y: number) => number, px = 1): Raster {
  const data = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      data[row * width + col] = f(originX + (col + 0.5) * px, originY - (row + 0.5) * px);
    }
  }
  return { originX, originY, pixelSizeX: px, pixelSizeY: px, width, height, data, nodata: NODATA };
}

/** Run the full block pipeline (densify → sample → computeGrade) on a line. */
function gradeLine(coords: number[][], rasters: Raster[]) {
  const pts = densify(coords, cfg.sampleSpacingM);
  const z = sampleElevation(pts, rasters, BELOW);
  return computeGrade(
    pts.map((p) => p.d),
    z,
    cfg,
  );
}

// Origin in DC state-plane range so floating point behaves like real data.
const X0 = 396000;
const Y0 = 140300;
const SIZE = 300;

describe("densify", () => {
  it("spaces points evenly and includes both endpoints", () => {
    const pts = densify(
      [
        [0, 0],
        [12, 0],
      ],
      5,
    );
    expect(pts.map((p) => p.d)).toEqual([0, 5, 10, 12]);
    expect(pts[3]).toEqual({ x: 12, y: 0, d: 12 });
  });

  it("follows bends and does not duplicate an exact end", () => {
    const pts = densify(
      [
        [0, 0],
        [3, 0],
        [3, 7],
      ],
      5,
    );
    expect(pts.map((p) => p.d)).toEqual([0, 5, 10]);
    expect(pts[1]!.x).toBeCloseTo(3);
    expect(pts[1]!.y).toBeCloseTo(2);
    expect(pts[2]).toEqual({ x: 3, y: 7, d: 10 });
  });

  it("handles a line shorter than the spacing", () => {
    expect(
      densify(
        [
          [1, 1],
          [4, 5],
        ],
        5,
      ),
    ).toEqual([
      { x: 1, y: 1, d: 0 },
      { x: 4, y: 5, d: 5 },
    ]);
    const short = densify(
      [
        [0, 0],
        [2, 0],
      ],
      5,
    );
    expect(short.map((p) => p.d)).toEqual([0, 2]);
  });

  it("returns one point for a zero-length line", () => {
    expect(
      densify(
        [
          [7, 7],
          [7, 7],
        ],
        5,
      ),
    ).toEqual([{ x: 7, y: 7, d: 0 }]);
  });
});

describe("sampleElevation", () => {
  it("returns the pixel value exactly at a pixel center", () => {
    const data = Float32Array.from([10, 20, 30, 40, 50, 60]);
    const r: Raster = { originX: 100, originY: 200, pixelSizeX: 1, pixelSizeY: 1, width: 3, height: 2, data, nodata: NODATA };
    // Pixel (col 1, row 0) has center (101.5, 199.5); (col 2, row 1) → (102.5, 198.5).
    expect(sampleElevation([{ x: 101.5, y: 199.5 }], [r], BELOW)).toEqual([20]);
    expect(sampleElevation([{ x: 102.5, y: 198.5 }], [r], BELOW)).toEqual([60]);
    // Halfway between centers of cols 0 and 1, row 0.
    expect(sampleElevation([{ x: 101, y: 199.5 }], [r], BELOW)[0]).toBeCloseTo(15);
    // Center of the 2×2 block of cols 0–1, rows 0–1.
    expect(sampleElevation([{ x: 101, y: 199 }], [r], BELOW)[0]).toBeCloseTo((10 + 20 + 40 + 50) / 4);
  });

  it("reproduces a linear surface exactly (bilinear)", () => {
    const r = makeRaster(X0, Y0, 50, 50, (x, y) => 0.3 * (x - X0) - 0.1 * (Y0 - y) + 20);
    const pts = [
      { x: X0 + 10.2, y: Y0 - 33.7 },
      { x: X0 + 40.9, y: Y0 - 5.05 },
    ];
    const z = sampleElevation(pts, [r], BELOW);
    pts.forEach((p, i) => expect(z[i]).toBeCloseTo(0.3 * (p.x - X0) - 0.1 * (Y0 - p.y) + 20, 4));
  });

  it("returns null out of bounds and within half a pixel of a lone raster's edge", () => {
    const r = makeRaster(X0, Y0, 10, 10, () => 5);
    expect(sampleElevation([{ x: X0 - 1, y: Y0 - 5 }], [r], BELOW)).toEqual([null]);
    expect(sampleElevation([{ x: X0 + 0.2, y: Y0 - 5 }], [r], BELOW)).toEqual([null]);
    expect(sampleElevation([{ x: X0 + 0.5, y: Y0 - 5 }], [r], BELOW)).toEqual([5]);
  });

  it("treats the nodata value, NaN and values below nodataBelowM as missing", () => {
    for (const bad of [NODATA, NaN, BELOW - 1]) {
      const r = makeRaster(X0, Y0, 10, 10, () => 5);
      r.data[3 * 10 + 3] = bad;
      // Any point whose 4 neighbours include pixel (3,3) is null; one away is fine.
      expect(sampleElevation([{ x: X0 + 3.5, y: Y0 - 3.5 }], [r], BELOW)).toEqual([null]);
      expect(sampleElevation([{ x: X0 + 4.2, y: Y0 - 4.2 }], [r], BELOW)).toEqual([null]);
      expect(sampleElevation([{ x: X0 + 5.5, y: Y0 - 5.5 }], [r], BELOW)).toEqual([5]);
    }
  });

  it("interpolates across a tile seam using both rasters", () => {
    const f = (x: number, y: number) => 0.05 * (x - X0) + 0.02 * (Y0 - y) + 30;
    const west = makeRaster(X0, Y0, 20, 20, f);
    const east = makeRaster(X0 + 20, Y0, 20, 20, f);
    const south = makeRaster(X0, Y0 - 20, 40, 20, f);
    const rasters = [west, east, south];
    const pts = [
      { x: X0 + 19.8, y: Y0 - 7.3 }, // between last col of west and first col of east
      { x: X0 + 20.0, y: Y0 - 7.3 }, // exactly on the seam
      { x: X0 + 20.3, y: Y0 - 19.9 }, // four-tile corner region (west/east/south)
      { x: X0 + 5, y: Y0 - 20.1 },
    ];
    const z = sampleElevation(pts, rasters, BELOW);
    pts.forEach((p, i) => expect(z[i]).toBeCloseTo(f(p.x, p.y), 4));
    // With only the west tile the seam point is uncovered.
    expect(sampleElevation([pts[0]!], [west], BELOW)).toEqual([null]);
  });
});

describe("medianFilter", () => {
  it("removes a spike and ignores nulls without filling them", () => {
    expect(medianFilter([1, 2, 100, 4, 5], 3)).toEqual([1, 2, 4, 5, 5]);
    // Window shrinks symmetrically next to a gap (pair (null, 10) is skipped at index 2).
    expect(medianFilter([1, null, 3, 10, 5], 3)).toEqual([1, null, 3, 5, 5]);
    expect(medianFilter([null, null], 3)).toEqual([null, null]);
  });

  it("passes a linear profile through unchanged, including the ends", () => {
    const lin = [10, 9.5, 9, 8.5, 8, 7.5];
    expect(medianFilter(lin, 3)).toEqual(lin);
    expect(medianFilter(lin, 5)).toEqual(lin);
  });
});

describe("olsSlope", () => {
  it("fits a line", () => {
    expect(olsSlope([0, 1, 2, 3], [1, 3, 5, 7])).toBeCloseTo(2);
    expect(olsSlope([1], [1])).toBeNull();
    expect(olsSlope([2, 2], [1, 5])).toBeNull();
  });
});

describe("computeGrade", () => {
  const flat = makeRaster(X0, Y0, SIZE, SIZE, () => 42);
  // 5% plane falling toward +x (east): z = 50 − 0.05 (x − X0).
  const plane = makeRaster(X0, Y0, SIZE, SIZE, (x) => 50 - 0.05 * (x - X0));
  const W = [X0 + 20, Y0 - 150];
  const E = [X0 + 220, Y0 - 150];

  it("flat ground → 0", () => {
    const s = gradeLine([W, E], [flat]);
    expect(s.grade_flag).toBeNull();
    expect(s.grade_mean).toBeCloseTo(0, 6);
    expect(s.grade_first20m).toBeCloseTo(0, 6);
    expect(s.grade_last20m).toBeCloseTo(0, 6);
    expect(s.grade_max_abs).toBeCloseTo(0, 6);
    expect(s.grade_std).toBeCloseTo(0, 6);
    expect(s.elev_coverage).toBe(1);
    expect(s.max_gap_m).toBe(0);
    expect(s.length_m).toBeCloseTo(200);
  });

  it("5% plane: + when travelling downhill, − uphill, ~0 across the slope", () => {
    const down = gradeLine([W, E], [plane]);
    expect(down.grade_mean).toBeCloseTo(5, 4);
    expect(down.grade_first20m).toBeCloseTo(5, 4);
    expect(down.grade_last20m).toBeCloseTo(5, 4);
    expect(down.grade_max_abs).toBeCloseTo(5, 4);
    expect(down.grade_std).toBeCloseTo(0, 4);
    expect(down.elev_start_m! - down.elev_end_m!).toBeCloseTo(10, 4);

    expect(gradeLine([E, W], [plane]).grade_mean).toBeCloseTo(-5, 4);

    const across = gradeLine(
      [
        [X0 + 150, Y0 - 20],
        [X0 + 150, Y0 - 250],
      ],
      [plane],
    );
    expect(across.grade_mean).toBeCloseTo(0, 4);

    // Diagonal (45°) line: along-line grade = 5% · cos 45°.
    const diag = gradeLine(
      [
        [X0 + 20, Y0 - 20],
        [X0 + 220, Y0 - 220],
      ],
      [plane],
    );
    expect(diag.grade_mean).toBeCloseTo(5 * Math.SQRT1_2, 4);
  });

  it("reversed line flips every signed statistic", () => {
    // Non-uniform profile: steeper near A so first/last windows differ.
    const r = makeRaster(X0, Y0, SIZE, SIZE, (x) => 60 - 0.08 * (x - X0) + 0.00015 * (x - X0) ** 2);
    const ab = gradeLine([W, E], [r]);
    const ba = gradeLine([E, W], [r]);
    expect(ab.grade_first20m).not.toBeCloseTo(ab.grade_last20m!, 1);
    expect(ba.grade_mean).toBeCloseTo(-ab.grade_mean!, 6);
    expect(ba.grade_last20m).toBeCloseTo(-ab.grade_first20m!, 6);
    expect(ba.grade_first20m).toBeCloseTo(-ab.grade_last20m!, 6);
    expect(ba.grade_std).toBeCloseTo(ab.grade_std!, 6);
    expect(ba.grade_max_abs).toBeCloseTo(ab.grade_max_abs!, 6);

    // directGrade(BA) equals the stats computed on the reversed line.
    const dBA = directGrade(ab, "BA")!;
    expect(dBA.grade_mean).toBeCloseTo(ba.grade_mean!, 6);
    expect(dBA.grade_last20m).toBeCloseTo(ba.grade_last20m!, 6);
    expect(dBA.grade_std).toBeCloseTo(ba.grade_std!, 6);
    expect(directGrade(ab, "AB")).toEqual({ grade_mean: ab.grade_mean, grade_std: ab.grade_std, grade_last20m: ab.grade_last20m });
  });

  it("uses OLS over raw samples, not smoothed endpoints", () => {
    // A single spike at the last sample barely moves the OLS mean.
    const d = [0, 5, 10, 15, 20, 25, 30, 35, 40];
    const z = d.map((x) => 10 - 0.04 * x);
    z[z.length - 1] = z[z.length - 1]! - 1;
    const s = computeGrade(d, z, cfg);
    expect(s.grade_mean).toBeGreaterThan(4);
    expect(s.grade_mean).toBeLessThan(5.5);
  });

  it("nodata patch lowers coverage and is not interpolated across", () => {
    const r = makeRaster(X0, Y0, SIZE, SIZE, (x) => 50 - 0.05 * (x - X0));
    // 9 m wide nodata strip across the line around x = X0+100.
    for (let row = 0; row < SIZE; row++) for (let col = 96; col < 105; col++) r.data[row * SIZE + col] = NODATA;
    const pts = densify([W, E], cfg.sampleSpacingM);
    const z = sampleElevation(pts, [r], BELOW);
    const nulls = z.flatMap((v, i) => (v === null ? [pts[i]!.x - X0] : []));
    expect(nulls.length).toBeGreaterThan(0);
    expect(nulls.every((x) => x >= 95 && x <= 106)).toBe(true);

    const s = computeGrade(
      pts.map((p) => p.d),
      z,
      cfg,
    );
    expect(s.elev_coverage).toBeLessThan(1);
    expect(s.elev_coverage).toBeGreaterThan(cfg.minCoverage);
    expect(s.max_gap_m).toBeGreaterThan(cfg.sampleSpacingM);
    expect(s.max_gap_m).toBeLessThanOrEqual(cfg.maxGapM);
    expect(s.grade_flag).toBeNull();
    expect(s.grade_mean).toBeCloseTo(5, 4);
    // No local grade spans the gap, so a plane still has zero spread.
    expect(s.grade_std).toBeCloseTo(0, 4);

    // A gap longer than maxGapM flags the block even with high coverage.
    const z2 = z.slice();
    for (let i = 10; i < 10 + Math.ceil(cfg.maxGapM / cfg.sampleSpacingM) + 1; i++) z2[i] = null;
    const s2 = computeGrade(
      pts.map((p) => p.d),
      z2,
      cfg,
    );
    expect(s2.max_gap_m).toBeGreaterThan(cfg.maxGapM);
    expect(s2.grade_flag).toBe("insufficient_elevation");
  });

  it("coverage below threshold → insufficient_elevation with null grades", () => {
    const d = Array.from({ length: 11 }, (_, i) => i * 5);
    const z = d.map((x, i) => (i % 2 === 0 ? 10 - 0.03 * x : null)); // ~55% coverage, 10 m gaps
    const s = computeGrade(d, z, cfg);
    expect(s.elev_coverage).toBeLessThan(cfg.minCoverage);
    expect(s.grade_flag).toBe("insufficient_elevation");
    expect(s.grade_mean).toBeNull();
    expect(s.grade_std).toBeNull();
    expect(directGrade(s, "AB")).toBeNull();

    const none = computeGrade([0, 5], [null, null], cfg);
    expect(none.grade_flag).toBe("insufficient_elevation");
    expect(none.max_gap_m).toBe(5);
    expect(none.elev_start_m).toBeNull();
  });

  it("line shorter than the sample spacing still works", () => {
    const s = gradeLine(
      [
        [X0 + 100, Y0 - 100],
        [X0 + 103, Y0 - 100],
      ],
      [plane],
    );
    expect(s.n_samples).toBe(2);
    expect(s.length_m).toBeCloseTo(3);
    expect(s.grade_mean).toBeCloseTo(5, 4);
    expect(s.grade_first20m).toBeCloseTo(5, 4);
    expect(s.grade_last20m).toBeCloseTo(5, 4);
    expect(s.grade_max_abs).toBeCloseTo(5, 4);
    expect(s.grade_std).toBe(0);
  });

  it("grade_max_abs finds a short steep pitch the mean hides", () => {
    // 200 m mostly flat, with a 40 m 10% drop in the middle.
    const prof = (x: number) => (x < 80 ? 20 : x < 120 ? 20 - 0.1 * (x - 80) : 16);
    const r = makeRaster(X0, Y0, SIZE, SIZE, (x) => prof(x - X0 - 20));
    const s = gradeLine([W, E], [r]);
    expect(s.grade_mean).toBeLessThan(4);
    expect(s.grade_max_abs).toBeCloseTo(10, 1);
    expect(s.grade_std).toBeGreaterThan(1);
  });
});

describe("structureOverlap", () => {
  const structures: StructureInterval[] = [
    { routeId: "11020022", from: 419.802, to: 584.216, type: "bridge", name: "Duke Ellington Memorial Bridge", source: "lrs_bridge" },
    { routeId: "11020022", from: 421.281, to: 585.351, type: "bridge", name: null, source: "lrs_structure" },
    { routeId: "R2", from: 100, to: 50, type: "tunnel", name: null, source: "lrs_structure" },
  ];
  const min = cfg.structureMinOverlapM;

  it("matches overlapping intervals on the same route only", () => {
    const hits = structureOverlap({ RouteID: "11020022", FromMeasure: 355.9, ToMeasure: 619 }, structures, min);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.overlap_m).toBeCloseTo(584.216 - 419.802);
    expect(structureFlag(hits)).toBe("bridge");
    expect(structureOverlap({ RouteID: "OTHER", FromMeasure: 355.9, ToMeasure: 619 }, structures, min)).toEqual([]);
  });

  it("ignores intervals that only touch or spill under minOverlapM", () => {
    expect(structureOverlap({ RouteID: "11020022", FromMeasure: 300, ToMeasure: 419.802 }, structures, min)).toEqual([]);
    expect(structureOverlap({ RouteID: "11020022", FromMeasure: 585, ToMeasure: 700 }, structures, min)).toEqual([]);
  });

  it("handles reversed measures and prefers tunnel", () => {
    const hits = structureOverlap({ RouteID: "R2", FromMeasure: 90, ToMeasure: 40 }, structures, min);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.overlap_m).toBeCloseTo(40);
    expect(structureFlag([...hits, { type: "bridge", name: null, source: "x", overlap_m: 5 }])).toBe("tunnel");
    expect(structureFlag([])).toBeNull();
  });
});

describe("planTiles", () => {
  it("covers the snapped bbox with abutting tiles no larger than tilePx", async () => {
    const { planTiles } = await import("../src/stages/fetchDtm.js");
    const tiles = planTiles([395236.4, 138083.2, 399296.7, 141499.9], 1, 2000);
    expect(tiles).toHaveLength(6);
    expect(Math.min(...tiles.map((t) => t.bbox[0]))).toBe(395236);
    expect(Math.max(...tiles.map((t) => t.bbox[2]))).toBe(399297);
    expect(Math.max(...tiles.map((t) => t.bbox[3]))).toBe(141500);
    for (const t of tiles) {
      expect(t.width).toBeLessThanOrEqual(2000);
      expect(t.height).toBeLessThanOrEqual(2000);
      expect(t.bbox[2] - t.bbox[0]).toBe(t.width);
      expect(t.bbox[3] - t.bbox[1]).toBe(t.height);
    }
    const area = tiles.reduce((s, t) => s + t.width * t.height, 0);
    expect(area).toBe((399297 - 395236) * (141500 - 138083));
  });
});
