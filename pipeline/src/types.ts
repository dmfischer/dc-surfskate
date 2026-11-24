import type { LineString } from "geojson";

export type Direction = "AB" | "BA";

export interface ScoredSegment {
  segment_id: string; // block id + direction suffix, e.g. "12345_AB"
  geometry: LineString;
  direction: Direction;
  functional_class: string;
  oneway: boolean;
  speed_limit_mph?: number;
  surface_material?: "asphalt" | "concrete" | "brick" | "other";
  paved_date?: string;
  condition_rating?: number;
  open_potholes: number;
  grade_mean: number; // percent, + = downhill in travel direction
  grade_std: number;
  grade_last20m: number;
  length_m: number;
  aadt: number;
  aadt_imputed: boolean;
  has_bike_lane: boolean;
  crash_count_3yr?: number;
  bottom_control?: "stop" | "signal" | "none";
  nws_grid: { office: string; x: number; y: number };
  scores: { surface: number; grade: number; traffic: number; runQuality: number; static: number };
}

export interface FilteredSegment {
  segment_id: string;
  reason: string;
}
