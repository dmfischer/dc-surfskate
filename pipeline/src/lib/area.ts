/** The study area (a DC ward) as a polygon and bbox in the work CRS (EPSG:26985). */
import { getSource } from "../sources.js";
import { esriToGeoJSON, getJson, type EsriFeature } from "./arcgis.js";
import { loadAreaConfig } from "./pipelineConfig.js";
import type { Polygon } from "geojson";

export interface Area {
  name: string;
  polygon: Polygon; // EPSG:26985 (Esri rings; may hold several outer rings)
  /** [xmin, ymin, xmax, ymax] in EPSG:26985, expanded by bufferM. */
  bbox: [number, number, number, number];
}

export async function loadArea(): Promise<Area> {
  const cfg = loadAreaConfig();
  const src = getSource("ward_2022");
  const res = await getJson<{ features: EsriFeature[] }>(`${src.url}/query`, {
    where: `WARD=${Number(cfg.ward)}`,
    outFields: "WARD,NAME",
    outSR: 26985,
    returnGeometry: true,
  });
  const f = res.features[0];
  if (!f) throw new Error(`Ward ${cfg.ward} not found in ${src.url}`);
  const polygon = esriToGeoJSON(f).geometry as Polygon;
  const xs = polygon.coordinates.flat().map((c) => c[0]!);
  const ys = polygon.coordinates.flat().map((c) => c[1]!);
  const b = cfg.bufferM;
  return {
    name: cfg.name,
    polygon,
    bbox: [Math.min(...xs) - b, Math.min(...ys) - b, Math.max(...xs) + b, Math.max(...ys) + b],
  };
}

/** ArcGIS spatial filter params for "features intersecting this area". */
export function areaQueryParams(area: Area) {
  return {
    geometry: JSON.stringify({ rings: area.polygon.coordinates, spatialReference: { wkid: 26985 } }),
    geometryType: "esriGeometryPolygon",
    inSR: 26985,
    spatialRel: "esriSpatialRelIntersects",
  };
}
