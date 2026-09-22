"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StringKey } from "@/lib/i18n";
import { LAYERS } from "@/lib/layers";
import type {
  CameraKind,
  CameraPoint,
  LayerId,
  RoadConditionFeature,
  RoadConditionKind,
  RoadLayerId,
} from "@/lib/types";
import { useI18n } from "./i18n-provider";

const TILES = ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];

/** Optional custom MapLibre style URL; the standard OpenStreetMap tiles are the default. */
const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE;

/** Default and fallback style, so a failed custom style never leaves the map blank. */
const OSM_STYLE = {
  version: 8 as const,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    basemap: {
      type: "raster" as const,
      tiles: TILES,
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: "bg", type: "background" as const, paint: { "background-color": "#eeeae2" } },
    {
      id: "basemap",
      type: "raster" as const,
      source: "basemap",
    },
  ],
};

async function resolveStyle() {
  if (!MAP_STYLE_URL) return OSM_STYLE;
  try {
    const res = await fetch(MAP_STYLE_URL, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const style = await res.json();
      if (style?.version === 8 && style.layers?.length) return style;
    }
  } catch {
    /* offline / blocked — fall through to raster tiles */
  }
  return OSM_STYLE;
}

export const SG_CENTER: [number, number] = [103.8198, 1.3521];
export const SG_ZOOM = 11.4;

const KIND_SHAPES: Record<CameraKind, "dot" | "diamond" | "square"> = {
  redlight: "dot",
  fixed_speed: "diamond",
  expressway_speed: "diamond",
  laser_speed: "diamond",
  mobile_speed: "diamond",
  snapshot: "square",
};

const ROAD_LAYER_IDS: RoadLayerId[] = ["traffic-speed", "incidents", "hazards", "roadworks"];
const ROAD_POINT_LAYERS: RoadLayerId[] = ["incidents", "hazards", "roadworks"];
const ROAD_KINDS: Exclude<RoadConditionKind, "speed-band">[] = [
  "traffic-incident",
  "flood-alert",
  "faulty-traffic-light",
  "road-work",
  "road-opening",
];

const ROAD_COLOR_VAR: Record<RoadLayerId, string> = {
  "traffic-speed": "--c-traffic",
  incidents: "--c-incident",
  hazards: "--c-hazard",
  roadworks: "--c-roadworks",
};

function roadMarkerSvg(kind: Exclude<RoadConditionKind, "speed-band">, color: string) {
  const shape =
    kind === "traffic-incident"
      ? `<path d="M26 7 47 45H5Z" fill="${color}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M26 19v12" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="26" cy="38" r="2.5" fill="#fff"/>`
      : kind === "flood-alert"
        ? `<path d="M26 4 48 26 26 48 4 26Z" fill="${color}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M17 30c4 0 4-3 8-3s4 3 8 3 4-3 8-3" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M20 21c3-5 6-8 6-8s3 3 6 8a6 6 0 0 1-12 0Z" fill="#fff"/>`
        : kind === "faulty-traffic-light"
          ? `<path d="M26 4 48 26 26 48 4 26Z" fill="${color}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><rect x="20" y="13" width="12" height="26" rx="5" fill="#fff"/><circle cx="26" cy="20" r="3" fill="${color}"/><circle cx="26" cy="27" r="3" fill="${color}" opacity=".7"/><circle cx="26" cy="34" r="3" fill="${color}" opacity=".4"/>`
          : `<rect x="6" y="8" width="40" height="34" rx="7" fill="${color}" stroke="#fff" stroke-width="4"/><path d="M13 18h26M16 18l7 14M29 18l7 14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52">${shape}</svg>`;
}

