/** Segment popup content, built with DOM APIs (street names are data, never HTML). */
import mapConfig from "../../config/map.json";

export interface SegmentProps {
  segment_id: string;
  route_name: string | null;
  from_street: string | null;
  to_street: string | null;
  length_m: number | null;
  oneway: boolean | null;
  oneway_direction: "AB" | "BA" | null;
  pci: number | null;
  pci_date: string | null;
  pci_surface: string | null;
  grade_mean_pct: number | null;
  grade_last20m_pct: number | null;
  grade_first20m_pct: number | null;
  grade_max_abs_pct: number | null;
  grade_std_pct: number | null;
  elev_start_m: number | null;
  elev_end_m: number | null;
  grade_flag: string | null;
  functional_class: string | null;
  aadt: number | null;
  aadt_imputed: boolean | null;
  score_ab: number | null;
  score_ba: number | null;
  score_best: number | null;
  score_best_direction: "AB" | "BA" | null;
  score_surface: number | null;
  score_grade: number | null;
  score_traffic: number | null;
  score_run_quality: number | null;
  score_confidence: number | null;
  filter_reasons: string | null;
  filtered: boolean;
}

const fmt = (v: number | null, digits = 1, unit = "") => (v == null ? "—" : `${v.toFixed(digits)}${unit}`);

/** "4.4% ↓ downhill toward Belmont Rd NW" in plain words, from the A→B signed grade. */
export function describeGrade(p: SegmentProps): string {
  const g = p.grade_mean_pct;
  if (g == null) return "—";
  if (Math.abs(g) < mapConfig.grade.flatBelowPct) return `${Math.abs(g).toFixed(1)}% (about flat)`;
  const toward = g > 0 ? p.to_street : p.from_street;
  return `${Math.abs(g).toFixed(1)}% ↓ downhill toward ${toward ?? "the other end"}`;
}

function describeTraffic(p: SegmentProps): string {
  if (p.aadt == null) return "—";
  const n = p.aadt.toLocaleString("en-US");
  const cls = p.functional_class?.replace(/_/g, " ");
  return p.aadt_imputed ? `~${n}/day (estimated${cls ? `, ${cls}` : ""})` : `${n}/day (2025 count)`;
}

/** Best direction in words: "0.82 heading toward Belmont Rd NW". */
function describeScore(p: SegmentProps): string {
  if (p.filtered) return `Filtered: ${p.filter_reasons ?? "?"}`;
  if (p.score_best == null) return "—";
  const toward = p.score_best_direction === "AB" ? p.to_street : p.from_street;
  return `${p.score_best.toFixed(2)} heading toward ${toward ?? "?"}`;
}

const s2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));

function describeOneway(p: SegmentProps): string {
  if (p.oneway == null) return "Unknown";
  if (!p.oneway) return "Two way";
  const toward = p.oneway_direction === "AB" ? p.to_street : p.from_street;
  return `One way → ${toward ?? "?"}`;
}

export function popupContent(p: SegmentProps): HTMLElement {
  const root = document.createElement("div");
  root.className = "popup";

  const h = document.createElement("h3");
  h.textContent = p.route_name ?? "Unnamed street";
  root.append(h);
  const sub = document.createElement("div");
  sub.className = "popup-sub";
  sub.textContent = `${p.from_street ?? "?"} → ${p.to_street ?? "?"}`;
  root.append(sub);

  if (p.grade_flag) {
    const warn = document.createElement("div");
    warn.className = "popup-flag";
    warn.textContent =
      p.grade_flag === "bridge"
        ? "Bridge: the terrain model reads the valley below, so grade is unreliable."
        : `Grade flag: ${p.grade_flag}`;
    root.append(warn);
  }

  const both = p.score_ab != null && p.score_ba != null;
  const rows: [string, string][] = [
    ["Score", describeScore(p)],
    ...(p.score_best != null && !p.filtered
      ? ([
          ["  components", `surface ${s2(p.score_surface)} · grade ${s2(p.score_grade)} · traffic ${s2(p.score_traffic)} · run ${s2(p.score_run_quality)}`],
          ["  confidence", `${Math.round((p.score_confidence ?? 0) * 100)}% of weight backed by data`],
          ...(both ? ([["  each way", `→ ${p.to_street ?? "B"} ${s2(p.score_ab)} · → ${p.from_street ?? "A"} ${s2(p.score_ba)}`]] as [string, string][]) : []),
        ] as [string, string][])
      : []),
    ["PCI", p.pci == null ? "No FY-25 data" : `${p.pci.toFixed(0)}${p.pci_date ? ` (inspected ${p.pci_date})` : ""}`],
    ["Surface", p.pci_surface ?? "—"],
    ["Grade", describeGrade(p)],
    ["Steepest 20 m", fmt(p.grade_max_abs_pct, 1, "%")],
    ["Roughness (std)", fmt(p.grade_std_pct, 2, "%")],
    ["Elevation", `${fmt(p.elev_start_m, 1, " m")} → ${fmt(p.elev_end_m, 1, " m")}`],
    ["Length", fmt(p.length_m, 0, " m")],
    ["Volume", describeTraffic(p)],
    ["Direction", describeOneway(p)],
  ];
  const dl = document.createElement("dl");
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  }
  root.append(dl);

  const id = document.createElement("div");
  id.className = "popup-id";
  id.textContent = p.segment_id;
  root.append(id);
  return root;
}
