# Street grade for DC: data sources and block matching

Research for the pipeline's `grade` stage. Probed on 2026-11-24 with `curl` (User-Agent `dc-surfskate/0.1`). Raw downloads and test outputs were kept locally and are not committed.

Labels used below: **[V]** means I checked it with a request. **[I]** means I inferred it or took it from documentation I did not fetch.

---

## Summary and recommendation

1. **Source:** use the DC OCTO **2024 Hydro-Enforced DTM** ImageServer at `https://imagery.dcgis.dc.gov/dcgis/rest/services/Lidar/Hydro_Enforced_DTM_2024/ImageServer`. It is 1 m, Float32, NAVD88 meters, flown 2024-03-01 [V]. The service has the **Download** capability, so the 336 source GeoTIFF tiles (800 × 800 m, about 580 MB in total) can be pulled directly with no email request [V]. The README line saying "GeoTIFFs may require emailing open.data@dc.gov" is out of date.
2. **Sampling method:** bulk-download the tiles once into `/data/dtm2024/` and sample them locally with `geotiff` (bilinear). Fetch the block geometry with `outSR=2804` so it is in the raster's CRS. Keep the server's `getSamples` for prototyping and spot checks. It is fast (about 0.3–0.5 s per call) and the full network needs only about 400 calls, but it **silently truncates at 1000 points** per call [V]. That trap, plus running offline while we tune parameters, is why local tiles win.
3. **Bridges are the big problem.** The bare-earth DTM drops about 39 m under the Duke Ellington Bridge (Calvert St NW) [V]. Use the DDOT LRS **Bridge** layer (`DDOTLRS/MapServer/128`, 273 rows) and **Structure** layer (`/16`, where `STRUCTURE_TYPE` 1 = bridge, 2 = tunnel). Both are keyed by ROUTEID plus measures, so they join to blocks by interval, the same way as the other DDOT layers. Inside a bridge interval, sample **DSM_2024** instead. It returned a clean deck profile with std 0.79 vs 66 from the DTM [V]. Treat tunnel intervals as missing elevation.
4. **Redaction:** for 2024 (and 2022), the Secret Service redaction **kept ground points**. The DTM has values at the White House, Capitol and EEOB, and the only nodata in the federal core is outside the DC boundary [V]. The redaction instead flattens the **DSM/nDSM** over rectangles at the White House and Capitol. The 2018 DTM *does* have nodata holes there [V]. Detect nodata anyway (rule 8), and do not use the DSM for bridge fixes inside the redaction rectangles.
5. **Statistics:** sample each block once at about 5 m and derive both directions by reversing the arrays. `grade_mean` = least-squares slope over the raw samples. `grade_last20m` = slope over the last 20 m in the direction of travel. `grade_std` = std of 10 m local grades. Do **not** compute the mean from moving-average-smoothed endpoints: in my first pass that understated a 4.36% block as 3.73% [V].
6. **Cross-check:** results repeat across the 2018, 2020, 2022 and 2024 DTMs to within ±0.05 percentage points on `grade_mean` [V]. The HPMS GradesA–F layers work only as a coarse, class-level sanity check. Their units are mixed (miles in some vintages, meters in others) and several vintages overlap, all marked current [V].

---

## 1. DC DTM/DEM services

### Service roots [V]
- `https://imagery.dcgis.dc.gov/dcgis/rest/services/Lidar?f=json` lists these ImageServers:
  - `Hydro_Enforced_DTM_2018/2020/2022/2024`
  - `DSM_2018/2020/2022/2024`
  - `nDSM_2018/2020/2022/2024`
  - `Classified_LAS_2018/2020/2022/2024`
  - `Intensity_2022/2024`
  - `Bare_Earth_2004/2008/2015`
  - `First_Return_2004`, `Last_Return_2008`
