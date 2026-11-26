/**
 * Pure street-grade functions: densify a block centerline, sample DTM rasters,
 * and compute along-street grade statistics. Method: docs/research/steepness.md §4.
 *
 * Direction convention (CLAUDE.md): stats are computed in the block's digitized
 * direction A→B, and grade is POSITIVE when the street goes DOWNHILL A→B.
 * Directed values for B→A come from directGrade().
 *
 * All coordinates are planar meters (EPSG:26985).
 */
import type { PipelineConfig } from "./pipelineConfig.js";
import type { Raster } from "./raster.js";
import type { Direction } from "../types.js";

export type GradeConfig = PipelineConfig["grade"];

export interface SamplePoint {
  x: number;
  y: number;
  /** Cumulative distance along the line from its first vertex (m). */
  d: number;
}

/** Float tolerance for distance comparisons (m). Not a tuning parameter. */
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Geometry

/**
 * Points every `spacingM` along a planar LineString, starting at the first vertex
 * and always ending exactly at the last vertex (the final step may be shorter).
 * A zero-length line yields a single point.
 */
export function densify(coords: ReadonlyArray<ReadonlyArray<number>>, spacingM: number): SamplePoint[] {
  if (!(spacingM > 0)) throw new Error(`densify: spacingM must be > 0, got ${spacingM}`);
  if (coords.length === 0) return [];
  const xy = coords.map((c) => [c[0]!, c[1]!] as const);
  const cum: number[] = [0];
  for (let i = 1; i < xy.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(xy[i]![0] - xy[i - 1]![0], xy[i]![1] - xy[i - 1]![1]));
  }
  const total = cum[cum.length - 1]!;
  const first = xy[0]!;
  if (total <= EPS) return [{ x: first[0], y: first[1], d: 0 }];

  const out: SamplePoint[] = [];
  let seg = 1;
  const n = Math.floor(total / spacingM + EPS);
  for (let k = 0; k <= n; k++) {
    const d = k * spacingM;
    if (total - d <= EPS) break; // the end vertex is appended below
    while (seg < xy.length - 1 && cum[seg]! < d) seg++;
    const a = xy[seg - 1]!;
    const b = xy[seg]!;
    const segLen = cum[seg]! - cum[seg - 1]!;
    const t = segLen > 0 ? (d - cum[seg - 1]!) / segLen : 0;
    out.push({ x: a[0] + t * (b[0] - a[0]), y: a[1] + t * (b[1] - a[1]), d });
  }
  const last = xy[xy.length - 1]!;
  out.push({ x: last[0], y: last[1], d: total });
  return out;
}

// ---------------------------------------------------------------------------
// Raster sampling

export function isNodata(v: number, nodata: number, nodataBelowM: number): boolean {
  return Number.isNaN(v) || v === nodata || v < nodataBelowM;
}

/** Value of the pixel containing (x, y) in the first raster that covers it, or undefined. */
function pixelAt(rasters: readonly Raster[], x: number, y: number): { v: number; r: Raster } | undefined {
  for (const r of rasters) {
    const col = Math.floor((x - r.originX) / r.pixelSizeX);
    const row = Math.floor((r.originY - y) / r.pixelSizeY);
    if (col >= 0 && col < r.width && row >= 0 && row < r.height) return { v: r.data[row * r.width + col]!, r };
  }
  return undefined;
}

/**
 * Bilinear elevation at each point. Pixel values sit at pixel CENTERS, so a
 * point exactly on a pixel center returns that pixel's value.
 *
 * Multiple rasters are treated as one mosaic: the four neighbouring pixel
 * centers are looked up independently, so points between the last pixel center
 * of one tile and the first of the next still interpolate across the seam.
 * Rasters must share an aligned grid (same pixel size, origins on the grid),
 * which the DTM export guarantees.
 *
 * Returns null for a point if any of its four neighbours is nodata (== the
 * raster's nodata value, NaN, or < nodataBelowM) or outside every raster, so
 * gaps are never interpolated across (CLAUDE.md rule 8).
 */
export function sampleElevation(
  points: ReadonlyArray<{ x: number; y: number }>,
  rasters: readonly Raster[],
  nodataBelowM: number,
): (number | null)[] {
  return points.map(({ x, y }) => {
    const home = pixelAt(rasters, x, y)?.r;
    if (!home) return null;
    const px = home.pixelSizeX;
    const py = home.pixelSizeY;
    // Continuous pixel-center coordinates in the home grid.
    const fx = (x - home.originX) / px - 0.5;
    const fy = (home.originY - y) / py - 0.5;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    const tx = fx - c0;
    const ty = fy - r0;
    let z = 0;
    for (const [dc, dr] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const w = (dc ? tx : 1 - tx) * (dr ? ty : 1 - ty);
      // Zero-weight neighbours are not needed (e.g. a point exactly on the last pixel center).
      if (w === 0) continue;
      const cx = home.originX + (c0 + dc + 0.5) * px;
      const cy = home.originY - (r0 + dr + 0.5) * py;
      const hit = pixelAt(rasters, cx, cy);
      if (!hit || isNodata(hit.v, hit.r.nodata, nodataBelowM)) return null;
      z += w * hit.v;
    }
    return z;
  });
}

