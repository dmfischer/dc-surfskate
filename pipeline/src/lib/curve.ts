import type { CurvePoint } from "./config.js";

/**
 * Piecewise-linear lookup over points sorted by `pct`. Clamps outside the range.
 * Two consecutive points with the same `pct` form a step; the value exactly at
 * the step belongs to the lower segment.
 */
export function evalCurve(points: readonly CurvePoint[], x: number): number {
  if (points.length === 0) throw new Error("evalCurve: empty curve");
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (x <= first.pct) return first.score;
  if (x >= last.pct) return last.score;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (x <= b.pct) {
      const span = b.pct - a.pct;
      if (span === 0) return b.score;
      return a.score + ((x - a.pct) / span) * (b.score - a.score);
    }
  }
  return last.score;
}
