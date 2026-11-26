import { describe, expect, it } from "vitest";
import { bucketize } from "../src/stages/export.js";

describe("bucketize", () => {
  it("counts into half-open buckets and tracks nulls", () => {
    expect(bucketize([0, 39.9, 40, 85, 100, null], [0, 40, 70, 85, 100])).toEqual({
      "0–40": 2,
      "40–70": 1,
      "70–85": 0,
      "85–100": 2,
      null: 1,
    });
  });

  it("clamps values outside the edges into the end buckets", () => {
    const b = bucketize([-1, 120], [0, 1, 4, 6, 8, 100]);
    expect(b["0–1"]).toBe(1);
    expect(b["8–100"]).toBe(1);
  });
});
