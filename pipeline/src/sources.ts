/**
 * Registry of external datasets. Per CLAUDE.md rule 7: fetch a sample and record
 * the *actual* field names here before writing any join against a dataset.
 *
 * DDOT linear referencing system (LRS): almost every DDOT layer is an "event"
 * on a route, keyed by ROUTEID + FROMMEASURE/TOMEASURE (meters along the route).
 * RoadwayBlocks uses the same key, so attributes join to blocks by interval
 * overlap on the same route — no geometry snapping needed.
 *
 * Native CRS for all DDOT services is EPSG:26985 (NAD83 / Maryland, meters).
 * Query with `outSR=4326` to get WGS84, or keep 26985 for metric math.
 *
 * LRS event layers carry FROMDATE/TODATE; use `TODATE IS NULL` for current events.
 */
export interface DataSource {
  id: string;
  name: string;
  /** ArcGIS REST layer URL (append /query) or direct download URL. */
  url: string;
  /** Data vintage, e.g. 2024. DC publishes separate datasets per year. */
  year?: number;
  /** Native CRS of the response; reproject to EPSG:4326 on ingest. */
  crs?: "EPSG:4326" | "EPSG:3857" | "EPSG:26985" | string;
  /** Approximate record count at time of audit. */
  count?: number;
  /** Max records per query page (paginate with resultOffset). */
  maxRecordCount?: number;
  /** Verified field names from an inspected sample → meaning. Empty until audited. */
  fields: Record<string, string>;
  verifiedOn?: string;
  notes?: string;
}

const DDOT = "https://rh.dcgis.dc.gov/dcgis/rest/services/DDOT";

