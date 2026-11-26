import proj4 from "proj4";

/** NAD83 / Maryland (meters), the native CRS of DDOT layers and our work CRS. */
proj4.defs(
  "EPSG:26985",
  "+proj=lcc +lat_0=37.6666666666667 +lon_0=-77 +lat_1=39.45 +lat_2=38.3 +x_0=400000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
);

const toWgs84 = proj4("EPSG:26985", "EPSG:4326");

/** EPSG:26985 [x, y] → EPSG:4326 [lon, lat], rounded to `decimals` (6 ≈ 0.1 m). */
export function md26985ToLonLat([x, y]: readonly number[], decimals = 6): [number, number] {
  const [lon, lat] = toWgs84.forward([x!, y!]);
  const f = 10 ** decimals;
  return [Math.round(lon! * f) / f, Math.round(lat! * f) / f];
}
