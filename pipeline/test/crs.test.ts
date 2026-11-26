import { describe, expect, it } from "vitest";
import { md26985ToLonLat } from "../src/lib/crs.js";

describe("md26985ToLonLat", () => {
  it("maps the projection origin to its defined lon/lat", () => {
    const [lon, lat] = md26985ToLonLat([400000, 0], 7);
    expect(lon).toBeCloseTo(-77, 6);
    expect(lat).toBeCloseTo(37.6666667, 5);
  });

  it("lands a Ward 1 block vertex in Columbia Heights", () => {
    // 16th St NW at Pine St, from RoadwayBlocks (EPSG:26985)
    const [lon, lat] = md26985ToLonLat([396839, 140301.87]);
    expect(lon).toBeGreaterThan(-77.05);
    expect(lon).toBeLessThan(-77.02);
    expect(lat).toBeGreaterThan(38.92);
    expect(lat).toBeLessThan(38.94);
  });
});
