/** The study area (one or more DC wards) as polygons and a bbox in the work CRS (EPSG:26985). */
import { getSource } from "../sources.js";
import { getJson, type EsriFeature } from "./arcgis.js";
import { loadAreaConfig } from "./pipelineConfig.js";

export interface WardPolygon {
  ward: number;
  /** Esri rings in EPSG:26985 (outer rings clockwise, holes counter-clockwise). */
  rings: number[][][];
}

export interface Area {
  name: string;
  wards: WardPolygon[];
  /** [xmin, ymin, xmax, ymax] in EPSG:26985 over all wards, expanded by bufferM. */
  bbox: [number, number, number, number];
}

export async function loadArea(): Promise<Area> {
  const cfg = loadAreaConfig();
  const wardIds = cfg.wards.map(Number);
  if (wardIds.length === 0 || wardIds.some((w) => !Number.isInteger(w))) {
    throw new Error(`config/area.json: "wards" must be a non-empty list of ward numbers`);
  }
  const src = getSource("ward_2022");
  const res = await getJson<{ features: EsriFeature[] }>(`${src.url}/query`, {
    where: `WARD IN (${wardIds.join(",")})`,
    outFields: "WARD,NAME",
    outSR: 26985,
    returnGeometry: true,
  });
  const wards: WardPolygon[] = res.features.map((f) => ({ ward: Number(f.attributes.WARD), rings: f.geometry?.rings ?? [] }));
  const missing = wardIds.filter((w) => !wards.some((x) => x.ward === w));
  if (missing.length) throw new Error(`Ward(s) ${missing.join(", ")} not found in ${src.url}`);

  const pts = wards.flatMap((w) => w.rings.flat());
  const xs = pts.map((c) => c[0]!);
  const ys = pts.map((c) => c[1]!);
  const b = cfg.bufferM;
  return {
    name: cfg.name,
    wards: wards.sort((a, z) => a.ward - z.ward),
    bbox: [Math.min(...xs) - b, Math.min(...ys) - b, Math.max(...xs) + b, Math.max(...ys) + b],
  };
}

/** ArcGIS spatial filter params for "features intersecting any ward in this area". */
export function areaQueryParams(area: Area) {
  return {
    geometry: JSON.stringify({ rings: area.wards.flatMap((w) => w.rings), spatialReference: { wkid: 26985 } }),
    geometryType: "esriGeometryPolygon",
    inSR: 26985,
    spatialRel: "esriSpatialRelIntersects",
  };
}

/** Even-odd point-in-polygon over Esri rings (holes handled by parity). Planar; use projected coords. */
export function pointInRings([x, y]: readonly number[], rings: readonly (readonly (readonly number[])[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi! > y! !== yj! > y! && x! < ((xj! - xi!) * (y! - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
  }
  return inside;
}

/** The ward containing a point, or null if it lies outside every ward in the area. */
export function wardAt(point: readonly number[], wards: readonly WardPolygon[]): number | null {
  return wards.find((w) => pointInRings(point, w.rings))?.ward ?? null;
}