/** Marker artwork is generated as SVG so it scales crisply and needs no assets. */
function markerSvg(kind: CameraKind, color: string, size = 2) {
  const s = 26 * size;
  const c = s / 2;
  const shape = KIND_SHAPES[kind];
  const body =
    shape === "dot"
      ? `<circle cx="${c}" cy="${c}" r="${c * 0.7}" fill="${color}" stroke="#fff" stroke-width="${s * 0.077}"/>
         <circle cx="${c}" cy="${c}" r="${s * 0.108}" fill="#fff"/>`
      : shape === "diamond"
        ? `<rect x="${c - s * 0.245}" y="${c - s * 0.245}" width="${s * 0.49}" height="${s * 0.49}"
             rx="${s * 0.07}" transform="rotate(45 ${c} ${c})" fill="${color}" stroke="#fff" stroke-width="${s * 0.077}"/>
           <circle cx="${c}" cy="${c}" r="${s * 0.088}" fill="#fff"/>`
        : `<rect x="${c - s * 0.27}" y="${c - s * 0.23}" width="${s * 0.54}" height="${s * 0.46}"
             rx="${s * 0.1}" fill="${color}" stroke="#fff" stroke-width="${s * 0.077}"/>
           <circle cx="${c}" cy="${c}" r="${s * 0.105}" fill="#fff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${body}</svg>`;
}

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** MapLibre paint properties need literal colours, so resolve `var(--x)` tokens. */
function resolveColor(value: string, fallback: string) {
  const name = /var\((--[\w-]+)\)/.exec(value)?.[1];
  return cssVar(name ?? value, fallback);
}

export interface MapFocus {
  lat: number;
  lng: number;
  key: string;
  zoom?: number;
  /** Right/bottom insets (px) so the target clears the floating panels. */
  padding?: { right?: number; bottom?: number };
}

export interface MapViewProps {
  points: CameraPoint[];
  active: Record<LayerId, boolean>;
  selectedId: string | null;
  onSelect: (point: CameraPoint | null) => void;
  roadFeatures: RoadConditionFeature[];
  roadActive: Record<RoadLayerId, boolean>;
  selectedRoadId: string | null;
  onRoadSelect: (feature: RoadConditionFeature | null) => void;
  focus: MapFocus | null;
  className?: string;
}

