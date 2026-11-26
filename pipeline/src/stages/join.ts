/**
 * Join stage: attach PCI FY-25 and directionality onto DDOT blocks by
 * ROUTEID + measure overlap and write data/intermediate/blocks.geojson.
 *
 * Output contract (consumed by the grade stage):
 * - One undirected LineString per block, EPSG:26985, 2D (M dropped).
 * - Geometry runs from FromMeasure (A end) to ToMeasure (B end). Verified on
 *   Ward 1: every block's first/last M equals FromMeasure/ToMeasure.
 * - roadway_segments geometry is digitized in increasing measure, so
 *   DIRECTIONALITY 0 (one way, digitizing direction) means legal travel A→B
 *   and 1 means B→A; exposed as `oneway_direction`.
 * - Missing data is null, never 0 (CLAUDE.md rule 4).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Feature, FeatureCollection, LineString, MultiLineString, Position } from "geojson";
import {
  coverageFraction,
  indexByRoute,
  latestDate,
  majorityByLength,
  minValue,
  overlapsOnRoute,
  pluck,
  weightedMean,
  type RouteEvent,
} from "../lib/intervals.js";
import { INTERMEDIATE_DIR, RAW_DIR } from "../lib/paths.js";
import { loadPipelineConfig } from "../lib/pipelineConfig.js";

const PCI_YEAR = 2025;

type Props = Record<string, any>;
type LineFeature = Feature<LineString | MultiLineString, Props>;

export type Surface = "asphalt" | "concrete" | "other";

/** PCI FY-25 SURFACE code → surface_material. */
export function mapPciSurface(code: unknown): Surface | null {
  if (code === null || code === undefined || code === "") return null;
  if (code === "AC") return "asphalt";
  if (code === "PCC") return "concrete";
  return "other";
}

/** DIRECTIONALITY (0/1 one way, 2 two way, 3 unknown) → oneway flag; null when unknown. */
export function onewayFromDirectionality(d: number | null): { oneway: boolean | null; oneway_direction: "AB" | "BA" | null } {
  if (d === 0) return { oneway: true, oneway_direction: "AB" };
  if (d === 1) return { oneway: true, oneway_direction: "BA" };
  if (d === 2) return { oneway: false, oneway_direction: null };
  return { oneway: null, oneway_direction: null };
}

function readFeatures(file: string): LineFeature[] {
  const fc = JSON.parse(readFileSync(path.join(RAW_DIR, file), "utf8")) as FeatureCollection;
  return fc.features.filter((f): f is LineFeature => f.geometry?.type === "LineString" || f.geometry?.type === "MultiLineString");
}

const to2d = (c: Position[]): Position[] => c.map((p) => [p[0]!, p[1]!]);

function planarLength(c: Position[]): number {
  let len = 0;
  for (let i = 1; i < c.length; i++) len += Math.hypot(c[i]![0]! - c[i - 1]![0]!, c[i]![1]! - c[i - 1]![1]!);
  return len;
}

interface PciValue {
  pci: number | null;
  date: number | null;
  surface: string | null;
}

interface SegValue {
  directionality: number | null;
  roadtype: number | null;
}

