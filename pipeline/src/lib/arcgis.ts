/**
 * Minimal ArcGIS REST client. Uses Esri JSON (f=json) rather than f=geojson so
 * outSR and returnM are honored exactly; convert with esriToGeoJSON().
 */
import type { Feature, Geometry } from "geojson";
import { loadPipelineConfig } from "./pipelineConfig.js";

export type Params = Record<string, string | number | boolean>;

export interface EsriFeature {
  attributes: Record<string, unknown>;
  geometry?: { paths?: number[][][]; rings?: number[][][]; x?: number; y?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJson<T = any>(url: string, params: Params = {}): Promise<T> {
  const { userAgent } = loadPipelineConfig().arcgis;
  const u = new URL(url);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries({ f: "json", ...params })) body.set(k, String(v));
  // POST so large params (e.g. a ward polygon as the spatial filter) don't overflow the URL.
  const res = await fetch(u, {
    method: "POST",
    headers: { "User-Agent": userAgent, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${u}`);
  const json = (await res.json()) as any;
  // ArcGIS reports errors with HTTP 200 and an `error` member.
  if (json?.error) throw new Error(`ArcGIS error for ${u}: ${JSON.stringify(json.error)}`);
  return json as T;
}

/** Layer metadata (fields, maxRecordCount, spatialReference, ...). */
export const getLayerInfo = (layerUrl: string) => getJson(layerUrl);

/**
 * Query every matching feature, paginating with resultOffset until a short or
 * empty page arrives and the server no longer reports exceededTransferLimit.
 */
export async function queryAll(layerUrl: string, params: Params = {}): Promise<EsriFeature[]> {
  const { pageSize, requestDelayMs } = loadPipelineConfig().arcgis;
  const out: EsriFeature[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await getJson<{ features: EsriFeature[]; exceededTransferLimit?: boolean }>(
      `${layerUrl}/query`,
      { where: "1=1", outFields: "*", orderByFields: "OBJECTID", ...params, resultOffset: offset, resultRecordCount: pageSize },
    );
    out.push(...page.features);
    if (page.features.length === 0 || (!page.exceededTransferLimit && page.features.length < pageSize)) break;
    await sleep(requestDelayMs);
  }
  return out;
}

/** Convert an Esri JSON feature (polyline / polygon / point) to GeoJSON. Keeps M/Z if present. */
export function esriToGeoJSON(f: EsriFeature): Feature<Geometry | null> {
  const g = f.geometry;
  let geometry: Geometry | null = null;
  if (g?.paths) {
    geometry = g.paths.length === 1 ? { type: "LineString", coordinates: g.paths[0]! } : { type: "MultiLineString", coordinates: g.paths };
  } else if (g?.rings) {
    geometry = { type: "Polygon", coordinates: g.rings };
  } else if (g && typeof g.x === "number" && typeof g.y === "number") {
    geometry = { type: "Point", coordinates: [g.x, g.y] };
  }
  return { type: "Feature", properties: f.attributes, geometry };
}
