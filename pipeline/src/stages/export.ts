/**
 * Export stage: combine blocks (PCI + directionality) with grades into one
 * WGS84 GeoJSON for the map, plus a summary of distributions.
 *
 * Input:  data/intermediate/blocks.geojson (EPSG:26985), data/intermediate/grades.json,
 *         data/intermediate/scored.json (directed scores)
 * Output: data/output/segments.geojson (EPSG:4326), data/output/summary.json
 *
 * One feature per block (grade signed in digitized A→B order, + = downhill), carrying
 * the static score of each legal direction plus the best direction for the map.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { md26985ToLonLat } from "../lib/crs.js";
import { OUTPUT_DIR } from "../lib/paths.js";
import { wardAt, type Area } from "../lib/area.js";
import { loadPipelineConfig } from "../lib/pipelineConfig.js";
import { AREA_FILE } from "./fetch.js";
import { BLOCKS_FILE, GRADES_FILE, type BlockGrade } from "./grade.js";
import { SCORED_FILE } from "./score.js";
import type { DirectedScore } from "../scoring/scoreSegment.js";

export const SEGMENTS_FILE = path.join(OUTPUT_DIR, "segments.geojson");
export const SUMMARY_FILE = path.join(OUTPUT_DIR, "summary.json");

const round = (v: unknown, d = 2): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;

/**
 * Count values into half-open buckets [e_i, e_i+1) defined by ascending edges.
 * Values outside the range are clamped into the end buckets; null → "null".
 */
export function bucketize(values: ReadonlyArray<number | null>, edges: readonly number[]): Record<string, number> {
  const labels = edges.slice(0, -1).map((e, i) => `${e}–${edges[i + 1]}`);
  const out: Record<string, number> = Object.fromEntries([...labels, "null"].map((l) => [l, 0]));
  for (const v of values) {
    if (v == null) {
      out.null!++;
      continue;
    }
    let i = labels.findIndex((_, j) => v < edges[j + 1]!);
    if (i < 0) i = labels.length - 1;
    out[labels[i]!]!++;
  }
  return out;
}

/** Point halfway along a planar LineString (EPSG:26985 coordinates). */
export function midpoint(coords: readonly (readonly number[])[]): number[] {
  const seg = coords.slice(1).map((c, i) => Math.hypot(c[0]! - coords[i]![0]!, c[1]! - coords[i]![1]!));
  let half = seg.reduce((a, b) => a + b, 0) / 2;
  for (const [i, len] of seg.entries()) {
    if (half <= len && len > 0) {
      const [a, b] = [coords[i]!, coords[i + 1]!];
      const t = half / len;
      return [a[0]! + t * (b[0]! - a[0]!), a[1]! + t * (b[1]! - a[1]!)];
    }
    half -= len;
  }
  return [...coords[coords.length - 1]!];
}

const countBy = (keys: string[]) => keys.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});