export const sources: DataSource[] = [
  {
    id: "roadway_blocks",
    name: "DDOT Roadway Blocks — Block",
    url: `${DDOT}/RoadwayBlocks/MapServer/2`,
    crs: "EPSG:26985",
    count: 13833,
    maxRecordCount: 1000,
    fields: {
      BlockID: "block id (route + from/to intersection ids); join key for segment_id",
      BlockKey: "hash id of block",
      RouteID: "LRS route id",
      FromMeasure: "start measure on route (m); A end",
      ToMeasure: "end measure on route (m); B end",
      RouteName: "street name, e.g. 'L ST NW'",
      FromStreet: "cross street at A end",
      ToStreet: "cross street at B end",
      FromIntersectionID: "intersection id at A end",
      ToIntersectionID: "intersection id at B end",
      HundredBlock: "address range label",
    },
    verifiedOn: "2026-11-24",
    notes: "Directionality field exists but is NULL for every row; take one-way from roadway_segments instead.",
  },
  {
    id: "roadway_segments",
    name: "DDOT LRSSupport — Roadway Segment",
    url: `${DDOT}/LRSSupport/MapServer/3`,
    crs: "EPSG:26985",
    count: 33611,
    maxRecordCount: 1000,
    fields: {
      ROADWAYSEGID: "segment id",
      ROUTEID: "LRS route id",
      FROMMEASURE: "start measure (m)",
      TOMEASURE: "end measure (m)",
      ROUTENAME: "street name",
      ROADTYPE: "1=Street 2=Service Road 3=Ramp 4=Alley 5=Driveway 6=Trail 7=Walkway 8=Streetcar",
      DIRECTIONALITY: "0=One way (digitizing dir) 1=One way (against digitizing) 2=Two way 3=Unknown",
      STREETSEGID: "street segment id",
    },
    verifiedOn: "2026-11-24",
    notes: "Streets (ROADTYPE=1): 18,203 two-way, 1,983 one-way with digitizing, 1,679 one-way against. Use ROADTYPE=3 for the ramp hard filter.",
  },
  {
    id: "pci_fy25",
    name: "DDOT Pavement Condition Index FY-25",
    url: `${DDOT}/PavementConditionIndex/MapServer/5`,
    year: 2025,
    crs: "EPSG:26985",
    count: 5741,
    maxRecordCount: 1000,
    fields: {
      ROUTEID: "LRS route id",
      FROMMEASURE: "start measure (m)",
      TOMEASURE: "end measure (m)",
      PCI: "pavement condition index, 0–100 (→ condition_rating)",
      PCICTEGORY: "Excellent / Good / Fair / Poor / Very Poor",
      SURFACE: "AC (asphalt) / PCC (concrete) / X",
      DATE1: "inspection date (range 2019-02 to 2026-03)",
      ROUTENAME: "street name",
      FROMSTREET: "cross street at start",
      TOSTREET: "cross street at end",
      WIDTH: "section width (m)",
      LANES: "lane count",
    },
    verifiedOn: "2026-11-24",
    notes:
      "Other years are layers 0–14 (FY-12..FY-24). 5,741 sections vs ~13.8k blocks, so coverage is partial; check overlap during join. CONST_DATE / LSTMJRWRKD were null in the sample. " +
      "2026-11-25: HPMSID, UNIQUEID, NETWORKID, BRANCHID are null for all 5,741 rows and SECTIONID is a per-route sequence ('001'...), so ROUTEID + measure overlap is the only join to blocks. " +
      "Ward 1: 447 sections (all AC/PCC, DATE1 2023-06..2026-03); 404 have both ends on block ends (<1 m); 451/874 blocks (55 of 110 km) covered, coverage is all-or-nothing per block.",
  },
  {
    id: "lrs_iri",
    name: "DDOT LRS — IRI (International Roughness Index)",
    url: `${DDOT}/DDOTLRS/MapServer/39`,
    crs: "EPSG:26985",
    count: 22412,
    maxRecordCount: 3000,
    fields: {
      ROUTEID: "LRS route id",
      FROMMEASURE: "start measure (m)",
      TOMEASURE: "end measure (m)",
      IRI: "roughness, integer; values ~100–400 suggest in/mi (unit not stated in metadata)",
      IRI_DATE: "survey date (2010-05 to 2020-01; mostly 2014, 2017, 2019)",
      VALUE_DATE: "2022-12-31 when set, else null",
      IRI_VALUE_TEXT: "text value",
      FROMDATE: "event start date",
      TODATE: "null for all rows",
    },
    verifiedOn: "2026-11-25",
    notes:
      "Newest IRI in DC open data (latest IRI_DATE 2020-01-01). Several survey years coexist with TODATE null, so take the latest IRI_DATE per interval. " +
      "Ward 1: 1,745 events; ~51% of block length covered, almost entirely the same blocks PCI FY-25 covers (only 11 null-PCI blocks gain IRI).",
  },
  {
    id: "pavement_iri_2014",
    name: "DDOT Pavement — IRI 2014 (legacy)",
    url: "https://maps2.dcgis.dc.gov/DCGIS/rest/services/DDOT/Pavement/MapServer/3",
    year: 2014,
    count: 14816,
    fields: { SSRSEGID: "street segment id", IRI: "roughness", Lane1: "per-lane IRI (Lane1..Lane10)", BikeLane1: "bike lane IRI (BikeLane1, BikeLane2)", Ward: "ward" },
    verifiedOn: "2026-11-25",
    notes: "Service holds only PCI 2012/2013/2014 (layers 0–2) and IRI 2014 (layer 3). Superseded by lrs_iri.",
  },
  {
    id: "lrs_year_last_improvement",
    name: "DDOT LRS — Year Last Improvement (HPMS)",
    url: `${DDOT}/DDOTLRS/MapServer/47`,
    crs: "EPSG:26985",
    count: 3951,
    maxRecordCount: 3000,
    fields: {
      ROUTEID: "LRS route id",
      FROMMEASURE: "start measure (m)",
      TOMEASURE: "end measure (m)",
      YEAR_LAST_IMPROV: "year of last surface improvement (year only)",
      FROMDATE: "event start date",
      TODATE: "event end date; null = current",
    },
    verifiedOn: "2026-11-24",
    notes: "Candidate paving-freshness signal (2024: 640, 2025: 525 sections). Year precision only; HPMS network, so local streets are probably sparse.",
  },
  {
    id: "lrs_surface_type",
    name: "DDOT LRS — Surface Type (HPMS)",
    url: `${DDOT}/DDOTLRS/MapServer/44`,
    crs: "EPSG:26985",
    count: 35263,
    maxRecordCount: 3000,
    fields: {
      ROUTEID: "LRS route id",
      FROMMEASURE: "start measure (m)",
      TOMEASURE: "end measure (m)",
      SURFACE_TYPE: "HPMS code: 1=Unpaved 2=Bituminous 3–5=PCC variants 6–8=AC overlays; also 0, 11–13 (see layer domain)",
      TODATE: "null = current",
    },
    verifiedOn: "2026-11-24",
    notes: "Code 0 is the most common value (12,589); look up its meaning in the full domain before mapping.",
  },
  {
    id: "lrs_aadt",
    name: "DDOT LRS — AADT",
    url: `${DDOT}/DDOTLRS/MapServer/24`,
    crs: "EPSG:26985",
    count: 107135,
    maxRecordCount: 3000,
    fields: {
      ROUTEID: "LRS route id",
      FROMMEASURE: "start measure (m)",
      TOMEASURE: "end measure (m)",
      AADT: "annual average daily traffic",
      AADT_YEAR: "count year (2014–2023)",
      TODATE: "null for all rows",
    },
    verifiedOn: "2026-11-24",
    notes: "Many count years coexist; pick the latest AADT_YEAR per interval. May supersede traffic_volume_2024.",
  },
  {
    id: "lrs_speed_limit",
    name: "DDOT LRS — Speed Limit",
    url: `${DDOT}/DDOTLRS/MapServer/18`,
    crs: "EPSG:26985",
    count: 16433,
    maxRecordCount: 3000,
    fields: {
      ROUTEID: "LRS route id",
      FROMMEASURE: "start measure (m)",
      TOMEASURE: "end measure (m)",
      SPEED_LIMIT: "mph",
      TODATE: "null = current",
    },
    verifiedOn: "2026-11-24",
  },
  {
    id: "lrs_stop_sign",
    name: "DDOT LRS — Stop Sign (HPMS)",
    url: `${DDOT}/DDOTLRS/MapServer/35`,
    crs: "EPSG:26985",
    count: 3166,
    maxRecordCount: 3000,
    fields: {
      ROUTEID: "LRS route id",
      FROMMEASURE: "start measure (m)",
      TOMEASURE: "end measure (m)",
      STOP_SIGNS: "count of stop signs on the section (0/1/2)",
    },
    verifiedOn: "2026-11-24",
    notes: "A per-section count on the HPMS network, not a control at each endpoint, so it is weak for bottom_control. Related layers: SignalType (34), NumberSignal (30).",
  },
  {
    id: "ward_2022",
    name: "DC Ward boundaries (2022)",
    url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries/MapServer/53",
    year: 2022,
    crs: "EPSG:26985",
    count: 8,
    maxRecordCount: 1000,
    fields: { WARD: "ward number 1–8 (SmallInteger)", NAME: "e.g. 'Ward 1'" },
    verifiedOn: "2026-11-25",
    notes: "Ward 1 extent (26985): x 395586–398947, y 138433–141150 (~3.4 × 2.7 km).",
  },
  {
    id: "dtm_2024",
    name: "DC OCTO 2024 LiDAR Hydro-Enforced DTM (1 m)",
    url: "https://imagery.dcgis.dc.gov/dcgis/rest/services/Lidar/Hydro_Enforced_DTM_2024/ImageServer",
    year: 2024,
    crs: "EPSG:2804",
    fields: {},
    verifiedOn: "2026-11-24",
    notes:
      "F32, NAVD88 m, 1 m. Native CRS EPSG:2804 (NAD83 HARN MD); request exportImage with imageSR=26985 so it aligns with DDOT data (a 26985 vs 2804 mix-up shifts ~0.9 m). maxImageWidth 15000, maxImageHeight 4100. Source tiles' nodata is -999999; exportImage uses the noData= you pass. getSamples silently truncates at 1000 points. See docs/research/steepness.md.",
  },
  {
    id: "dsm_2024",
    name: "DC OCTO 2024 LiDAR DSM (1 m)",
    url: "https://imagery.dcgis.dc.gov/dcgis/rest/services/Lidar/DSM_2024/ImageServer",
    year: 2024,
    crs: "EPSG:2804",
    fields: {},
    verifiedOn: "2026-11-24",
    notes: "Surface model; usable for bridge decks where the bare-earth DTM drops into the valley. Flattened over White House / Capitol redaction rectangles.",
  },
  {
    id: "lrs_bridge",
    name: "DDOT LRS — Bridge",
    url: `${DDOT}/DDOTLRS/MapServer/128`,
    crs: "EPSG:26985",
    count: 273,
    fields: { ROUTEID: "LRS route id", FROMMEASURE: "start (m)", TOMEASURE: "end (m)", BRKEY: "bridge key", BRIDGE_NAME: "name", BRIDGE_TYPE: "type", OWNERSHIP: "owner" },
    verifiedOn: "2026-11-24",
  },
  {
    id: "lrs_structure",
    name: "DDOT LRS — Structure",
    url: `${DDOT}/DDOTLRS/MapServer/16`,
    crs: "EPSG:26985",
    fields: { ROUTEID: "LRS route id", FROMMEASURE: "start (m)", TOMEASURE: "end (m)", STRUCTURE_TYPE: "1=bridge 2=tunnel 3=causeway" },
    verifiedOn: "2026-11-24",
  },
  {
    id: "traffic_volume_2024",
    name: "2024 Traffic Volume (AADT by roadway block)",
    url: "https://opendata.dc.gov/api/download/v1/items/948099175f3a44cca2d6a633cf3ec35a/geojson?layers=5",
    year: 2024,
    fields: {},
    notes: "Not yet audited. Compare against lrs_aadt.",
  },
];

export function getSource(id: string): DataSource {
  const s = sources.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown source "${id}" — add it to pipeline/src/sources.ts`);
  return s;
}
