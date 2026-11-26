import { describe, expect, it } from "vitest";
import {
  coverageFraction,
  indexByRoute,
  latestDate,
  majorityByLength,
  minValue,
  normalize,
  overlapLength,
  overlapsOnRoute,
  pluck,
  weightedMean,
  type RouteEvent,
} from "../src/lib/intervals.js";

const block = { routeId: "R1", from: 100, to: 200 };
const ev = <T>(from: number, to: number, value: T, routeId = "R1"): RouteEvent<T> => ({ routeId, from, to, value });

describe("normalize / overlapLength", () => {
  it("orders reversed endpoints", () => {
    expect(normalize(200, 100)).toEqual({ from: 100, to: 200 });
    expect(normalize(100, 200)).toEqual({ from: 100, to: 200 });
  });

  it("is 0 for disjoint and touching intervals", () => {
    expect(overlapLength({ from: 0, to: 10 }, { from: 20, to: 30 })).toBe(0);
    expect(overlapLength({ from: 0, to: 10 }, { from: 10, to: 30 })).toBe(0);
  });

  it("measures partial and full overlap", () => {
    expect(overlapLength({ from: 0, to: 10 }, { from: 5, to: 30 })).toBe(5);
    expect(overlapLength({ from: 0, to: 10 }, { from: -5, to: 30 })).toBe(10);
  });
});

describe("overlapsOnRoute + aggregates", () => {
  it("no overlap: empty, null aggregates, zero coverage", () => {
    const o = overlapsOnRoute(block, [ev(0, 100, 50), ev(200, 300, 60)]);
    expect(o).toEqual([]);
    expect(weightedMean(o)).toBeNull();
    expect(minValue(o)).toBeNull();
    expect(majorityByLength(o)).toBeNull();
    expect(latestDate(o)).toBeNull();
    expect(coverageFraction(block, o)).toBe(0);
  });

  it("partial overlap clips the event to the block", () => {
    const o = overlapsOnRoute(block, [ev(150, 400, 80)]);
    expect(o).toHaveLength(1);
    expect(o[0]!.interval).toEqual({ from: 150, to: 200 });
    expect(o[0]!.length).toBe(50);
    expect(weightedMean(o)).toBe(80);
    expect(coverageFraction(block, o)).toBeCloseTo(0.5);
  });

  it("full overlap covers the whole block", () => {
    const o = overlapsOnRoute(block, [ev(0, 1000, 70)]);
    expect(o[0]!.length).toBe(100);
    expect(coverageFraction(block, o)).toBe(1);
  });

  it("multiple events: length-weighted mean, min, majority", () => {
    const o = overlapsOnRoute(block, [ev(50, 130, 90), ev(130, 200, 40)]);
    // 30 m at 90, 70 m at 40
    expect(weightedMean(o)).toBeCloseTo((30 * 90 + 70 * 40) / 100);
    expect(minValue(o)).toBe(40);
    expect(majorityByLength(o)).toBe(40);
    expect(coverageFraction(block, o)).toBe(1);
  });

  it("reversed measures on events and target behave like normal ones", () => {
    const o = overlapsOnRoute({ routeId: "R1", from: 200, to: 100 }, [ev(130, 50, 90), ev(250, 130, 40)]);
    expect(o.map((x) => x.length).sort((a, b) => a - b)).toEqual([30, 70]);
    expect(coverageFraction({ from: 200, to: 100 }, o)).toBe(1);
  });

  it("ignores events on a different RouteID (list and index)", () => {
    const events = [ev(0, 1000, 10, "R2"), ev(100, 150, 60)];
    expect(overlapsOnRoute(block, events).map((o) => o.value)).toEqual([60]);
    expect(overlapsOnRoute(block, indexByRoute(events)).map((o) => o.value)).toEqual([60]);
    expect(overlapsOnRoute({ ...block, routeId: "R3" }, indexByRoute(events))).toEqual([]);
  });

  it("coverage does not double-count overlapping events", () => {
    const o = overlapsOnRoute(block, [ev(100, 160, 1), ev(120, 160, 2), ev(180, 190, 3)]);
    expect(coverageFraction(block, o)).toBeCloseTo(0.7);
  });

  it("skips null values in numeric aggregates and majority", () => {
    const o = overlapsOnRoute<number | null>(block, [ev(100, 190, null), ev(190, 200, 30)]);
    expect(weightedMean(o)).toBe(30);
    expect(minValue(o)).toBe(30);
    expect(majorityByLength(o)).toBe(30);
  });

  it("majority sums length per value across events", () => {
    const o = overlapsOnRoute(block, [ev(100, 130, "AC"), ev(130, 170, "PCC"), ev(170, 200, "AC")]);
    expect(majorityByLength(o)).toBe("AC");
  });

  it("latestDate returns the latest epoch-ms value as ISO date", () => {
    const d1 = Date.UTC(2023, 4, 1);
    const d2 = Date.UTC(2025, 2, 15);
    const o = overlapsOnRoute<number | null>(block, [ev(100, 150, d1), ev(150, 200, d2), ev(120, 130, null)]);
    expect(latestDate(o)).toBe("2025-03-15");
  });

  it("pluck projects one field of an object value", () => {
    const o = overlapsOnRoute(block, [ev(100, 200, { pci: 55, surface: "AC" })]);
    expect(weightedMean(pluck(o, "pci"))).toBe(55);
    expect(majorityByLength(pluck(o, "surface"))).toBe("AC");
  });

  it("zero-length target has zero coverage", () => {
    expect(coverageFraction({ from: 5, to: 5 }, [])).toBe(0);
  });
});
