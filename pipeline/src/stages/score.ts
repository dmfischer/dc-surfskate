/**
 * Score stage: expand blocks into legal directed segments, apply hard filters,
 * and compute component + static scores from config/scoring.json.
 *
 * Input:  data/intermediate/blocks.geojson, data/intermediate/grades.json
 * Output: data/intermediate/scored.json (every directed segment, with scores or filter reasons)
 *         data/output/filtered.json     (hard-filtered segments and why; CLAUDE.md rule 3)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FeatureCollection, LineString } from "geojson";
import { loadScoringConfig } from "../lib/config.js";
import { INTERMEDIATE_DIR, OUTPUT_DIR } from "../lib/paths.js";
import { legalDirections, scoreDirectedSegment, type BlockInput, type BlockGradeInput, type DirectedScore } from "../scoring/scoreSegment.js";
import { BLOCKS_FILE, GRADES_FILE } from "./grade.js";

export const SCORED_FILE = path.join(INTERMEDIATE_DIR, "scored.json");
export const FILTERED_FILE = path.join(OUTPUT_DIR, "filtered.json");

export async function run(): Promise<void> {
  for (const f of [BLOCKS_FILE, GRADES_FILE]) {
    if (!existsSync(f)) throw new Error(`[score] missing ${f}; run join and grade first`);
  }
  const cfg = loadScoringConfig();
  const blocks = JSON.parse(readFileSync(BLOCKS_FILE, "utf8")) as FeatureCollection<LineString, BlockInput>;
  const grades = JSON.parse(readFileSync(GRADES_FILE, "utf8")) as Record<string, BlockGradeInput>;

  const seen = new Set<string>();
  const scored: DirectedScore[] = [];
  for (const f of blocks.features) {
    const b = f.properties;
    if (seen.has(b.BlockID)) continue; // DDOT returns a few exact duplicate blocks
    seen.add(b.BlockID);
    const { directions, assumed } = legalDirections(b);
    for (const d of directions) scored.push(scoreDirectedSegment(b, grades[b.BlockID] ?? null, d, cfg, assumed));
  }

  mkdirSync(INTERMEDIATE_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(SCORED_FILE, JSON.stringify(scored));
  const filtered = scored.filter((s) => s.filter_reasons.length).map((s) => ({ segment_id: s.segment_id, reasons: s.filter_reasons }));
  writeFileSync(FILTERED_FILE, JSON.stringify(filtered, null, 1));
  printSummary(scored);
}

const f = (v: number | null) => (v == null ? "—" : v.toFixed(2));

function printSummary(scored: DirectedScore[]): void {
  const kept = scored.filter((s) => !s.filter_reasons.length);
  const reasons: Record<string, number> = {};
  for (const s of scored) for (const r of s.filter_reasons) reasons[r.split(":")[0]!] = (reasons[r.split(":")[0]!] ?? 0) + 1;
  const statics = kept.map((s) => s.scores.static).filter((v): v is number => v != null).sort((a, b) => a - b);
  const q = (p: number) => statics[Math.min(statics.length - 1, Math.floor(p * statics.length))]?.toFixed(3);
  const present = (k: keyof DirectedScore["scores"]) => kept.filter((s) => s.scores[k] != null).length;

  console.log(`[score] directed segments: ${scored.length} (${kept.length} scored, ${scored.length - kept.length} filtered)`);
  console.log(`[score] filtered by reason: ${JSON.stringify(reasons)}`);
  console.log(`[score] AADT: measured ${kept.filter((s) => s.aadt != null && !s.aadt_imputed).length}, imputed ${kept.filter((s) => s.aadt_imputed).length}, missing ${kept.filter((s) => s.aadt == null).length}`);
  console.log(`[score] components present: surface ${present("surface")}, grade ${present("grade")}, traffic ${present("traffic")}, runQuality ${present("runQuality")}`);
  console.log(`[score] confidence < 1 (missing components): ${kept.filter((s) => s.confidence < 1).length}; no reliable grade: ${kept.filter((s) => s.scores.grade == null).length}`);
  console.log(`[score] static score quantiles: p10 ${q(0.1)}  p50 ${q(0.5)}  p90 ${q(0.9)}  max ${q(1)}`);
  // Rank only segments with a reliable grade; others can hit 1.0 on surface/traffic/length alone.
  const top = kept.filter((s) => s.scores.grade != null).sort((a, b) => (b.scores.static ?? 0) - (a.scores.static ?? 0)).slice(0, 5);
  for (const t of top) {
    console.log(
      `[score]   ${t.scores.static?.toFixed(3)} ${t.segment_id} grade ${t.grade_mean?.toFixed(1)}% aadt ${t.aadt}${t.aadt_imputed ? " (imputed)" : ""} ` +
        `[surf ${f(t.scores.surface)} grade ${f(t.scores.grade)} traffic ${f(t.scores.traffic)} run ${f(t.scores.runQuality)}]`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await run();
}
