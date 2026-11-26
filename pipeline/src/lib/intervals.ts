/**
 * Pure helpers for linear-referencing joins on the DDOT LRS.
 *
 * Every DDOT event layer is keyed by ROUTEID + FROMMEASURE/TOMEASURE (meters
 * along the route). An attribute joins onto a block by overlapping measure
 * intervals on the same route; no geometry is involved.
 */

/** A measure interval with from <= to. */
export interface Interval {
  from: number;
  to: number;
}

/** An event on a route, e.g. a PCI section. Measures may be reversed (from > to). */
export interface RouteEvent<T> {
  routeId: string;
  from: number;
  to: number;
  value: T;
}

/** The part of one event that falls inside a target interval. */
export interface Overlap<T> {
  value: T;
  /** The event clipped to the target, normalized. */
  interval: Interval;
  length: number;
}

/** Order the endpoints so from <= to. */
export function normalize(from: number, to: number): Interval {
  return from <= to ? { from, to } : { from: to, to: from };
}

export const intervalLength = (i: Interval): number => i.to - i.from;

/** Length of the intersection of two intervals (0 when they only touch or are disjoint). */
export function overlapLength(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));
}

/** Group events by route so each target only scans its own route. */
export function indexByRoute<T>(events: Iterable<RouteEvent<T>>): Map<string, RouteEvent<T>[]> {
  const m = new Map<string, RouteEvent<T>[]>();
  for (const e of events) {
    const list = m.get(e.routeId);
    if (list) list.push(e);
    else m.set(e.routeId, [e]);
  }
  return m;
}

/**
 * Events on the same route that overlap the target by a positive length,
 * clipped to the target. Events on other routes are ignored.
 */
export function overlapsOnRoute<T>(
  target: { routeId: string; from: number; to: number },
  events: RouteEvent<T>[] | Map<string, RouteEvent<T>[]>,
): Overlap<T>[] {
  const t = normalize(target.from, target.to);
  const candidates = events instanceof Map ? (events.get(target.routeId) ?? []) : events;
  const out: Overlap<T>[] = [];
  for (const e of candidates) {
    if (e.routeId !== target.routeId) continue;
    const ei = normalize(e.from, e.to);
    const length = overlapLength(t, ei);
    if (length > 0) {
      out.push({ value: e.value, length, interval: { from: Math.max(t.from, ei.from), to: Math.min(t.to, ei.to) } });
    }
  }
  return out;
}

/**
 * Fraction (0–1) of the target covered by the union of the overlaps. Overlapping
 * events are not double-counted. A zero-length target has coverage 0.
 */
export function coverageFraction(target: Interval, overlaps: Overlap<unknown>[]): number {
  const t = normalize(target.from, target.to);
  const total = intervalLength(t);
  if (total <= 0) return 0;
  const parts = overlaps.map((o) => o.interval).sort((a, b) => a.from - b.from);
  let covered = 0;
  let cur: Interval | null = null;
  for (const p of parts) {
    if (cur && p.from <= cur.to) {
      cur.to = Math.max(cur.to, p.to);
    } else {
      if (cur) covered += overlapLength(t, cur);
      cur = { ...p };
    }
  }
  if (cur) covered += overlapLength(t, cur);
  return Math.min(1, covered / total);
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Length-weighted mean of numeric values; null/NaN values are skipped. Null when nothing remains. */
export function weightedMean(overlaps: Overlap<number | null>[]): number | null {
  let sum = 0;
  let w = 0;
  for (const o of overlaps) {
    if (!finite(o.value)) continue;
    sum += o.value * o.length;
    w += o.length;
  }
  return w > 0 ? sum / w : null;
}

/** Minimum numeric value; null/NaN values are skipped. */
export function minValue(overlaps: Overlap<number | null>[]): number | null {
  let m: number | null = null;
  for (const o of overlaps) if (finite(o.value) && (m === null || o.value < m)) m = o.value;
  return m;
}

/** Maximum numeric value (e.g. latest epoch-ms date); null/NaN values are skipped. */
export function maxValue(overlaps: Overlap<number | null>[]): number | null {
  let m: number | null = null;
  for (const o of overlaps) if (finite(o.value) && (m === null || o.value > m)) m = o.value;
  return m;
}

/** Latest date among overlaps (values are epoch ms, as ArcGIS returns them) as an ISO date string. */
export function latestDate(overlaps: Overlap<number | null>[]): string | null {
  const ms = maxValue(overlaps);
  return ms === null ? null : new Date(ms).toISOString().slice(0, 10);
}

/**
 * Value with the greatest total overlap length. Null/undefined values are
 * skipped. Ties go to the value seen first.
 */
export function majorityByLength<T>(overlaps: Overlap<T | null | undefined>[]): T | null {
  const totals = new Map<T, number>();
  for (const o of overlaps) {
    if (o.value === null || o.value === undefined) continue;
    totals.set(o.value, (totals.get(o.value) ?? 0) + o.length);
  }
  let best: T | null = null;
  let bestLen = -Infinity;
  for (const [v, len] of totals) {
    if (len > bestLen) {
      best = v;
      bestLen = len;
    }
  }
  return best;
}

/** Project a list of overlaps onto one field of their value. */
export function pluck<T, K extends keyof T>(overlaps: Overlap<T>[], key: K): Overlap<T[K]>[] {
  return overlaps.map((o) => ({ ...o, value: o.value[key] }));
}