- `maps2.dcgis.dc.gov/.../DCGIS_DATA/Hydro_Enforced_DTM[_2018][_WebMercator]` are **MapServers** that only render the DTM, not ImageServers. Skip them.
- Open Data DC hub items [V]: 2024 DTM `c35d84d84da74a05950892f4c14f8006`, 2022 `a3df757343be4561a9aa614c51171761`, 2020 `2b405ae2b62b4848aa4ac437d7be8511`, 2018 `288c927005c84e768a57b0212c2700a6`. The item metadata gives the 2024 flight date (single lift, 2024-03-01), says "USGS QL1", and includes the redaction statement quoted in section 4.

### Hydro_Enforced_DTM_2024 properties [V]

| Property | Value |
|---|---|
| Pixel | 1 m, F32, 1 band, bilinear by default |
| Extent | x 389400–408600, y 124200–148200 (19.2 × 24 km) |
| CRS | wkid 102285 / **EPSG:2804 (NAD83(HARN) / Maryland, m)**, vertical EPSG:5703 NAVD88, meters. Not 26985. |
| Value range | −10.13 to 130.87 m |
| NoData | Not in the service JSON. Source tiles: **−999999** (GDAL tag). exportImage uses whatever `noData=` you pass. getSamples **omits** nodata points from `samples[]`. |
| Capabilities | `Image,Metadata,Catalog,Download`. Mensuration is off. |
| Limits | maxImageWidth 15000, maxImageHeight 4100, maxDownloadImageCount 20, maxRecordCount 1000 |
| Catalog | Mosaic dataset with **336** tiles, each 800 × 800 m (for example `Name=1820`, OBJECTID 72) |
| Source file | `.\Lidar_2024\DTM\1820.tif`: 800 × 800, origin (395000, 140200), EPSG:2804 + 5703, 1.9 MB |

The 2018, 2020 and 2022 DTMs have the same tiling, extent and capabilities. 2022 also allows Mensuration and up to 100 downloads per request. `Bare_Earth_2015` is 0.6096 m (2 ft) in EPSG:26985 with no Download capability. `Bare_Earth_2008` is 1 m in 26985 [V].

### Operations tested [V]
- **getSamples, multipoint, `returnFirstValueOnly=true`:** 54 points along the Duke Ellington Bridge and 62 points along Calvert St (Shoreham Dr to 28th St). All values came back, as strings like `"45.458000183"`, each with `locationId` and `rasterId`. A call takes about 0.27–0.46 s.
  - **Truncation:** requests with 1000, 1500 and 3000 points all returned exactly **1000** samples with no error.
- **getSamples, polyline + `sampleDistance=5`:** works. A 302.5 m block returned 64 samples.
- **identify:** works and returns the pixel value. The location is echoed back in 2804.
- **exportImage** `format=tiff&pixelType=F32&noData=-9999`: returned a valid GeoTIFF. A 1000 × 800 clip near the White House was 3.7 MB. The output CRS follows `imageSR` (I used 26985). Covering all of DC at 1 m would take at least 12 exports of up to 15000 × 4100 pixels (about 246 MB each), so tile download is the better bulk path.
- **download / file:** `.../download?rasterIds=72&f=json` lists the `.tif`, `.tif.ovr` and `.aux.xml` files. Then `.../file?id=.\Lidar_2024\DTM\1820.tif&rasterId=72` returns the GeoTIFF with HTTP 200.
  - Listing in batches of 20 IDs summed to 553 MB for 320 tiles, so roughly **580 MB for all 336**.
  - IDs past 336 return error 400.

### CRS gotcha [V]
Requesting the same block vertex with `outSR=26985` and `outSR=2804` gives coordinates about **0.89 m** apart (dx −0.20, dy +0.87), because ArcGIS applies a NAD83 → HARN transformation. For local sampling, fetch blocks with `outSR=2804` so they line up with the tiles. A uniform sub-meter shift barely changes grade, but it does matter at curb lines and bridge edges.

---

## 2. Alternatives