// ---------------------------------------------------------------------------
// Statistics

/**
 * Centered running median over `window` samples (odd), ignoring nulls.
 * Null inputs stay null: the filter never fills a gap.
 *
 * Neighbours are taken in symmetric pairs (i−j, i+j) and a pair is used only if
 * both sides exist and are valid. So the window shrinks symmetrically at the
 * line ends and next to gaps instead of becoming one-sided, which would pull
 * endpoint elevations inward and bias grades (the pitfall in
 * docs/research/steepness.md §4 step 7). A linear profile passes through unchanged.
 */
export function medianFilter(values: ReadonlyArray<number | null>, window: number): (number | null)[] {
  const half = Math.floor(Math.max(1, window) / 2);
  return values.map((v, i) => {
    if (v === null) return null;
    const w: number[] = [v];
    for (let j = 1; j <= half; j++) {
      const a = values[i - j];
      const b = values[i + j];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      w.push(a, b);
    }
    w.sort((a, b) => a - b);
    const m = w.length >> 1;
    return w.length % 2 ? w[m]! : (w[m - 1]! + w[m]!) / 2;
  });
}

/** Ordinary least-squares slope of y on x; null with < 2 points or zero x-variance. */
export function olsSlope(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    sxy += dx * (ys[i]! - my);
    sxx += dx * dx;
  }
  return sxx > EPS ? sxy / sxx : null;
}

export interface GradeStats {
  length_m: number;
  n_samples: number;
  /** Fraction of samples with valid elevation. */
  elev_coverage: number;
  /** Longest stretch of line (m) with no valid sample; 0 when every sample is valid. */
  max_gap_m: number;
  /** First / last valid raw elevation (m NAVD88), null if none. */
  elev_start_m: number | null;
  elev_end_m: number | null;
  /** Percent, + = downhill A→B. −100 × OLS slope over all valid raw samples. */
  grade_mean: number | null;
  /** OLS grade over the first / last endWindowM metres, + = downhill A→B. */
  grade_first20m: number | null;
  grade_last20m: number | null;
  /** Steepest |grade| of any endWindowM-long window. */
  grade_max_abs: number | null;
  /** Std (population) of localGradeWindowM central-difference grades after the median filter. */
  grade_std: number | null;
  grade_flag: "insufficient_elevation" | null;
}

/** −100 × OLS slope over the valid samples with lo ≤ d ≤ hi. */
function windowGrade(d: readonly number[], z: ReadonlyArray<number | null>, lo: number, hi: number): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < d.length; i++) {
    const zi = z[i];
    if (zi !== null && zi !== undefined && d[i]! >= lo - EPS && d[i]! <= hi + EPS) {
      xs.push(d[i]!);
      ys.push(zi);
    }
  }
  const s = olsSlope(xs, ys);
  return s === null ? null : -100 * s;
}

/**
 * Grade statistics for one block in its digitized (A→B) direction.
 * `distances` ascending from 0 (as from densify); `elevations` null = nodata.
 */
