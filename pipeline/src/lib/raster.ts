/**
 * In-memory single-band rasters and GeoTIFF I/O for the DTM tiles.
 *
 * Convention: (originX, originY) is the OUTER top-left corner of the top-left
 * pixel (GeoTIFF PixelIsArea). Pixel (col, row) covers
 *   x ∈ [originX + col·px, originX + (col+1)·px),  y ∈ (originY − (row+1)·py, originY − row·py]
 * and its value represents the pixel CENTER (originX + (col+½)·px, originY − (row+½)·py).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fromFile } from "geotiff";

export interface Raster {
  originX: number;
  originY: number;
  /** Pixel width in CRS units (positive). */
  pixelSizeX: number;
  /** Pixel height in CRS units (positive; rows run north → south). */
  pixelSizeY: number;
  width: number;
  height: number;
  /** Row-major, row 0 = north edge. */
  data: Float32Array;
  nodata: number;
}

export interface DtmTileEntry {
  file: string;
  /** [xmin, ymin, xmax, ymax] in EPSG:26985. */
  bbox: [number, number, number, number];
  width: number;
  height: number;
}

export interface DtmIndex {
  source: string;
  url: string;
  crs: string;
  pixelSizeM: number;
  nodata: number;
  fetchedAt: string;
  tiles: DtmTileEntry[];
}

export interface TileCheck {
  epsg: number | undefined;
  rasterType: number | undefined;
  pixelSizeX: number;
  pixelSizeY: number;
  gdalNodata: number | null;
  min: number;
  max: number;
  nodataCount: number;
  total: number;
}

/** Read band 1 of a GeoTIFF into a Raster plus the metadata needed to verify it. */
export async function readGeoTiff(file: string): Promise<{ raster: Raster; check: Omit<TileCheck, "min" | "max" | "nodataCount" | "total"> }> {
  const tiff = await fromFile(file);
  const image = await tiff.getImage();
  const [originX, originY] = image.getOrigin() as [number, number];
  const [resX, resY] = image.getResolution() as [number, number];
  const keys = (image.getGeoKeys() ?? {}) as Record<string, number | undefined>;
  const gdalNodata = image.getGDALNoData();
  const bands = (await image.readRasters({ interleave: false })) as unknown as ArrayLike<number>[];
  const band = bands[0];
  if (!band) throw new Error(`${file}: no raster band`);
  const data = band instanceof Float32Array ? band : Float32Array.from(band);
  const raster: Raster = {
    originX,
    originY,
    pixelSizeX: Math.abs(resX),
    pixelSizeY: Math.abs(resY),
    width: image.getWidth(),
    height: image.getHeight(),
    data,
    nodata: gdalNodata ?? NaN,
  };
  return {
    raster,
    check: {
      epsg: keys.ProjectedCSTypeGeoKey,
      rasterType: keys.GTRasterTypeGeoKey,
      pixelSizeX: Math.abs(resX),
      pixelSizeY: Math.abs(resY),
      gdalNodata,
    },
  };
}

/** Load every tile listed in a DTM index.json. */
export async function loadDtmRasters(indexFile: string): Promise<{ index: DtmIndex; rasters: Raster[] }> {
  const index = JSON.parse(readFileSync(indexFile, "utf8")) as DtmIndex;
  const dir = path.dirname(indexFile);
  const rasters: Raster[] = [];
  for (const t of index.tiles) {
    const { raster } = await readGeoTiff(path.join(dir, t.file));
    rasters.push(raster);
  }
  return { index, rasters };
}

/** Bounding box [xmin, ymin, xmax, ymax] of a raster's outer pixel edges. */
export function rasterBounds(r: Raster): [number, number, number, number] {
  return [r.originX, r.originY - r.height * r.pixelSizeY, r.originX + r.width * r.pixelSizeX, r.originY];
}
