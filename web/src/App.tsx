import { useEffect, useRef, useState } from "react";
import { Map as MlMap, NavigationControl, Popup, type LngLatBoundsLike, type MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import mapConfig from "../../config/map.json";
import { legend, modeStyle, MODES, type Mode } from "./layers";
import { popupContent, type SegmentProps } from "./popup";

const DATA_URL = "/data/segments.geojson";
const SOURCE = "segments";
const MAIN = "segments-main";
const MISSING = "segments-missing";

function bounds(fc: FeatureCollection<LineString>): LngLatBoundsLike {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of fc.features)
    for (const [x, y] of f.geometry.coordinates) {
      minX = Math.min(minX, x!);
      minY = Math.min(minY, y!);
      maxX = Math.max(maxX, x!);
      maxY = Math.max(maxY, y!);
    }
  return [minX, minY, maxX, maxY];
}

function applyMode(map: MlMap, mode: Mode) {
  const s = modeStyle(mode);
  map.setFilter(MAIN, s.filter);
  map.setPaintProperty(MAIN, "line-color", s.color);
  map.setPaintProperty(MAIN, "line-width", s.width);
  map.setPaintProperty(MAIN, "line-opacity", s.opacity);
  map.setFilter(MISSING, s.missingFilter);
}

export function App() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [mode, setMode] = useState<Mode>("score");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ area?: string; count: number } | null>(null);

  useEffect(() => {
    const map = new MlMap({
      container: container.current!,
      style: mapConfig.basemapStyle,
      center: [-77.03, 38.925],
      zoom: 14,
      attributionControl: { customAttribution: mapConfig.basemapAttribution },
    });
    mapRef.current = map;
    // Dev-only handle for debugging and browser smoke tests.
    if (import.meta.env.DEV) (window as unknown as { __map?: MlMap }).__map = map;
    map.addControl(new NavigationControl(), "top-right");

    map.on("load", async () => {
      try {
        const res = await fetch(DATA_URL);
        if (!res.ok) throw new Error(`${DATA_URL}: HTTP ${res.status}. Run \`npm run pipeline\` first.`);
        const fc = (await res.json()) as FeatureCollection<LineString> & { metadata?: { area?: string } };
        setMeta({ area: fc.metadata?.area, count: fc.features.length });

        map.addSource(SOURCE, { type: "geojson", data: fc });
        const initial = modeStyle("score");
        map.addLayer({
          id: MISSING,
          type: "line",
          source: SOURCE,
          filter: initial.missingFilter,
          layout: { "line-cap": "butt" },
          paint: { "line-color": mapConfig.nullColor, "line-width": mapConfig.lineWidth - 1, "line-dasharray": [2, 1.5] },
        });
        map.addLayer({
          id: MAIN,
          type: "line",
          source: SOURCE,
          filter: initial.filter,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": initial.color, "line-width": initial.width, "line-opacity": initial.opacity },
        });
        map.fitBounds(bounds(fc), { padding: 40, duration: 0 });

        for (const layer of [MAIN, MISSING]) {
          map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
          map.on("click", layer, (e: MapLayerMouseEvent) => {
            const f = e.features?.[0];
            if (!f) return;
            new Popup({ maxWidth: "320px" })
              .setLngLat(e.lngLat)
              .setDOMContent(popupContent(f.properties as unknown as SegmentProps))
              .addTo(map);
          });
        }
        setReady(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map?.getSource(SOURCE)) applyMode(map, mode);
  }, [mode, ready]);

  const lg = legend(mode);

  return (
    <div className="app">
      <div ref={container} className="map" />

      <div className="panel">
        <div className="title">
          DC Surfskate <span className="muted">{meta?.area ?? ""}</span>
        </div>
        <div className="toggle" role="tablist">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="legend">
          <div className="legend-title">{lg.title}</div>
          {lg.items.map((it) => (
            <div key={it.label} className="legend-row">
              <span className={`swatch${it.dashed ? " dashed" : ""}`} style={{ ["--c" as string]: it.color }} />
              {it.label}
            </div>
          ))}
          {lg.note && <div className="muted small">{lg.note}</div>}
        </div>
        {meta && <div className="muted small">{meta.count} street segments. Click one for details.</div>}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="footer">Data: DDOT PCI FY-25, DC OCTO 2024 LiDAR. Estimates only — check streets in person.</div>
    </div>
  );
}