export function computeGrade(distances: readonly number[], elevations: ReadonlyArray<number | null>, cfg: GradeConfig): GradeStats {
  if (distances.length !== elevations.length) throw new Error("computeGrade: distances/elevations length mismatch");
  const n = distances.length;
  const length_m = n ? distances[n - 1]! : 0;
  const validIdx = elevations.flatMap((z, i) => (z === null ? [] : [i]));
  const elev_coverage = n ? validIdx.length / n : 0;

  // Longest stretch bounded by valid samples (or the line ends) that contains a nodata sample.
  let max_gap_m = 0;
  for (let i = 0; i < n; ) {
    if (elevations[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && elevations[j] === null) j++;
    const from = i > 0 ? distances[i - 1]! : 0;
    const to = j < n ? distances[j]! : length_m;
    max_gap_m = Math.max(max_gap_m, to - from);
    i = j;
  }

  const first = validIdx[0];
  const last = validIdx[validIdx.length - 1];
  const base = {
    length_m,
    n_samples: n,
    elev_coverage,
    max_gap_m,
    elev_start_m: first === undefined ? null : elevations[first]!,
    elev_end_m: last === undefined ? null : elevations[last]!,
  };
  const empty = { grade_mean: null, grade_first20m: null, grade_last20m: null, grade_max_abs: null, grade_std: null };

  const grade_mean = windowGrade(distances, elevations, 0, length_m);
  if (elev_coverage < cfg.minCoverage || max_gap_m > cfg.maxGapM || grade_mean === null) {
    return { ...base, ...empty, grade_flag: "insufficient_elevation" };
  }

  const W = cfg.endWindowM;
  const grade_first20m = windowGrade(distances, elevations, 0, Math.min(W, length_m));
  const grade_last20m = windowGrade(distances, elevations, Math.max(0, length_m - W), length_m);

  let grade_max_abs: number | null = null;
  if (length_m <= W + EPS) {
    grade_max_abs = Math.abs(grade_mean);
  } else {
    for (let i = 0; i < n && distances[i]! + W <= length_m + EPS; i++) {
      const g = windowGrade(distances, elevations, distances[i]!, distances[i]! + W);
      if (g !== null && (grade_max_abs === null || Math.abs(g) > grade_max_abs)) grade_max_abs = Math.abs(g);
    }
    // Window ending exactly at B (the last step from densify can be short).
    const g = windowGrade(distances, elevations, length_m - W, length_m);
    if (g !== null && (grade_max_abs === null || Math.abs(g) > grade_max_abs)) grade_max_abs = Math.abs(g);
  }

  // Local grades: central difference over ±localGradeWindowM/2 on the median-filtered profile.
  const zf = medianFilter(elevations, cfg.medianWindow);
  const k = Math.max(1, Math.round(cfg.localGradeWindowM / 2 / cfg.sampleSpacingM));
  const local: number[] = [];
  for (let i = k; i + k < n; i++) {
    const a = zf[i - k];
    const b = zf[i + k];
    if (a === null || b === null || a === undefined || b === undefined) continue;
    const dd = distances[i + k]! - distances[i - k]!;
    if (dd > EPS) local.push((-100 * (b - a)) / dd);
  }
  let grade_std = 0;
  if (local.length >= 2) {
    const m = local.reduce((s, v) => s + v, 0) / local.length;
    grade_std = Math.sqrt(local.reduce((s, v) => s + (v - m) ** 2, 0) / local.length);
  }

  return { ...base, grade_mean, grade_first20m, grade_last20m, grade_max_abs, grade_std, grade_flag: null };
}

export interface DirectedGrade {
  grade_mean: number;
  grade_std: number;
  grade_last20m: number;
}

/**
 * Directed grade fields for ScoredSegment (+ = downhill in direction of travel).
 * BA reverses the block: mean flips sign and its last 20 m is AB's first 20 m, reversed.
 * Returns null when the A→B stats have no grade (e.g. insufficient elevation).
 */
export function directGrade(ab: GradeStats, direction: Direction): DirectedGrade | null {
  if (ab.grade_mean === null || ab.grade_std === null || ab.grade_first20m === null || ab.grade_last20m === null) return null;
  return direction === "AB"
    ? { grade_mean: ab.grade_mean, grade_std: ab.grade_std, grade_last20m: ab.grade_last20m }
    : { grade_mean: -ab.grade_mean, grade_std: ab.grade_std, grade_last20m: -ab.grade_first20m };
}

// ---------------------------------------------------------------------------
// Bridges and tunnels

export type StructureType = "bridge" | "tunnel";

export interface StructureInterval {
  routeId: string;
  from: number;
  to: number;
  type: StructureType;
  name: string | null;
  /** Which layer it came from, e.g. "lrs_bridge" / "lrs_structure". */
  source: string;
}

export interface BlockRef {
  RouteID: string;
  FromMeasure: number;
  ToMeasure: number;
}

export interface StructureHit {
  type: StructureType;
  name: string | null;
  source: string;
  overlap_m: number;
}

/**
 * Bridge/tunnel intervals on the same route whose measure range overlaps the
 * block's by more than minOverlapM (so intervals that merely touch, or spill a
 * metre into the neighbouring block, don't count).
 */
export function structureOverlap(block: BlockRef, structures: readonly StructureInterval[], minOverlapM: number): StructureHit[] {
  const lo = Math.min(block.FromMeasure, block.ToMeasure);
  const hi = Math.max(block.FromMeasure, block.ToMeasure);
  const hits: StructureHit[] = [];
  for (const s of structures) {
    if (s.routeId !== block.RouteID) continue;
    const overlap = Math.min(hi, Math.max(s.from, s.to)) - Math.max(lo, Math.min(s.from, s.to));
    if (overlap > minOverlapM) hits.push({ type: s.type, name: s.name, source: s.source, overlap_m: overlap });
  }
  return hits;
}

/** Flag for a block given its structure hits: tunnel wins over bridge. */
export function structureFlag(hits: readonly StructureHit[]): StructureType | null {
  if (hits.some((h) => h.type === "tunnel")) return "tunnel";
  if (hits.some((h) => h.type === "bridge")) return "bridge";
  return null;
}
