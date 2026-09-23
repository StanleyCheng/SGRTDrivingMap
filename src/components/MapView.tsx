"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StringKey } from "@/lib/i18n";
import { LAYERS, ROAD_LAYER_COLOR, ROAD_LAYER_ORDER } from "@/lib/layers";
import type {
  CameraKind,
  CameraPoint,
  LayerFilters,
  LayerId,
  RoadConditionFeature,
  RoadLayerId,
} from "@/lib/types";
import { useI18n } from "./i18n-provider";

const TILES = ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];
const POSITRON_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export type BasemapId = "osm" | "positron";

/** Default and fallback style, so a failed Positron request never leaves the map blank. */
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

async function resolveStyle(basemap: BasemapId) {
  if (basemap === "osm") return OSM_STYLE;
  try {
    const res = await fetch(POSITRON_STYLE_URL, { signal: AbortSignal.timeout(5000) });
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

const ROAD_LAYER_IDS: RoadLayerId[] = ROAD_LAYER_ORDER;

/** Road kinds drawn as an alert glyph: incidents, hazards and works. */
const ROAD_MARKER_KINDS = [
  "congestion-alert",
  "accident",
  "breakdown",
  "obstruction",
  "diversion",
  "incident",
  "live-roadwork",
  "flood-alert",
  "faulty-traffic-light",
  "road-work",
  "road-opening",
] as const;
type RoadMarkerKind = (typeof ROAD_MARKER_KINDS)[number];

/**
 * Which layer owns which MapLibre layer ids. Expressway advisories deliberately
 * have no map layer — they are compact cards in the panel, never map clutter.
 */
const ROAD_DRAW_LAYERS: Record<RoadLayerId, string[]> = {
  "traffic-speed": [
    "road-traffic-speed-casing",
    "road-traffic-speed-line",
    "road-traffic-speed-hit",
    "road-traffic-speed-points",
  ],
  incidents: ["road-incidents-points", "road-incidents-hit"],
  hazards: ["road-hazards-points", "road-hazards-hit"],
  roadworks: ["road-roadworks-points", "road-roadworks-hit"],
  parking: ["road-parking-points", "road-parking-hit"],
  ev: ["road-ev-points", "road-ev-hit"],
  erp: ["road-erp-casing", "road-erp-line", "road-erp-hit"],
  zones: ["road-zones-fill", "road-zones-outline", "road-zones-pin", "road-zones-label", "road-zones-hit"],
  expressway: ["road-expressway-points", "road-expressway-hit"],
};

/**
 * Zone names are worth reading only when zoomed in; the coloured boundary itself
 * is drawn at every zoom, because a safety overlay that appears to do nothing
 * when it is switched on is worse than a busy one.
 */
const ZONE_LABEL_MIN_ZOOM = 13;

/** CSS token per driver-facing layer, resolved to a literal colour for MapLibre. */
const ROAD_COLOR_VAR: Record<RoadLayerId, string> = ROAD_LAYER_COLOR;

/**
 * One alert glyph per incident category, so an accident, a breakdown, a blocked
 * lane and a diversion never look alike on the map.
 */
const ALERT_GLYPHS: Record<RoadMarkerKind, string> = {
  // Congestion: three shrinking bars, the standard "traffic" mark.
  "congestion-alert": `<circle cx="26" cy="26" r="22" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M15 19h22M17 26h18M21 33h10" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
  accident: `<path d="M26 5 49 45H3Z" fill="COLOR" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M26 18v13" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><circle cx="26" cy="38" r="2.6" fill="#fff"/>`,
  // Breakdown: wrench.
  breakdown: `<rect x="5" y="7" width="42" height="38" rx="8" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M32 16a8 8 0 0 0-9.6 10.4L14 34.6 17.4 38l8.2-8.3A8 8 0 0 0 36 20l-4.4 4.4-3-3Z" fill="#fff"/>`,
  // Blocked: a stopped bar in an octagon.
  obstruction: `<path d="M17 5h18l12 12v18L35 47H17L5 35V17Z" fill="COLOR" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><rect x="15" y="23" width="22" height="7" rx="3.5" fill="#fff"/>`,
  diversion: `<rect x="5" y="7" width="42" height="38" rx="8" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M16 34h11a6 6 0 0 0 0-12h-2" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round"/><path d="M27 17l-5 5 5 5" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  incident: `<circle cx="26" cy="26" r="22" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M26 14v15" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><circle cx="26" cy="36" r="2.6" fill="#fff"/>`,
  // Live road works: cone row plus a direction chevron.
  "live-roadwork": `<rect x="5" y="7" width="42" height="38" rx="8" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M18 36l6-18 6 18Z" fill="#fff"/><path d="M14 40h24" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><path d="M36 20v10M36 20l-4 4M36 20l4 4" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  "flood-alert": `<path d="M26 4 48 26 26 48 4 26Z" fill="COLOR" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M17 30c4 0 4-3 8-3s4 3 8 3 4-3 8-3" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M20 21c3-5 6-8 6-8s3 3 6 8a6 6 0 0 1-12 0Z" fill="#fff"/>`,
  "faulty-traffic-light": `<path d="M26 4 48 26 26 48 4 26Z" fill="COLOR" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><rect x="20" y="13" width="12" height="26" rx="5" fill="#fff"/><circle cx="26" cy="20" r="3" fill="COLOR"/><circle cx="26" cy="27" r="3" fill="COLOR" opacity=".7"/><circle cx="26" cy="34" r="3" fill="COLOR" opacity=".4"/>`,
  // Permit register: a calendar, because only the dates are published.
  "road-work": `<rect x="6" y="8" width="40" height="34" rx="7" fill="COLOR" stroke="#fff" stroke-width="4"/><rect x="13" y="20" width="26" height="16" rx="2.5" fill="#fff"/><path d="M13 26h26M19 16v6M33 16v6" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  // Planned opening: barrier lifting into an up arrow.
  "road-opening": `<rect x="6" y="8" width="40" height="34" rx="7" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M26 34V19M26 19l-6 6M26 19l6 6" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 38h22" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>`,
};

function roadMarkerSvg(kind: RoadMarkerKind, color: string) {
  const shape = ALERT_GLYPHS[kind].replaceAll("COLOR", color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52">${shape}</svg>`;
}

/**
 * Parking, charging and EMAS sign markers: a P, a plug and a motorway sign, so
 * the three facilities never look alike. The live number (lots, or free/total
 * points) is drawn beside the icon.
 */
const EXTRA_MARKER_KINDS = ["parking-lot", "ev-charger", "emas-message"] as const;
type ExtraMarkerKind = (typeof EXTRA_MARKER_KINDS)[number];

const EXTRA_MARKER_GLYPHS: Record<ExtraMarkerKind, string> = {
  "parking-lot": `<rect x="3" y="3" width="46" height="46" rx="12" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M20 38V14h8.4a8 8 0 0 1 0 16H20" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
  "ev-charger": `<rect x="3" y="6" width="46" height="40" rx="12" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M29 13 20 28h8l-5 11" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  // EMAS: a gantry sign carrying an advisory.
  "emas-message": `<rect x="4" y="10" width="44" height="30" rx="7" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M14 20h24M14 26h18M14 32h10" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><path d="M26 40v6" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
};

function extraMarkerSvg(kind: ExtraMarkerKind, color: string) {
  const shape = EXTRA_MARKER_GLYPHS[kind].replaceAll("COLOR", color);
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

/**
 * Property filters for the route-aware layers. Filtering the source data — rather
 * than adding MapLibre filter expressions — keeps the panel and the map on
 * exactly the same predicate.
 */
function matchesRoadFilters(feature: RoadConditionFeature, filters?: LayerFilters) {
  if (!filters) return true;
  const properties = feature.properties;
  if (properties.layer === "parking") {
    return !filters.lotType || properties.lotType === filters.lotType;
  }
  if (properties.layer === "ev") {
    if (filters.plugType && properties.plugType !== filters.plugType) return false;
    if (filters.minPowerKw) {
      const kw = properties.powerRatingKw ?? properties.chargingSpeedKw ?? 0;
      if (kw < filters.minPowerKw) return false;
    }
    if (filters.availableOnly && !(properties.availablePoints ?? 0)) return false;
  }
  return true;
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
  basemap?: BasemapId;
  points: CameraPoint[];
  active: Record<LayerId, boolean>;
  selectedId: string | null;
  onSelect: (point: CameraPoint | null) => void;
  roadFeatures: RoadConditionFeature[];
  roadActive: Record<RoadLayerId, boolean>;
  /** Property filters applied to the route-aware layers (5–8). */
  layerFilters?: LayerFilters;
  /** Restrict incident alert icons to one route (null = every route). */
  incidentRoute: string | null;
  selectedRoadId: string | null;
  onRoadSelect: (feature: RoadConditionFeature | null) => void;
  focus: MapFocus | null;
  className?: string;
}

export default function MapView({
  basemap = "osm",
  points,
  active,
  selectedId,
  onSelect,
  roadFeatures,
  roadActive,
  layerFilters,
  incidentRoute,
  selectedRoadId,
  onRoadSelect,
  focus,
  className,
}: MapViewProps) {
  const { t } = useI18n();
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const view = useRef({
    center: SG_CENTER,
    zoom: SG_ZOOM,
    bearing: 0,
    pitch: 0,
  });
  const appliedFocusKey = useRef<string | null>(null);
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
      // The registry stores `var(--x)`; MapLibre needs the resolved literal.
      resolved.set(id, resolveColor(ROAD_COLOR_VAR[id], "#6b625b"));
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
    for (const kind of ROAD_MARKER_KINDS) {
      const layer: RoadLayerId =
        kind === "flood-alert" || kind === "faulty-traffic-light"
          ? "hazards"
          : kind === "road-work" || kind === "road-opening" || kind === "live-roadwork"
            ? "roadworks"
            : kind === "congestion-alert"
              ? "traffic-speed"
              : "incidents";
      defs.push({
        id: `road-mk-${kind}`,
        svg: roadMarkerSvg(kind, roadColors.get(layer) ?? "#6b625b"),
      });
    }
    for (const kind of EXTRA_MARKER_KINDS) {
      const layer: RoadLayerId =
        kind === "parking-lot" ? "parking" : kind === "ev-charger" ? "ev" : "expressway";
      defs.push({
        id: `road-mk-${kind}`,
        svg: extraMarkerSvg(kind, roadColors.get(layer) ?? "#6b625b"),
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
    const erpColor = cssVar("--c-erp", "#8f5a12");
    const zonesColor = cssVar("--c-zones", "#a63f7a");
    const silverColor = cssVar("--c-silver", "#5a4f9e");
    const inkColor = cssVar("--ink", "#203b36");
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

    // LTA publishes only start/end coordinates, so these are schematic
    // indicators rather than road geometry. Keep them prominent and continuous
    // so their live speed colours remain easy to scan on the map.
    mapInstance.addSource("road-traffic-speed", { type: "geojson", data: empty });
    mapInstance.addLayer({
      id: "road-traffic-speed-casing",
      type: "line",
      source: "road-traffic-speed",
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.82,
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 5, 16, 11],
      },
    });
    mapInstance.addLayer({
      id: "road-traffic-speed-line",
      type: "line",
      source: "road-traffic-speed",
      paint: {
        "line-color": speedColor,
        "line-opacity": 0.88,
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 16, 8],
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
            "icon-ignore-placement": true,
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

    // Every driver-facing layer owns one source; the draw layers below decide
    // whether it appears as segments, alert icons, markers, gantry spans or
    // zoom-gated boundaries.
    for (const id of ROAD_LAYER_IDS) {
      const source = `road-${id}`;
      if (!mapInstance.getSource(source)) {
        mapInstance.addSource(source, { type: "geojson", data: empty });
      }
    }

    // 2–4 · alert icons (accidents, hazards, works) and layer 1's heavy-traffic mark.
    // Layer 1's own hit area is the wide speed-band line added above, so only its
    // marker symbols are added here.
    for (const id of ["traffic-speed", "incidents", "hazards", "roadworks"] as RoadLayerId[]) {
      mapInstance.addLayer({
        id: `road-${id}-points`,
        type: "symbol",
        source: `road-${id}`,
        // The speed source also carries LineString speed bands; a symbol layer must
        // never try to draw an icon for them.
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "icon-image": ["concat", "road-mk-", ["get", "kind"]],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.52, 16, 0.72],
          "icon-allow-overlap": true,
          // Road alerts are sparse and matter: they must never be dropped because a
          // denser layer (cameras, parking) already reserved that patch of the map.
          "icon-ignore-placement": true,
          "icon-anchor": "center",
        },
      });
      if (id === "traffic-speed") continue;
      mapInstance.addLayer({
        id: `road-${id}-hit`,
        type: "circle",
        source: `road-${id}`,
        paint: { "circle-radius": 17, "circle-opacity": 0.01, "circle-color": "#000000" },
      });
    }

    // 5 · parking: a P marker whose label is the live lot count. Drawn at every
    // zoom: switching a layer on must mark the map, not wait for a zoom level.
    mapInstance.addLayer({
      id: "road-parking-points",
      type: "symbol",
      source: "road-parking",
      layout: {
        "icon-image": "road-mk-parking-lot",
        // Reserve no collision space: parking and charging are dense layers, and
        // without this the sparser incident and EMAS markers never get placed.
        "icon-ignore-placement": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.3, 12, 0.42, 17, 0.6],
        "icon-allow-overlap": true,
        "text-field": ["to-string", ["coalesce", ["get", "availableLots"], 0]],
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 9, 9, 12, 10, 17, 13],
        "text-anchor": "top",
        "text-offset": [0, 1.2],
        // Labels declutter themselves; the icons stay put so the coverage reads as
        // continuous rather than blinking in and out.
        "text-allow-overlap": false,
      },
      paint: { "text-color": inkColor, "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
    });
    mapInstance.addLayer({
      id: "road-parking-hit",
      type: "circle",
      source: "road-parking",
      paint: { "circle-radius": 17, "circle-opacity": 0.01, "circle-color": "#000000" },
    });

    // 7 · EV charging: a plug marker labelled with free/total points, at every zoom.
    mapInstance.addLayer({
      id: "road-ev-points",
      type: "symbol",
      source: "road-ev",
      layout: {
        "icon-image": "road-mk-ev-charger",
        // Reserve no collision space: parking and charging are dense layers, and
        // without this the sparser incident and EMAS markers never get placed.
        "icon-ignore-placement": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.3, 12, 0.42, 17, 0.6],
        "icon-allow-overlap": true,
        "text-field": [
          "concat",
          ["to-string", ["coalesce", ["get", "availablePoints"], 0]],
          "/",
          ["to-string", ["coalesce", ["get", "totalPoints"], 0]],
        ],
        "text-font": ["Open Sans Semibold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 9, 9, 12, 10, 17, 13],
        "text-anchor": "top",
        "text-offset": [0, 1.2],
        "text-allow-overlap": false,
      },
      paint: { "text-color": inkColor, "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
    });
    mapInstance.addLayer({
      id: "road-ev-hit",
      type: "circle",
      source: "road-ev",
      paint: { "circle-radius": 17, "circle-opacity": 0.01, "circle-color": "#000000" },
    });

    // 6 · ERP gantry spans. Thin at city scale, heavier up close; the cost summary
    // lives in the panel, so the map never carries a carpet of toll markers.
    mapInstance.addLayer({
      id: "road-erp-casing",
      type: "line",
      source: "road-erp",
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.85,
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 14, 4, 17, 8],
      },
    });
    mapInstance.addLayer({
      id: "road-erp-line",
      type: "line",
      source: "road-erp",
      paint: {
        "line-color": erpColor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 14, 2, 17, 5],
        "line-dasharray": [3, 1.4],
      },
    });
    mapInstance.addLayer({
      id: "road-erp-hit",
      type: "line",
      source: "road-erp",
      paint: { "line-color": "#000000", "line-opacity": 0.01, "line-width": 16 },
    });

    // 8 · school & silver zones. The colour is always on — a safety overlay that
    // only appears at zoom 14 looks broken at city scale — and the two zone types
    // are told apart by colour, not only by the popup.
    const zoneFill: maplibregl.ExpressionSpecification = [
      "match",
      ["get", "kind"],
      "school-zone",
      zonesColor,
      "silver-zone",
      silverColor,
      zonesColor,
    ];
    mapInstance.addLayer({
      id: "road-zones-fill",
      type: "fill",
      source: "road-zones",
      paint: { "fill-color": zoneFill, "fill-opacity": 0.32 },
    });
    mapInstance.addLayer({
      id: "road-zones-outline",
      type: "line",
      source: "road-zones",
      paint: {
        "line-color": zoneFill,
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 14, 1.6, 17, 2.6],
        "line-dasharray": [2, 1.2],
      },
    });
    mapInstance.addLayer({
      id: "road-zones-label",
      type: "symbol",
      source: "road-zones",
      minzoom: ZONE_LABEL_MIN_ZOOM,
      layout: {
        "text-field": ["get", "road"],
        "text-font": ["Open Sans Semibold"],
        "text-size": 11,
        "text-allow-overlap": false,
      },
      paint: { "text-color": inkColor, "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
    });
    // A school zone is only a couple of pixels across at city scale, so the overlay
    // also shows one dot per zone until the boundary itself is legible.
    mapInstance.addLayer({
      id: "road-zones-pin",
      type: "circle",
      source: "road-zones",
      maxzoom: 13.5,
      paint: {
        "circle-color": zoneFill,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 12, 6.5, 13.5, 9],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.4,
        "circle-opacity": 0.92,
      },
    });
    mapInstance.addLayer({
      id: "road-zones-hit",
      type: "fill",
      source: "road-zones",
      paint: { "fill-color": "#000000", "fill-opacity": 0.01 },
    });

    // 9 · the travel-time feed carries no coordinates, so the map marks the EMAS
    // signboards and the corridor times stay compact cards.
    mapInstance.addLayer({
      id: "road-expressway-points",
      type: "symbol",
      source: "road-expressway",
      filter: ["==", ["geometry-type"], "Point"],
      layout: {
        "icon-image": "road-mk-emas-message",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.34, 12, 0.46, 17, 0.64],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "center",
      },
    });
    mapInstance.addLayer({
      id: "road-expressway-hit",
      type: "circle",
      source: "road-expressway",
      paint: { "circle-radius": 17, "circle-opacity": 0.01, "circle-color": "#000000" },
    });

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
    mapInstance.addLayer({
      id: "road-selected-fill",
      type: "fill",
      source: "road-selected",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#17130f", "fill-opacity": 0.1 },
    });

    const roadInteractive = [
      "road-traffic-speed-hit",
      "road-erp-hit",
      "road-zones-hit",
      ...(
        [
          "traffic-speed",
          "incidents",
          "hazards",
          "roadworks",
          "parking",
          "ev",
          "expressway",
        ] as RoadLayerId[]
      ).flatMap((id) => [`road-${id}-hit`, `road-${id}-points`]),
      "road-zones-label",
      "road-zones-pin",
    ];
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
    // A basemap change creates a fresh style graph. Rebuilding the MapLibre
    // instance avoids duplicate delegated event handlers while the view ref keeps
    // the user's exact position and zoom.
    setReady(false);
    let cancelled = false;
    const resizeObserver = new ResizeObserver(() => map.current?.resize());
    resizeObserver.observe(container);

    void (async () => {
      const style = await resolveStyle(basemap);
      if (cancelled || map.current) return;
      const mapInstance = new maplibregl.Map({
        container,
        center: view.current.center,
        zoom: view.current.zoom,
        bearing: view.current.bearing,
        pitch: view.current.pitch,
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
      const mapInstance = map.current;
      if (mapInstance) {
        const center = mapInstance.getCenter();
        view.current = {
          center: [center.lng, center.lat],
          zoom: mapInstance.getZoom(),
          bearing: mapInstance.getBearing(),
          pitch: mapInstance.getPitch(),
        };
        mapInstance.remove();
        map.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot map setup; colours resolve once per mount
  }, [basemap]);

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
          // Route filter: LTA publishes the affected route in its own message
          // wording, so this narrows real route attribution rather than guessing.
          .filter(
            (feature) =>
              layer !== "incidents" ||
              !incidentRoute ||
              feature.properties.route === incidentRoute,
          )
          .filter((feature) => matchesRoadFilters(feature, layerFilters))
          .map((feature) => ({
            type: "Feature" as const,
            id: feature.id,
            geometry: feature.geometry!,
            properties: { ...feature.properties, id: feature.id },
          })),
      });
    }
  }, [roadFeatures, incidentRoute, layerFilters, ready]);

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
      for (const id of ROAD_DRAW_LAYERS[layer]) {
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
    if (!mapInstance || !ready || !focus || appliedFocusKey.current === focus.key) return;
    appliedFocusKey.current = focus.key;
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
      data-basemap={basemap}
      data-testid="map"
    />
  );
}
