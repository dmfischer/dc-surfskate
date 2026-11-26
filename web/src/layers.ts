/** MapLibre style expressions for each view mode, built from config/map.json. */
import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import mapConfig from "../../config/map.json";

export type Mode = "score" | "pci" | "grade" | "traffic" | "smooth";
export const MODES: { id: Mode; label: string }[] = [
  { id: "score", label: "Score" },
  { id: "pci", label: "Pavement" },
  { id: "grade", label: "Grade" },
  { id: "traffic", label: "Traffic" },
  { id: "smooth", label: "Smooth & gentle" },
];

type Stops = readonly (readonly [number, string])[];
const stops = (s: unknown) => s as Stops;

/** ["step", input, c0, b1, c1, b2, c2, ...] from [[b0, c0], [b1, c1], ...]. */
function step(input: ExpressionSpecification, s: Stops): ExpressionSpecification {
  const [first, ...rest] = s;
  return ["step", input, first![1], ...rest.flatMap(([b, c]) => [b, c])] as ExpressionSpecification;
}

const pci: ExpressionSpecification = ["get", "pci"];
const grade: ExpressionSpecification = ["get", "grade_mean_pct"];
const absGrade: ExpressionSpecification = ["abs", ["to-number", grade]];
const flag: ExpressionSpecification = ["coalesce", ["get", "grade_flag"], ""];

const hasPci: ExpressionSpecification = ["!=", pci, null];
const gradeReliable: ExpressionSpecification = [
  "all",
  ["!=", grade, null],
  ["!", ["in", flag, ["literal", mapConfig.grade.unreliableFlags]]],
];
const smoothAndGentle: ExpressionSpecification = [
  "all",
  hasPci,
  gradeReliable,
  [">=", ["to-number", pci], mapConfig.smooth.minPci],
  [">=", absGrade, mapConfig.smooth.minAbsGrade],
  ["<=", absGrade, mapConfig.smooth.maxAbsGrade],
];

const aadt: ExpressionSpecification = ["get", "aadt"];
const measuredAadt: ExpressionSpecification = ["all", ["!=", aadt, null], ["!=", ["get", "aadt_imputed"], true]];
const score: ExpressionSpecification = ["get", "score_best"];
const hasScore: ExpressionSpecification = ["!=", score, null];

export interface ModeStyle {
  /** Solid layer: filter + color + width + opacity. */
  filter: FilterSpecification;
  color: ExpressionSpecification | string;
  width: ExpressionSpecification | number;
  opacity: ExpressionSpecification | number;
  /** Dashed gray layer for segments with no usable value in this mode. */
  missingFilter: FilterSpecification;
}

const w = mapConfig.lineWidth;

export function modeStyle(mode: Mode): ModeStyle {
  switch (mode) {
    case "score":
      return {
        filter: hasScore,
        color: step(["to-number", score], stops(mapConfig.score.stops)),
        width: w,
        opacity: ["case", [">=", ["to-number", ["get", "score_confidence"]], 1], 1, mapConfig.score.lowConfidenceOpacity],
        missingFilter: ["!", hasScore],
      };
    case "traffic":
      return {
        filter: measuredAadt,
        color: step(["to-number", aadt], stops(mapConfig.traffic.stops)),
        width: w,
        opacity: 1,
        missingFilter: ["!", measuredAadt],
      };
    case "pci":
      return {
        filter: hasPci,
        color: step(["to-number", pci], stops(mapConfig.pci.stops)),
        width: w,
        opacity: 1,
        missingFilter: ["!", hasPci],
      };
    case "grade":
      return {
        filter: gradeReliable,
        color: step(absGrade, stops(mapConfig.grade.stops)),
        width: w,
        opacity: 1,
        missingFilter: ["!", gradeReliable],
      };
    case "smooth":
      return {
        filter: ["boolean", true],
        color: ["case", smoothAndGentle, mapConfig.smooth.color, mapConfig.smooth.otherColor],
        width: ["case", smoothAndGentle, w + 1, w - 2],
        opacity: 1,
        missingFilter: ["boolean", false],
      };
  }
}

export interface LegendItem {
  color: string;
  label: string;
  dashed?: boolean;
}

export function legend(mode: Mode): { title: string; items: LegendItem[]; note?: string } {
  const ramp = (cfg: { stops: unknown; legend: string[] }) =>
    stops(cfg.stops).map(([, color], i) => ({ color, label: cfg.legend[i] ?? "" }));
  switch (mode) {
    case "score":
      return {
        title: mapConfig.score.label,
        items: [
          ...ramp(mapConfig.score),
          { color: mapConfig.nullColor, label: mapConfig.score.filteredLabel, dashed: true },
        ],
        note: mapConfig.score.lowConfidenceLabel,
      };
    case "traffic":
      return {
        title: mapConfig.traffic.label,
        items: [...ramp(mapConfig.traffic), { color: mapConfig.nullColor, label: mapConfig.traffic.imputedLabel, dashed: true }],
      };
    case "pci":
      return {
        title: mapConfig.pci.label,
        items: [...ramp(mapConfig.pci), { color: mapConfig.nullColor, label: "No FY-25 PCI", dashed: true }],
      };
    case "grade":
      return {
        title: mapConfig.grade.label,
        items: [...ramp(mapConfig.grade), { color: mapConfig.nullColor, label: "Bridge / no reliable grade", dashed: true }],
      };
    case "smooth":
      return {
        title: mapConfig.smooth.label,
        items: [
          {
            color: mapConfig.smooth.color,
            label: `PCI ≥ ${mapConfig.smooth.minPci} and ${mapConfig.smooth.minAbsGrade}–${mapConfig.smooth.maxAbsGrade}% grade`,
          },
          { color: mapConfig.smooth.otherColor, label: "Everything else" },
        ],
      };
  }
}
