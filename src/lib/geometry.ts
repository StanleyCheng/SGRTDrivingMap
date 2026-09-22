import type { RoadConditionGeometry, RoadPosition } from "./types";

/**
 * A single sensible map target for any official geometry, so every overlay can
 * share one "zoom to this" action: points use themselves, lines use their
 * midpoint, polygons use the centre of their outer ring.
 */
export function geometryFocus(
  geometry: RoadConditionGeometry | null,
): { lat: number; lng: number } | null {
  if (!geometry) return null;
  if (geometry.type === "Point") {
    return { lng: geometry.coordinates[0], lat: geometry.coordinates[1] };
  }
  if (geometry.type === "LineString") {
    const line = geometry.coordinates;
    if (!line.length) return null;
    const mid = midpoint(line[0], line[line.length - 1]);
    return { lng: mid[0], lat: mid[1] };
  }
  const ring = geometry.coordinates[0] ?? [];
  if (!ring.length) return null;
  let lng = 0;
  let lat = 0;
  for (const position of ring) {
    lng += position[0];
    lat += position[1];
  }
  return { lng: lng / ring.length, lat: lat / ring.length };
}

/** Default zoom that frames the geometry without hiding it behind a panel. */
export function geometryZoom(geometry: RoadConditionGeometry | null) {
  if (!geometry) return 14;
  if (geometry.type === "Point") return 16.5;
  if (geometry.type === "LineString") return 15;
  return 14.5;
}

function midpoint(a: RoadPosition, b: RoadPosition): RoadPosition {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