export async function run(): Promise<void> {
  const { minPciCoverage } = loadPipelineConfig().join;

  const blocks = readFeatures("blocks.geojson");
  const pci = indexByRoute<PciValue>(
    readFeatures("pci_fy25.geojson")
      .filter((f) => typeof f.properties.PCI === "number")
      .map((f) => ({
        routeId: String(f.properties.ROUTEID),
        from: f.properties.FROMMEASURE,
        to: f.properties.TOMEASURE,
        value: { pci: f.properties.PCI, date: f.properties.DATE1 ?? null, surface: f.properties.SURFACE ?? null },
      })),
  );
  const segs = indexByRoute<SegValue>(
    readFeatures("roadway_segments.geojson").map(
      (f): RouteEvent<SegValue> => ({
        routeId: String(f.properties.ROUTEID),
        from: f.properties.FROMMEASURE,
        to: f.properties.TOMEASURE,
        value: { directionality: f.properties.DIRECTIONALITY ?? null, roadtype: f.properties.ROADTYPE ?? null },
      }),
    ),
  );

  const out: Feature<LineString, Props>[] = [];
  let multiPart = 0;
  for (const b of blocks) {
    const p = b.properties;
    if (b.geometry.type === "MultiLineString") multiPart++;
    // Blocks are single-part in Ward 1; if a multi-part block ever appears, concatenate parts in order.
    const coords = to2d(b.geometry.type === "LineString" ? b.geometry.coordinates : b.geometry.coordinates.flat());
    const target = { routeId: String(p.RouteID), from: p.FromMeasure, to: p.ToMeasure };

    const po = overlapsOnRoute(target, pci);
    const pciCoverage = coverageFraction(target, po);
    const hasPci = pciCoverage >= minPciCoverage;

    const so = overlapsOnRoute(target, segs);
    const directionality = majorityByLength(pluck(so, "directionality"));

    out.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        BlockID: p.BlockID,
        BlockKey: p.BlockKey,
        RouteID: p.RouteID,
        FromMeasure: p.FromMeasure,
        ToMeasure: p.ToMeasure,
        RouteName: p.RouteName,
        FromStreet: p.FromStreet,
        ToStreet: p.ToStreet,
        FromIntersectionID: p.FromIntersectionID,
        ToIntersectionID: p.ToIntersectionID,
        HundredBlock: p.HundredBlock,
        length_m: planarLength(coords),
        pci: hasPci ? weightedMean(pluck(po, "pci")) : null,
        pci_min: hasPci ? minValue(pluck(po, "pci")) : null,
        pci_coverage: pciCoverage,
        pci_date: hasPci ? latestDate(pluck(po, "date")) : null,
        pci_surface: hasPci ? mapPciSurface(majorityByLength(pluck(po, "surface"))) : null,
        pci_year: hasPci ? PCI_YEAR : null,
        pci_section_count: po.length,
        directionality,
        roadtype: majorityByLength(pluck(so, "roadtype")),
        segment_coverage: coverageFraction(target, so),
        ...onewayFromDirectionality(directionality),
      },
    });
  }

  mkdirSync(INTERMEDIATE_DIR, { recursive: true });
  const file = path.join(INTERMEDIATE_DIR, "blocks.geojson");
  writeFileSync(
    file,
    JSON.stringify({
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::26985" } },
      metadata: { stage: "join", minPciCoverage, pciYear: PCI_YEAR, createdAt: new Date().toISOString() },
      features: out,
    }),
  );
  printSummary(out, file, multiPart, minPciCoverage);
}

function printSummary(fs: Feature<LineString, Props>[], file: string, multiPart: number, minCov: number): void {
  const props = fs.map((f) => f.properties);
  const pcis = props.map((p) => p.pci).filter((v): v is number => v !== null);
  const fmt = (n: number) => n.toFixed(1);
  console.log(`[join] wrote ${file}`);
  console.log(`[join] blocks: ${props.length}${multiPart ? ` (${multiPart} multi-part, parts concatenated)` : ""}`);
  console.log(`[join] total length: ${(props.reduce((s, p) => s + p.length_m, 0) / 1000).toFixed(2)} km`);
  if (pcis.length) {
    console.log(
      `[join] PCI (blocks with coverage >= ${minCov}): n=${pcis.length} min=${fmt(Math.min(...pcis))} ` +
        `max=${fmt(Math.max(...pcis))} mean=${fmt(pcis.reduce((a, b) => a + b, 0) / pcis.length)}`,
    );
  }
  console.log(`[join] blocks with null PCI: ${props.length - pcis.length}`);

  // Display-only bins for the summary; not a tunable parameter.
  const bins = [
    { label: "0", test: (c: number) => c === 0 },
    { label: "(0,0.25)", test: (c: number) => c > 0 && c < 0.25 },
    { label: "[0.25,0.5)", test: (c: number) => c >= 0.25 && c < 0.5 },
    { label: "[0.5,0.75)", test: (c: number) => c >= 0.5 && c < 0.75 },
    { label: "[0.75,0.99)", test: (c: number) => c >= 0.75 && c < 0.99 },
    { label: "[0.99,1]", test: (c: number) => c >= 0.99 },
  ];
  console.log("[join] PCI coverage histogram:");
  for (const b of bins) console.log(`         ${b.label.padEnd(12)} ${props.filter((p) => b.test(p.pci_coverage)).length}`);

  const count = (key: string) => {
    const m = new Map<string, number>();
    for (const p of props) m.set(String(p[key]), (m.get(String(p[key])) ?? 0) + 1);
    return [...m].sort().map(([k, v]) => `${k}: ${v}`).join(", ");
  };
  console.log(`[join] directionality (0/1 one way, 2 two way, 3 unknown, null no segment): ${count("directionality")}`);
  console.log(`[join] oneway: ${count("oneway")}`);
  console.log(`[join] roadtype: ${count("roadtype")}`);
  console.log(`[join] pci_surface: ${count("pci_surface")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await run();
}
