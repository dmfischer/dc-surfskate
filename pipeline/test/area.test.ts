import { describe, expect, it } from "vitest";
import { pointInRings, wardAt } from "../src/lib/area.js";
import { midpoint } from "../src/stages/export.js";

const square = (x0: number, y0: number, s: number) => [
  [x0, y0],
  [x0, y0 + s],
  [x0 + s, y0 + s],
  [x0 + s, y0],
  [x0, y0],
];

describe("pointInRings", () => {
  it("detects inside and outside", () => {
    expect(pointInRings([5, 5], [square(0, 0, 10)])).toBe(true);
    expect(pointInRings([15, 5], [square(0, 0, 10)])).toBe(false);
  });

  it("treats an inner ring as a hole", () => {
    const rings = [square(0, 0, 10), square(4, 4, 2)];
    expect(pointInRings([5, 5], rings)).toBe(false);
    expect(pointInRings([1, 1], rings)).toBe(true);
  });
});

describe("wardAt", () => {
  const wards = [
    { ward: 1, rings: [square(0, 0, 10)] },
    { ward: 4, rings: [square(0, 10, 10)] },
  ];
  it("returns the containing ward, or null outside all wards", () => {
    expect(wardAt([5, 5], wards)).toBe(1);
    expect(wardAt([5, 15], wards)).toBe(4);
    expect(wardAt([50, 50], wards)).toBeNull();
  });
});

describe("midpoint", () => {
  it("finds the point halfway along the line, not the middle vertex", () => {
    expect(midpoint([[0, 0], [10, 0], [10, 30]])).toEqual([10, 10]);
  });

  it("handles a two-point line", () => {
    expect(midpoint([[0, 0], [0, 8]])).toEqual([0, 4]);
  });
});
