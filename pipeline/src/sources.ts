/**
 * Registry of external datasets. Per CLAUDE.md rule 7: fetch a sample and record
 * the *actual* field names here before writing any join against a dataset.
 */
export interface DataSource {
  id: string;
  name: string;
  url: string;
  /** Data vintage, e.g. 2024. DC publishes separate datasets per year. */
  year?: number;
  /** Native CRS of the response; reproject to EPSG:4326 on ingest. */
  crs?: "EPSG:4326" | "EPSG:3857" | string;
  /** Verified field names from an inspected sample. Empty until audited. */
  fields: Record<string, string>;
  verifiedOn?: string;
  notes?: string;
}

export const sources: DataSource[] = [
  {
    id: "traffic_volume_2024",
    name: "2024 Traffic Volume (AADT by roadway block)",
    url: "https://opendata.dc.gov/api/download/v1/items/948099175f3a44cca2d6a633cf3ec35a/geojson?layers=5",
    year: 2024,
    fields: {},
    notes: "Not yet audited.",
  },
];