| Source | Resolution / vintage | Access | Verdict |
|---|---|---|---|
| **DC OCTO 2024 DTM** (above) | 1 m, March 2024, QL1 | ImageServer plus raw tile download, no key | **Primary** |
| DC OCTO 2018/2020/2022 DTM | 1 m | Same services | Cross-check. Grades match 2024 to within 0.05 percentage points [V]. |
| **NOAA Digital Coast** (AWS bucket `noaa-nos-coastal-lidar-pds`) | `dem/DC_WashDC_DEM_2022_9838/DTM_2022_1m.tif` (590 MB) and `dem/DC_WashDC_DEM_2020_9491/DTM.tif` (588 MB), each a single **cloud-optimized GeoTIFF** with a VRT and STAC [V] | Anonymous HTTPS/S3 | Good mirror for 2020/2022, but **no 2024** copy is listed [V]. The 2022 metadata gives 0.052 m RMSEz and the same redaction text [V]. |
| **USGS 3DEP dynamic ImageServer** `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer` | Mosaic. For DC it served **MD_VA_Sandy_NCR_2014** 1 m (rasterId 65598) [V] | getSamples works, but took **7 s** for 62 points [V]. Native CRS 3857. maxRecordCount 2000 [V]. Rate limits not documented [I]. | Older and slower. Use only as a fallback. Calvert profile matched DC 2024 to within about 5 cm [V]. |
| **3DEP 1 m staged tiles** (TNM Access API `tnmaccess.nationalmap.gov/api/v1/products`) | 10 km UTM tiles, for example `USGS_one_meter_x32y432_MD_VA_Sandy_NCR_2014.tif` (2014) and `MD_Central_Processing_D24` (pub 2026-04-04) [V] | S3 download, 17–480 MB per tile [V] | No advantage over the DC tiles. I did not check whether D24 fully covers DC. |

---

## 3. DDOT GradesA–F (DDOTLRS/MapServer/54–59)

- **Fields [V]:** `ROUTEID`, `FROMMEASURE`, `TOMEASURE`, `FROMDATE`, `TODATE`, and `GRADES_A` … `GRADES_F` (Double). GradesA has 22,380 rows and GradesF has 22,368. **Every row has `TODATE` null**, but `FROMDATE` vintages from 2014-01-01 (7,317 rows) and 2017-01-01 (6,393) through 2026 all coexist and overlap on the same route [V].
- **Meaning [I], from the FHWA HPMS Field Manual, not fetched:** each value is the length of the section that falls in one grade class:
  - A: 0.0–0.4%
  - B: 0.5–2.4%
  - C: 2.5–4.4%
  - D: 4.5–6.4%
  - E: 6.5–8.4%
  - F: ≥ 8.5%

  The classes use absolute grade with no direction, and cover only the HPMS sample network.
- **Units are mixed [V, empirical].** On Calvert St (ROUTEID 11020022), the A–F values for the 2014 rows sum to the section length in **miles** (for example 0.162 for a 263 m / 0.163 mi section). For the 2017/2019 rows they sum to the length in **meters** (for example 131.48 for 131.5 m). To normalize, set `unit = |Σ − len_mi| < |Σ − len_m| ? mi : m`.
- **Usefulness:** only as a coarse check.
  - 39th St → 39th Pl NW: DTM mean 4.36%. The 2017 rows say mostly D (60.8 of 74.3 m); the 2014 rows say mostly C. Both are within one class.
  - 40th St → 40th Pl: DTM 2.80%; the 2017 rows say C 49.8 m / D 35.6 m.
  - The Duke Ellington Bridge interval reads A/B, which matches the deck and not the DTM valley. So HPMS can help flag bridge errors.
  - Don't use these layers as an input to scoring.

---

## 4. Matching method (recommended `grade` stage)

**Inputs:** RoadwayBlocks/2 (13,833 blocks; total length **1,899 km**, mean 137 m, max 8,063 m [V]), DIRECTIONALITY from LRSSupport/3, bridge and tunnel intervals from DDOTLRS/128 and /16.