export async function run(): Promise<void> {
  for (const f of [BLOCKS_FILE, GRADES_FILE, AREA_FILE, SCORED_FILE]) {
    if (!existsSync(f)) throw new Error(`[export] missing ${f}; run fetch, join, grade and score first`);
  }
  const cfg = loadPipelineConfig().export;
  const area = JSON.parse(readFileSync(AREA_FILE, "utf8")) as Area;
  const blocks = JSON.parse(readFileSync(BLOCKS_FILE, "utf8")) as FeatureCollection<LineString>;
  const grades = JSON.parse(readFileSync(GRADES_FILE, "utf8")) as Record<string, BlockGrade>;

  const scored = new Map<string, DirectedScore[]>();
  for (const d of JSON.parse(readFileSync(SCORED_FILE, "utf8")) as DirectedScore[]) {
    scored.set(d.block_id, [...(scored.get(d.block_id) ?? []), d]);
  }

  const seen = new Set<string>();
  const features: Feature<LineString>[] = [];
  let duplicates = 0;
  for (const b of blocks.features) {
    const p = b.properties as Record<string, any>;
    const id = String(p.BlockID);
    // DDOT RoadwayBlocks returns at least one exact duplicate block; keep the first.
    if (seen.has(id)) {
      duplicates++;
      continue;
    }
    seen.add(id);
    const g = grades[id];
    const dirs = scored.get(id) ?? [];
    const byDir = (d: "AB" | "BA") => dirs.find((x) => x.direction === d);
    const kept = dirs.filter((x) => x.scores.static != null);
    const best = kept.length ? kept.reduce((a, b) => (b.scores.static! > a.scores.static! ? b : a)) : null;
    const traffic = dirs[0];
    const ward = wardAt(midpoint(b.geometry.coordinates), area.wards);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: b.geometry.coordinates.map((c) => md26985ToLonLat(c, cfg.coordDecimals)) },
      properties: {
        segment_id: id,
        ward,
        route_name: p.RouteName ?? null,
        from_street: p.FromStreet ?? null,
        to_street: p.ToStreet ?? null,
        length_m: round(p.length_m, 1),
        oneway: p.oneway ?? null,
        oneway_direction: p.oneway_direction ?? null,
        pci: round(p.pci, 1),
        pci_min: round(p.pci_min, 1),
        pci_coverage: round(p.pci_coverage, 2),
        pci_date: p.pci_date ?? null,
        pci_surface: p.pci_surface ?? null,
        pci_year: p.pci_year ?? null,
        grade_mean_pct: round(g?.grade_mean),
        grade_first20m_pct: round(g?.grade_first20m),
        grade_last20m_pct: round(g?.grade_last20m),
        grade_max_abs_pct: round(g?.grade_max_abs),
        grade_std_pct: round(g?.grade_std),
        elev_start_m: round(g?.elev_start_m),
        elev_end_m: round(g?.elev_end_m),
        elev_coverage: round(g?.elev_coverage),
        grade_flag: g ? g.grade_flag : "no_grade",
        grade_source: g?.grade_source ?? null,
        functional_class: p.functional_class ?? null,
        aadt: traffic?.aadt ?? null,
        aadt_imputed: traffic?.aadt_imputed ?? null,
        aadt_year: p.aadt_year ?? null,
        score_ab: round(byDir("AB")?.scores.static, 3),
        score_ba: round(byDir("BA")?.scores.static, 3),
        score_best: round(best?.scores.static, 3),
        score_best_direction: best?.direction ?? null,
        score_surface: round(best?.scores.surface, 3),
        score_grade: round(best?.scores.grade, 3),
        score_traffic: round(best?.scores.traffic, 3),
        score_run_quality: round(best?.scores.runQuality, 3),
        score_confidence: round(best?.confidence, 2),
        filter_reasons: [...new Set(dirs.flatMap((x) => x.filter_reasons))].join(", ") || null,
        filtered: dirs.length > 0 && kept.length === 0,
      },
    });
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const fc = {
    type: "FeatureCollection" as const,
    metadata: {
      area: area.name,
      wards: area.wards.map((w) => w.ward),
      crs: "EPSG:4326",
      pciYear: 2025,
      dtm: "DC OCTO 2024 Hydro-Enforced DTM (1 m)",
      createdAt: new Date().toISOString(),
    },
    features,
  };
  writeFileSync(SEGMENTS_FILE, JSON.stringify(fc));

  const props = features.map((f) => f.properties as Record<string, any>);
  const flags: Record<string, number> = {};
  for (const p of props) if (p.grade_flag) flags[p.grade_flag] = (flags[p.grade_flag] ?? 0) + 1;
  const summary = {
    area: area.name,
    segments: features.length,
    duplicatesDropped: duplicates,
    totalLengthKm: round(props.reduce((s, p) => s + (p.length_m ?? 0), 0) / 1000, 2),
    pciBuckets: bucketize(props.map((p) => p.pci), cfg.pciBucketEdges),
    absGradeBuckets: bucketize(
      props.map((p) => (p.grade_mean_pct == null ? null : Math.abs(p.grade_mean_pct))),
      cfg.absGradeBucketEdges,
    ),
    gradeFlags: flags,
    scoreBuckets: bucketize(props.map((p) => p.score_best), cfg.scoreBucketEdges),
    filteredSegments: props.filter((p) => p.filtered).length,
    aadt: countBy(props.map((p) => (p.aadt == null ? "missing" : p.aadt_imputed ? "imputed" : "measured"))),
    byWard: countBy(props.map((p) => (p.ward == null ? "outside" : String(p.ward)))),
  };
  writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  console.log(`[export] ${features.length} segments (${duplicates} duplicate dropped) → ${SEGMENTS_FILE}`);
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await run();
}