export default function MapView({
  points,
  active,
  selectedId,
  onSelect,
  roadFeatures,
  roadActive,
  selectedRoadId,
  onRoadSelect,
  focus,
  className,
}: MapViewProps) {
  const { t } = useI18n();
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const pointsById = useRef(new Map<string, CameraPoint>());
  const roadFeaturesById = useRef(new Map<string, RoadConditionFeature>());
  const iso = useRef({ onSelect, onRoadSelect, t, selectedId, selectedRoadId });
  const [ready, setReady] = useState(false);
  const pointsMap = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const roadFeatureMap = useMemo(
    () => new Map(roadFeatures.map((feature) => [feature.id, feature])),
    [roadFeatures],
  );

  // Map event handlers are registered once, so keep them pointed at current props.
  useEffect(() => {
    iso.current = { onSelect, onRoadSelect, t, selectedId, selectedRoadId };
    pointsById.current = pointsMap;
    roadFeaturesById.current = roadFeatureMap;
  }, [onSelect, onRoadSelect, t, selectedId, selectedRoadId, pointsMap, roadFeatureMap]);

  const colors = useMemo(() => {
    const resolved = new Map<LayerId, string>();
    for (const layer of LAYERS) resolved.set(layer.id, resolveColor(layer.color, "#17130f"));
    return resolved;
  }, []);

  const roadColors = useMemo(() => {
    const resolved = new Map<RoadLayerId, string>();
    for (const id of ROAD_LAYER_IDS) {
      resolved.set(id, cssVar(ROAD_COLOR_VAR[id], "#6b625b"));
    }
    return resolved;
  }, []);

  async function addSourcesAndLayers(mapInstance: MlMap) {
    const defs: { id: string; svg: string }[] = [];
    for (const kind of Object.keys(KIND_SHAPES) as CameraKind[]) {
      const layer = LAYERS.find((l) => l.kinds.includes(kind));
      defs.push({
        id: `mk-${kind}`,
        svg: markerSvg(kind, colors.get(layer?.id ?? "redlight") ?? "#17130f"),
      });
    }
    for (const kind of ROAD_KINDS) {
      const layer: RoadLayerId =
        kind === "traffic-incident"
          ? "incidents"
          : kind === "flood-alert" || kind === "faulty-traffic-light"
            ? "hazards"
            : "roadworks";
      defs.push({
        id: `road-mk-${kind}`,
        svg: roadMarkerSvg(kind, roadColors.get(layer) ?? "#6b625b"),
      });
    }
    await Promise.all(
      defs.map(
        (d) =>
          new Promise<void>((resolve) => {
            const img = new Image(52, 52);
            img.onload = () => {
              if (!mapInstance.hasImage(d.id)) mapInstance.addImage(d.id, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`;
          }),
      ),
    );

    const empty = { type: "FeatureCollection" as const, features: [] };
    const free = cssVar("--c-traffic-free", "#26815b");
    const moderate = cssVar("--c-traffic-moderate", "#b37a18");
    const heavy = cssVar("--c-traffic-heavy", "#c65b3e");
    const severe = cssVar("--c-traffic-severe", "#9f3340");
    const unknown = cssVar("--c-traffic-unknown", "#78857e");
    const speedColor: maplibregl.ExpressionSpecification = [
      "case",
      ["<=", ["coalesce", ["get", "speedBand"], 0], 0],
      unknown,
      ["<=", ["get", "speedBand"], 2],
      severe,
      ["<=", ["get", "speedBand"], 4],
      heavy,
      ["<=", ["get", "speedBand"], 6],
      moderate,
      free,
    ];

    // Speed links are deliberately dashed: LTA publishes only start/end
    // coordinates, so these are schematic indicators rather than road geometry.
    mapInstance.addSource("road-traffic-speed", { type: "geojson", data: empty });
    mapInstance.addLayer({
      id: "road-traffic-speed-casing",
      type: "line",
      source: "road-traffic-speed",
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.82,
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 16, 7],
      },
    });
    mapInstance.addLayer({
      id: "road-traffic-speed-line",
      type: "line",
      source: "road-traffic-speed",
      paint: {
        "line-color": speedColor,
        "line-opacity": 0.88,
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 16, 4],
        "line-dasharray": [2, 1.25],
      },
    });
    mapInstance.addLayer({
      id: "road-traffic-speed-hit",
      type: "line",
      source: "road-traffic-speed",
      paint: { "line-color": "#000000", "line-opacity": 0.01, "line-width": 14 },
    });

    for (const layer of LAYERS) {
        const lid = layer.id;
        const color = colors.get(lid) ?? "#17130f";
        mapInstance.addSource(lid, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterRadius: 46,
          clusterMaxZoom: 14,
        });
        mapInstance.addSource(`${lid}-selected`, { type: "geojson", data: empty });

        mapInstance.addLayer({
          id: `${lid}-halo`,
          type: "circle",
          source: lid,
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "live"], true]],
          paint: {
            "circle-radius": 15,
            "circle-color": color,
            "circle-opacity": 0.16,
            "circle-blur": 0.7,
          },
        });
        mapInstance.addLayer({
          id: `${lid}-clusters`,
          type: "circle",
          source: lid,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": color,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 3,
            "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 24, 200, 28],
            "circle-opacity": 0.92,
          },
        });
        mapInstance.addLayer({
          id: `${lid}-cluster-count`,
          type: "symbol",
          source: lid,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Open Sans Semibold"],
            "text-size": 12,
          },
          paint: { "text-color": "#ffffff" },
        });
        mapInstance.addLayer({
          id: `${lid}-points`,
          type: "symbol",
          source: lid,
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": ["concat", "mk-", ["get", "kind"]],
            "icon-size": 0.5,
            "icon-allow-overlap": true,
            "icon-anchor": "center",
          },
        });
        mapInstance.addLayer({
          id: `${lid}-hit`,
          type: "circle",
          source: lid,
          filter: ["!", ["has", "point_count"]],
          paint: { "circle-radius": 15, "circle-opacity": 0.01, "circle-color": "#000000" },
        });
        mapInstance.addLayer({
          id: `${lid}-sel`,
          type: "circle",
          source: `${lid}-selected`,
          paint: {
            "circle-radius": 17,
            "circle-color": "transparent",
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#17130f",
          },
        });

        const pointLayers = [`${lid}-hit`, `${lid}-points`];
        mapInstance.on("mouseenter", pointLayers, () => {
          mapInstance.getCanvas().style.cursor = "pointer";
        });
        mapInstance.on("mouseleave", pointLayers, () => {
          mapInstance.getCanvas().style.cursor = "";
          popup.current?.remove();
        });
        mapInstance.on("mousemove", pointLayers, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = pointsById.current.get(String(f.properties?.id));
          if (!p || p.id === iso.current.selectedId) return;
          const el = document.createElement("div");
          el.style.cssText = "padding:7px 10px;font-size:12px;line-height:1.3;max-width:230px";
          const kindEl = document.createElement("div");
          kindEl.style.cssText = "font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#857e74";
          kindEl.textContent = iso.current.t(`kind.${p.kind}` as StringKey);
          const nameEl = document.createElement("div");
          nameEl.style.cssText = "font-weight:600;margin-top:2px";
          nameEl.textContent = p.road || `#${p.ref}`;
          el.append(kindEl, nameEl);
          popup.current?.remove();
          popup.current = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 16,
            maxWidth: "260px",
          })
            .setLngLat([p.lng, p.lat])
            .setDOMContent(el)
            .addTo(mapInstance);
        });
        mapInstance.on("click", pointLayers, (e) => {
          const f = e.features?.[0];
          const p = f && pointsById.current.get(String(f.properties?.id));
          if (p) {
            popup.current?.remove();
            iso.current.onRoadSelect(null);
            iso.current.onSelect(p);
          }
        });
        mapInstance.on("click", `${lid}-clusters`, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const src = mapInstance.getSource(lid) as maplibregl.GeoJSONSource;
          const id = f.properties?.cluster_id as number;
          src.getClusterExpansionZoom(id).then((zoom) => {
            mapInstance.easeTo({
              center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
              zoom,
              duration: 450,
            });
          });
        });
        mapInstance.on("mouseenter", `${lid}-clusters`, () => {
          mapInstance.getCanvas().style.cursor = "pointer";
        });
        mapInstance.on("mouseleave", `${lid}-clusters`, () => {
          mapInstance.getCanvas().style.cursor = "";
        });
    }

    for (const id of ROAD_POINT_LAYERS) {
      const source = `road-${id}`;
      mapInstance.addSource(source, { type: "geojson", data: empty });
      mapInstance.addLayer({
        id: `${source}-points`,
        type: "symbol",
        source,
        layout: {
          "icon-image": ["concat", "road-mk-", ["get", "kind"]],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.52, 16, 0.72],
          "icon-allow-overlap": false,
          "icon-anchor": "center",
        },
      });
      mapInstance.addLayer({
        id: `${source}-hit`,
        type: "circle",
        source,
        paint: { "circle-radius": 17, "circle-opacity": 0.01, "circle-color": "#000000" },
      });
    }

    mapInstance.addSource("road-selected", { type: "geojson", data: empty });
    mapInstance.addLayer({
      id: "road-selected-line",
      type: "line",
      source: "road-selected",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#17130f",
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 5, 16, 8],
        "line-opacity": 0.78,
        "line-dasharray": [2, 1.25],
      },
    });
    mapInstance.addLayer({
      id: "road-selected-point",
      type: "circle",
      source: "road-selected",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 18,
        "circle-color": "transparent",
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#17130f",
      },
    });

    const roadPointInteractive = ROAD_POINT_LAYERS.flatMap((id) => [
      `road-${id}-hit`,
      `road-${id}-points`,
    ]);
    const roadInteractive = ["road-traffic-speed-hit", ...roadPointInteractive];
    const cameraInteractive = LAYERS.flatMap((layer) => [
      `${layer.id}-hit`,
      `${layer.id}-points`,
      `${layer.id}-clusters`,
    ]);

    const showRoadPopup = (event: maplibregl.MapLayerMouseEvent) => {
      const rendered = event.features?.[0];
      const feature = rendered && roadFeaturesById.current.get(String(rendered.properties?.id));
      if (!feature || feature.id === iso.current.selectedRoadId) return;
      const el = document.createElement("div");
      el.style.cssText = "padding:7px 10px;font-size:12px;line-height:1.3;max-width:250px";
      const kind = document.createElement("div");
      kind.style.cssText = "font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#63736b";
      kind.textContent = iso.current.t(`road.kind.${feature.properties.kind}` as StringKey);
      const title = document.createElement("div");
      title.style.cssText = "font-weight:600;margin-top:2px";
      title.textContent = feature.properties.title;
      el.append(kind, title);
      popup.current?.remove();
      popup.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 16,
        maxWidth: "270px",
      })
        .setLngLat(event.lngLat)
        .setDOMContent(el)
        .addTo(mapInstance);
    };

    mapInstance.on("mouseenter", roadInteractive, () => {
      mapInstance.getCanvas().style.cursor = "pointer";
    });
    mapInstance.on("mouseleave", roadInteractive, () => {
      mapInstance.getCanvas().style.cursor = "";
      popup.current?.remove();
    });
    mapInstance.on("mousemove", roadInteractive, showRoadPopup);
    mapInstance.on("click", roadInteractive, (event) => {
      // Camera points are more precise than the wide schematic speed hit area.
      if (mapInstance.queryRenderedFeatures(event.point, { layers: cameraInteractive }).length > 0) return;
      const rendered = event.features?.[0];
      const feature = rendered && roadFeaturesById.current.get(String(rendered.properties?.id));
      if (feature) {
        popup.current?.remove();
        iso.current.onSelect(null);
        iso.current.onRoadSelect(feature);
      }
    });

    mapInstance.on("click", (event) => {
      const hits = mapInstance.queryRenderedFeatures(event.point, {
        layers: [...cameraInteractive, ...roadInteractive],
      });
      if (hits.length === 0) {
        iso.current.onSelect(null);
        iso.current.onRoadSelect(null);
      }
    });

    mapInstance.on("error", () => {
      /* tile/network errors are surfaced through the layer status, not console spam */
    });

    setReady(true);
  }

  /* ---------------- map lifecycle ---------------- */
  useEffect(() => {
    const container = holder.current;
    if (!container || map.current) return;
    let cancelled = false;
    const resizeObserver = new ResizeObserver(() => map.current?.resize());
    resizeObserver.observe(container);

    void (async () => {
      const style = await resolveStyle();
      if (cancelled || map.current) return;
      const mapInstance = new maplibregl.Map({
        container,
        center: SG_CENTER,
        zoom: SG_ZOOM,
        minZoom: 9,
        maxZoom: 18,
        attributionControl: { compact: true },
        style,
      });
      map.current = mapInstance;
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __map?: MlMap }).__map = mapInstance;
      }

      mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      mapInstance.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: false,
          showAccuracyCircle: true,
        }),
        "bottom-right",
      );

      mapInstance.on("load", () => void addSourcesAndLayers(mapInstance));
    })();

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      popup.current?.remove();
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot map setup; colours resolve once per mount
  }, []);

  /* ---------------- data ---------------- */
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !ready) return;
    // Display-only spread: the sources publish two cameras at one gantry when
    // each direction is enforced separately, so nudge the repeats of an exact
    // coordinate onto a tiny ring (~5 m) to keep every record selectable.
    const repeats = new Map<string, number>();
    for (const layer of LAYERS) {
      const src = mapInstance.getSource(layer.id) as maplibregl.GeoJSONSource | undefined;
      if (!src) continue;
      src.setData({
        type: "FeatureCollection",
        features: points
          .filter((p) => p.layer === layer.id)
          .map((p) => {
            const key = `${p.lat}|${p.lng}`;
            const nth = repeats.get(key) ?? 0;
            repeats.set(key, nth + 1);
            const angle = (nth * 2 * Math.PI) / 6;
            const r = nth ? 0.000045 : 0;
            return {
              type: "Feature" as const,
              geometry: {
                type: "Point" as const,
                coordinates: [p.lng + r * Math.sin(angle), p.lat + r * Math.cos(angle)],
              },
              properties: { id: p.id, kind: p.kind, road: p.road, live: p.live === true },
            };
          }),
      });
    }
  }, [points, ready]);

  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !ready) return;
    for (const layer of ROAD_LAYER_IDS) {
      const source = mapInstance.getSource(`road-${layer}`) as maplibregl.GeoJSONSource | undefined;
      if (!source) continue;
      source.setData({
        type: "FeatureCollection",
        features: roadFeatures
          .filter((feature) => feature.properties.layer === layer && feature.geometry !== null)
          .map((feature) => ({
            type: "Feature" as const,
            id: feature.id,
            geometry: feature.geometry!,
            properties: { ...feature.properties, id: feature.id },
          })),
      });
    }
  }, [roadFeatures, ready]);

  /* ---------------- layer visibility ---------------- */
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !ready) return;
    for (const layer of LAYERS) {
      const visible = active[layer.id] ? "visible" : "none";
      for (const suffix of ["halo", "clusters", "cluster-count", "points", "hit", "sel"]) {
        const id = `${layer.id}-${suffix}`;
        if (mapInstance.getLayer(id)) mapInstance.setLayoutProperty(id, "visibility", visible);
      }
    }
  }, [active, ready]);

  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !ready) return;
    for (const layer of ROAD_LAYER_IDS) {
      const visible = roadActive[layer] ? "visible" : "none";
      const layerIds =
        layer === "traffic-speed"
          ? [
              "road-traffic-speed-casing",
              "road-traffic-speed-line",
              "road-traffic-speed-hit",
            ]
          : [`road-${layer}-points`, `road-${layer}-hit`];
      for (const id of layerIds) {
        if (mapInstance.getLayer(id)) mapInstance.setLayoutProperty(id, "visibility", visible);
      }
    }
  }, [roadActive, ready]);

  /* ---------------- selection ---------------- */
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !ready) return;
    for (const layer of LAYERS) {
      const src = mapInstance.getSource(`${layer.id}-selected`) as maplibregl.GeoJSONSource | undefined;
      if (!src) continue;
      const p = selectedId ? pointsMap.get(selectedId) : undefined;
      src.setData({
        type: "FeatureCollection",
        features:
          p && p.layer === layer.id
            ? [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [p.lng, p.lat] },
                  properties: {},
                },
              ]
            : [],
      });
    }
  }, [selectedId, pointsMap, ready]);

  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !ready) return;
    const source = mapInstance.getSource("road-selected") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const feature = selectedRoadId ? roadFeatureMap.get(selectedRoadId) : undefined;
    source.setData({
      type: "FeatureCollection",
      features:
        feature?.geometry && roadActive[feature.properties.layer]
          ? [
              {
                type: "Feature",
                id: feature.id,
                geometry: feature.geometry,
                properties: { ...feature.properties, id: feature.id },
              },
            ]
          : [],
    });
  }, [selectedRoadId, roadFeatureMap, roadActive, ready]);

  /* ---------------- fly to ---------------- */
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !ready || !focus) return;
    mapInstance.flyTo({
      center: [focus.lng, focus.lat],
      zoom: focus.zoom ?? 16.5,
      speed: 1.3,
      padding: {
        top: 40,
        right: focus.padding?.right ?? 0,
        bottom: focus.padding?.bottom ?? 0,
        left: 40,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, ready]);

  return (
    <div
      ref={holder}
      className={className}
      role="application"
      aria-label={t("a11y.map")}
      data-testid="map"
    />
  );
}