**Step 1: tiles.** Query the catalog (`/query?where=1=1&returnGeometry=true`) to get the 336 tile footprints. Download each `.tif` through `download` → `file`, and cache it in `/data/dtm2024/`.
- For bridges, download only the `DSM_2024` tiles that intersect bridge intervals. Its tiles have the same layout and also allow Download [V].
- Record the dataset URL, year and nodata value in `sources.ts`.

**Step 2: geometry.** Page through the blocks with `outSR=2804&returnM=true` (1000 per page, so 14 requests). The M values equal the LRS measure, and the first vertex's M equals `FromMeasure` [V]. Densify each path every 5 m and always include both endpoints. That is about 394k points in total. Sample once per block, not once per direction.

**Step 3: sampling.** Bilinear-sample the tile that contains each point; points near tile edges need the neighboring tile.
- A sample is **nodata** if it is −999999, NaN, or below −50 (configurable), or (via getSamples) if its point is missing from the response.
- Per rule 8, never interpolate across gaps. If more than X% of samples are nodata, or any gap is longer than Y m, hard-filter the block with reason `missing_elevation`. X and Y go in `config/scoring.json`.

**Step 4: bridges and tunnels.**
- For each block, intersect `[FromMeasure, ToMeasure]` with the bridge intervals (`/128` rows, plus `/16` rows with `STRUCTURE_TYPE=1`). The Duke Ellington Bridge is 419.8–584.2 on route 11020022; the DTM valley in the block starting at 355.9 runs from about 421 to 584 [V].
- Replace the DTM samples in those stretches with DSM samples, using a 5-point median to suppress vehicles and light poles. Set `grade_source: "dtm" | "dtm+dsm_bridge"`.
- Tunnel intervals (`STRUCTURE_TYPE=2`, 12 rows [V]) and 55 rows with a null `STRUCTURE_TYPE` [V] go to the debug output.
- A backup source for bridge geometry is DCGIS `Transportation_WebMercator/MapServer/133` (Bridge Lines, 352 rows) [V].

**Step 5: hydro-enforcement and spikes [I].** A hydro-enforced DTM cuts breaklines through road fill at culverts, which produces narrow trenches. Flag any 10 m local grade above about 15%, and any pair of opposite-sign jumps within 15 m.
- DC publishes hydro breaklines at `DCGIS_DATA/Elevation_WebMercator/MapServer/12` (3,265 rows) and `/13` (2018, 401 rows) [V]. Use them to confirm a spike and mask it.

**Step 6: crown and curb.** The centerline sits on the crown. A cross-slope of about 2% means 1 m of lateral error gives about 2 cm of elevation error, which is negligible for grade [I]. Do not offset the line. The DTM has vehicles removed. Intersection plateaus are real, so leave them in.

**Step 7: statistics per block** (A→B = digitizing direction; + = downhill):
- `grade_mean_AB = −100 × OLS slope(z vs. distance)` over all valid raw samples.
- `grade_last20m_AB = −100 × OLS slope` over samples with distance ≥ L − 20.
- `grade_std` = std of 10 m central-difference grades, computed after a 3-point median. It has the same value in both directions.
- For B→A: `grade_mean_BA = −grade_mean_AB`, and `grade_last20m_BA = +100 × OLS slope` over distance ≤ 20.
- Emit AB only when DIRECTIONALITY = 0, BA only when it is 1, and both when it is 2.
- Any smoothing windows go in config. **Pitfall [V]:** a 5-point moving mean shrinks to fewer points at the ends, which pulls the endpoint elevations inward and biased the mean down by about 15%.

**Step 8: validation.** Test results from the 2024 DTM via getSamples, at 5 m spacing [V]:

| Block (Calvert St NW) | Length | Mean A→B | Last 20 m A→B | Last 20 m B→A | Std |
|---|---|---|---|---|---|
| 39th St → 39th Pl | 74 m | +4.36% | +4.50% | −4.26% | 0.26 |
| 39th Pl → 40th St | 75 m | +4.36% | +4.09% | −4.26% | 0.32 |
| 40th St → 40th Pl | 85 m | +2.80% | +2.74% | −3.04% | 0.27 |
| 24th St/Shoreham → 28th St | 303 m | +2.48% | +0.12% | −2.58% | 0.66 |
| Biltmore → Woodley (bridge), DTM | 263 m | +1.86% (wrong) | — | — | **66.2** |
| Same block, DSM over bridge | 263 m | +0.01% | −0.56% | −2.58% | 0.79 |

