import type { CameraKind, LayerFilters, RoadConditionFeature } from "@/lib/types";

/**
 * Marker artwork and the small pure helpers the map needs: the glyph tables are
 * generated as SVG so they scale crisply and need no assets, and the colour
 * resolvers turn the registry's `var(--x)` tokens into the literal colours
 * MapLibre paint properties require.
 */

export const KIND_SHAPES: Record<CameraKind, "dot" | "diamond" | "square"> = {
  redlight: "dot",
  fixed_speed: "diamond",
  expressway_speed: "diamond",
  laser_speed: "diamond",
  mobile_speed: "diamond",
  snapshot: "square",
};

/** Road kinds drawn as an alert glyph: incidents, hazards and works. */
export const ROAD_MARKER_KINDS = [
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

export function roadMarkerSvg(kind: RoadMarkerKind, color: string) {
  const shape = ALERT_GLYPHS[kind].replaceAll("COLOR", color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52">${shape}</svg>`;
}

/**
 * Parking, charging and EMAS sign markers: a P, a plug and a motorway sign, so
 * the three facilities never look alike. The live number (lots, or free/total
 * points) is drawn beside the icon.
 */
export const EXTRA_MARKER_KINDS = ["parking-lot", "ev-charger", "emas-message"] as const;
type ExtraMarkerKind = (typeof EXTRA_MARKER_KINDS)[number];

const EXTRA_MARKER_GLYPHS: Record<ExtraMarkerKind, string> = {
  "parking-lot": `<rect x="3" y="3" width="46" height="46" rx="12" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M20 38V14h8.4a8 8 0 0 1 0 16H20" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
  "ev-charger": `<rect x="3" y="6" width="46" height="40" rx="12" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M29 13 20 28h8l-5 11" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  // EMAS: a gantry sign carrying an advisory.
  "emas-message": `<rect x="4" y="10" width="44" height="30" rx="7" fill="COLOR" stroke="#fff" stroke-width="4"/><path d="M14 20h24M14 26h18M14 32h10" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><path d="M26 40v6" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
};

export function extraMarkerSvg(kind: ExtraMarkerKind, color: string) {
  const shape = EXTRA_MARKER_GLYPHS[kind].replaceAll("COLOR", color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52">${shape}</svg>`;
}

/** Marker artwork is generated as SVG so it scales crisply and needs no assets. */
export function markerSvg(kind: CameraKind, color: string, size = 2) {
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

export function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** MapLibre paint properties need literal colours, so resolve `var(--x)` tokens. */
export function resolveColor(value: string, fallback: string) {
  const name = /var\((--[\w-]+)\)/.exec(value)?.[1];
  return cssVar(name ?? value, fallback);
}

/**
 * Property filters for the route-aware layers. Filtering the source data — rather
 * than adding MapLibre filter expressions — keeps the panel and the map on
 * exactly the same predicate.
 */
export function matchesRoadFilters(feature: RoadConditionFeature, filters?: LayerFilters) {
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
