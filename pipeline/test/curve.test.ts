import { describe, expect, it } from "vitest";
import { evalCurve } from "../src/lib/curve.js";
import { loadScoringConfig } from "../src/lib/config.js";

describe("evalCurve", () => {
  const pts = [
    { pct: 0, score: 0 },
    { pct: 10, score: 1 },
  ];

  it("interpolates linearly", () => {
    expect(evalCurve(pts, 5)).toBeCloseTo(0.5);
  });

  it("clamps outside the range", () => {
    expect(evalCurve(pts, -5)).toBe(0);
    expect(evalCurve(pts, 50)).toBe(1);
  });

  it("matches the README grade table using config/scoring.json", () => {
    const { curve } = loadScoringConfig().grade;
    expect(evalCurve(curve, 0.5)).toBeCloseTo(0.6); // flat, pumpable
    expect(evalCurve(curve, 2.5)).toBeCloseTo(1.0); // sweet spot
    expect(evalCurve(curve, 5)).toBeCloseTo(0.6);
    expect(evalCurve(curve, 7)).toBeCloseTo(0.2);
    expect(evalCurve(curve, -3)).toBeCloseTo(0.2); // uphill taper
  });
});