In the A→B column, + means downhill. In the B→A column, − means the last 20 m is uphill in that direction.

Comparing vintages: 2018, 2020 and 2022 gave a mean of 4.31–4.34% on the 39th St block and 2.47% on the Shoreham block. `last20` varies by about ±0.4 percentage points between vintages, so treat it as the noisier statistic.

Before tuning, add 5–10 hand-checked hills to `/labels`, for example from local skater knowledge or a phone inclinometer. I did not find an authoritative list of DC street grades.

**Request budget:**
- Tiles path: 17 listing calls + 336 file downloads (about 580 MB) + about 14 block pages.
- getSamples path: about 400 calls. Pack several blocks into each 1000-point multipoint and split blocks longer than 5 km. That takes about 3 minutes sequentially.

Both budgets are tiny. Choose tiles because they are deterministic and avoid the truncation trap.

---

## 5. Risks and open questions

- **Silent truncation at 1000 points** in getSamples [V]. If we use it, check that `samples.length` equals the number of points sent.
- **Redaction zones in 2024:** the DTM is populated [V], but nobody has said whether ground density inside the Secret Service boundary is lower. No published redaction-boundary layer turned up in a hub search for "lidar redaction" [V]. For now, keep a hand-drawn polygon for the White House and Capitol rectangles in config and set `elev_redaction_zone: true` (traced from flat nDSM: about x 396600–397040 / y 136520–136920 and x 398680–399680 / y 135320–136280 in 26985 [V, approximate]).
- **Vertical accuracy:** QL1 (2024, stated [V]) and 0.052 m RMSEz (2022 [V]). Over a 20 m window, ±5 cm of noise is about ±0.35% of grade, which is consistent with the `last20` variation between vintages. Consider requiring at least 30 m for `last20`, or flag it as low-confidence on short blocks.
- **DSM bridge fix:** traffic, trees or sign gantries on the deck could still add noise. Bridge decks inside the redaction rectangles are flattened in the DSM (untested whether any exist).
- **Overpasses with streets underneath:** the DTM gives the lower road correctly [I]. Freeway blocks are hard-filtered anyway.
- **Block geometry:** some blocks are very long (max 8 km, probably freeways). Per-block request packing has to handle them.
- **HPMS grade class bounds** come from the FHWA manual and were not verified against a DDOT document.
- **Not tested:** 3DEP rate limits, full coverage of the 3DEP `MD_Central_Processing_D24` project over DC, and whether `Classified_LAS_2024` exposes LAS downloads that would be useful for bridge points.
- **Datum:** the DC DTM uses EPSG:2804. If the pipeline ever samples in 26985 coordinates with no transform, it inherits the 0.9 m shift [V].

### Suggested `sources.ts` additions (not applied)
- `dtm_2024`: `https://imagery.dcgis.dc.gov/dcgis/rest/services/Lidar/Hydro_Enforced_DTM_2024/ImageServer`, year 2024, CRS EPSG:2804 + EPSG:5703 (m), 336 tiles, nodata −999999.
- `dsm_2024`: same host, `Lidar/DSM_2024/ImageServer`.
- `lrs_bridge`: `DDOTLRS/MapServer/128` (`BRKEY`, `BRIDGE_NAME`, `BRIDGE_TYPE`, `OWNERSHIP`).
- `lrs_structure`: `DDOTLRS/MapServer/16` (`STRUCTURE_TYPE` 1 = bridge, 2 = tunnel, 3 = causeway).
- `lrs_grades_a…f`: `DDOTLRS/MapServer/54–59`. Mixed units; validation only.
