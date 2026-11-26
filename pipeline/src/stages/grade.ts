/**
 * grade — along-street grade per block from the 2024 1 m DTM.
 *
 * Input:  data/intermediate/blocks.geojson — FeatureCollection of EPSG:26985
 *         LineStrings with properties BlockID, RouteID, FromMeasure, ToMeasure.
 *         data/raw/dtm/index.json + tiles and data/raw/structures.json (fetch:dtm).
 * Output: data/intermediate/grades.json — { [BlockID]: BlockGrade }.
 *
 * Stats are in the block's digitized direction (A→B, + = downhill). Directed
 * per-segment values come from directGrade() in lib/grade.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FeatureCollection, Geometry } from "geojson";
import {
  computeGrade,
  densify,
  sampleElevation,
  structureFlag,
  structureOverlap,
  type GradeStats,
  type StructureHit,
  type StructureInterval,
} from "../lib/grade.js";
import { loadPipelineConfig } from "../lib/pipelineConfig.js";
import { INTERMEDIATE_DIR } from "../lib/paths.js";
import { loadDtmRasters, rasterBounds } from "../lib/raster.js";
import { DTM_INDEX, STRUCTURES_FILE } from "./fetchDtm.js";

export const BLOCKS_FILE = path.join(INTERMEDIATE_DIR, "blocks.geojson");
export const GRADES_FILE = path.join(INTERMEDIATE_DIR, "grades.json");

export type GradeFlag = "insufficient_elevation" | "outside_dtm" | "bridge" | "tunnel" | "bad_geometry";

export interface BlockGrade extends Omit<GradeStats, "grade_flag"> {
  grade_flag: GradeFlag | null;
  grade_source: "dtm";
  structures: StructureHit[];
}

interface BlockProps {
  BlockID: string;
  RouteID: string;
  FromMeasure: number;
  ToMeasure: number;
}

/** 2D vertex list for a LineString; MultiLineString parts are chained in order. */
function lineCoords(g: Geometry | null): number[][] | null {
  if (g?.type === "LineString") return g.coordinates;
  if (g?.type === "MultiLineString") return g.coordinates.flat();
  return null;
}

function emptyStats(length_m = 0): GradeStats {
  return {
    length_m,
    n_samples: 0,
    elev_coverage: 0,
    max_gap_m: length_m,
    elev_start_m: null,
    elev_end_m: null,
    grade_mean: null,
    grade_first20m: null,
    grade_last20m: null,
    grade_max_abs: null,
    grade_std: null,
    grade_flag: "insufficient_elevation",
  };
}

const NULL_GRADES = { grade_mean: null, grade_first20m: null, grade_last20m: null, grade_max_abs: null, grade_std: null } as const;

export async function run(): Promise<void> {
  const cfg = loadPipelineConfig();
  for (const [f, hint] of [
    [BLOCKS_FILE, "produced by the blocks/PCI stage"],
    [DTM_INDEX, "run `npm run fetch:dtm -w pipeline`"],
    [STRUCTURES_FILE, "run `npm run fetch:dtm -w pipeline`"],
  ] as const) {
    if (!existsSync(f)) throw new Error(`[grade] missing ${f} (${hint})`);
  }

  const blocks = JSON.parse(readFileSync(BLOCKS_FILE, "utf8")) as FeatureCollection<Geometry | null, BlockProps>;
  const structures = JSON.parse(readFileSync(STRUCTURES_FILE, "utf8")) as StructureInterval[];
  const { index, rasters } = await loadDtmRasters(DTM_INDEX);
  if (index.crs !== cfg.crs.work) throw new Error(`[grade] DTM tiles are ${index.crs}, expected ${cfg.crs.work}`);
  const bounds = rasters.map(rasterBounds);
  const inTiles = (x: number, y: number) => bounds.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y > y0 && y <= y1);

  const out: Record<string, BlockGrade> = {};
  for (const f of blocks.features) {
    const p = f.properties;
    if (out[p.BlockID]) console.warn(`[grade] duplicate BlockID ${p.BlockID}; keeping the last feature`);
    const coords = lineCoords(f.geometry);
    const hits = structureOverlap(p, structures, cfg.grade.structureMinOverlapM);
    const sFlag = structureFlag(hits);

    if (!coords || coords.length < 2) {
      out[p.BlockID] = { ...emptyStats(), grade_flag: "bad_geometry", grade_source: "dtm", structures: hits };
      continue;
    }
    // Guard against geometry in degrees or Web Mercator (CLAUDE.md: never grade in raw degrees).
    const [x, y] = coords[0]!;
    if (!(Math.abs(x!) > 1000 && Math.abs(x!) < 1e6 && Math.abs(y!) < 1e6)) {
      throw new Error(`[grade] block ${p.BlockID} coordinates (${x}, ${y}) are not EPSG:26985 meters`);
    }

    const pts = densify(coords, cfg.grade.sampleSpacingM);
    const z = sampleElevation(pts, rasters, cfg.dtm.nodataBelowM);
    const stats = computeGrade(
      pts.map((q) => q.d),
      z,
      cfg.grade,
    );

    let flag: GradeFlag | null = stats.grade_flag;
    if (flag && pts.some((q) => !inTiles(q.x, q.y))) flag = "outside_dtm"; // fix by widening the tile bbox, not a data gap
    // Precedence: tunnel (DTM is the ground above, so grades are meaningless) > bridge (keep values, flag) > elevation issues.
    if (sFlag === "tunnel") {
      out[p.BlockID] = { ...stats, ...NULL_GRADES, grade_flag: "tunnel", grade_source: "dtm", structures: hits };
      continue;
    }
    if (sFlag === "bridge") flag = "bridge";
    out[p.BlockID] = { ...stats, grade_flag: flag, grade_source: "dtm", structures: hits };
  }

  mkdirSync(INTERMEDIATE_DIR, { recursive: true });
  writeFileSync(GRADES_FILE, JSON.stringify(out, null, 1));
  printSummary(out);
  console.log(`[grade] wrote ${Object.keys(out).length} blocks → ${path.relative(process.cwd(), GRADES_FILE)}`);
}

function printSummary(grades: Record<string, BlockGrade>): void {
  const all = Object.values(grades);
  const graded = all.filter((g) => g.grade_mean !== null);
  const buckets: [string, (a: number) => boolean][] = [
    ["<1%", (a) => a < 1],
    ["1–4%", (a) => a >= 1 && a < 4],
    ["4–6%", (a) => a >= 4 && a < 6],
    ["6–8%", (a) => a >= 6 && a < 8],
    [">8%", (a) => a >= 8],
  ];
  console.log(`[grade] blocks: ${all.length}, with grade: ${graded.length}`);
  console.log("[grade] |grade_mean| buckets:");
  for (const [label, test] of buckets) {
    const n = graded.filter((g) => test(Math.abs(g.grade_mean!))).length;
    console.log(`  ${label.padEnd(5)} ${String(n).padStart(5)}  (${((100 * n) / Math.max(1, graded.length)).toFixed(1)}%)`);
  }
  const flags = new Map<string, number>();
  for (const g of all) if (g.grade_flag) flags.set(g.grade_flag, (flags.get(g.grade_flag) ?? 0) + 1);
  console.log(`[grade] flagged: ${flags.size ? [...flags].map(([k, v]) => `${k} ${v}`).join(", ") : "none"}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await run();
}
