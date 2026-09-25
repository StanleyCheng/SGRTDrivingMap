import type {
  RoadConditionFeature,
  RoadConditionKind,
  RoadLayerId,
} from "../types";
import {
  asNumber,
  asText,
  dataMallUrl,
  featureId,
  fetchDataMallAll,
  hash,
  normaliseLtaDate,
  point,
  type RawRecord,
  type SourceDefinition,
} from "./feeds";

/**
 * Layers 1–4: the live LTA / PUB road-condition feeds.
 *
 * Everything here is read from the official wording or the official schema.
 * Where a feed publishes no coordinates, the record keeps `geometry: null`
 * rather than a guessed map position.
 */

export const DATAMALL_DOCS =
  "https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf";

/* ------------------------------------------------------------------ *
 * 1 · Live congestion — Traffic Speed Bands v4
 * ------------------------------------------------------------------ */

/**
 * LTA v4 speed links are straight start/end segments, not full road geometries.
 *
 * Only expressway links (RoadCategory 1) are drawn. The feed publishes 143,787
 * monitored links island-wide; colouring all of them is ~8.3 MB of GeoJSON on
 * every poll and is unreadable on a map, while the 2,598 expressway links are
 * ~0.8 MB and are what a driver actually needs. The full upstream total is
 * reported as `upstreamCount` so the panel can disclose the coverage instead of
 * implying the rest are broken.
 */
const DRAWN_SPEED_CATEGORY = "1";

export function normaliseTrafficSpeedBands(records: RawRecord[]): RoadConditionFeature[] {
  const features: RoadConditionFeature[] = [];
  for (const record of records) {
    const roadCategory = asText(record.RoadCategory);
    if (roadCategory !== DRAWN_SPEED_CATEGORY) continue;
    const start = point(asNumber(record.StartLon), asNumber(record.StartLat));
    const end = point(asNumber(record.EndLon), asNumber(record.EndLat));
    const road = asText(record.RoadName) || "Unnamed road";
    const identity = [
      road,
      asText(record.StartLon),
      asText(record.StartLat),
      asText(record.EndLon),
      asText(record.EndLat),
      asText(record.RoadCategory),
    ].join("\u001f");
    const sourceId = asText(record.LinkID) || hash(identity);
    const speedBand = asNumber(record.SpeedBand);
    const minimumSpeed = asNumber(record.MinimumSpeed);
    const maximumSpeed = asNumber(record.MaximumSpeed);
    const range =
      minimumSpeed !== undefined && maximumSpeed !== undefined
        ? `${minimumSpeed}–${maximumSpeed} km/h`
        : speedBand === 8
          ? "70+ km/h"
          : "Current speed";
    features.push({
      type: "Feature",
      id: featureId("speed-band", sourceId, identity),
      geometry: start && end ? { type: "LineString", coordinates: [start, end] } : null,
      properties: {
        layer: "traffic-speed",
        kind: "speed-band",
        title: `${road} · ${range}`,
        road,
        sourceId,
        speedBand,
        minimumSpeed,
        maximumSpeed,
        roadCategory: asText(record.RoadCategory) || undefined,
      },
    });
  }
  return features;
}

/* ------------------------------------------------------------------ *
 * 2–4 · Live incidents feed (one feed, three layers)
 * ------------------------------------------------------------------ */

/**
 * LTA's TrafficIncidents "Type" values → our layer + kind.
 *
 * The one feed legitimately feeds three of the four driver-facing layers: heavy
 * traffic is live congestion (speed layer), road works carry the direction and
 * lane detail the permit register lacks (roadworks layer), and the rest are the
 * alert icons (incidents layer). Anything undocumented is kept as `incident`
 * rather than dropped.
 */
function incidentCategory(type: string): { kind: RoadConditionKind; layer: RoadLayerId } {
  const value = type.toLowerCase();
  if (/accident|collision/.test(value)) return { kind: "accident", layer: "incidents" };
  if (/breakdown|stalled|stall\b/.test(value)) return { kind: "breakdown", layer: "incidents" };
  if (/divert|diversion|road ?clos|lane ?clos|closed/.test(value))
    return { kind: "diversion", layer: "incidents" };
  if (/obstruct|block|fallen|tree|debris|spill|fire/.test(value))
    return { kind: "obstruction", layer: "incidents" };
  if (/road ? ?works?|works|construction|maintenance|resurfac/.test(value))
    return { kind: "live-roadwork", layer: "roadworks" };
  if (/heavy ?traffic|congest|slow|queue/.test(value))
    return { kind: "congestion-alert", layer: "traffic-speed" };
  return { kind: "incident", layer: "incidents" };
}

/**
 * LTA writes incidents as: `(22/9)13:34 Road Works on AYE (towards MCE) after
 * Tuas West Rd. Avoid lane 1.` Everything below is read out of that official
 * wording — the route, direction, landmark and lane are never inferred from
 * coordinates or invented.
 */
export function parseIncidentMessage(message: string) {
  const reported = /^\s*\((\d{1,2}\/\d{1,2})\)\s*(\d{1,2}:\d{2})\s*/.exec(message);
  const reportedText = reported ? `(${reported[1]}) ${reported[2]}` : undefined;
  const body = reported ? message.slice(reported[0].length).trim() : message.trim();

  const withDirection = /\bon\s+(.+?)\s*\(\s*towards?\s+([^)]*?)\s*\)/i.exec(body);
  const withoutDirection = /\bon\s+([^().]+?)(?=\s+(?:after|before|at|between|near)\b|[.,]|$)/i.exec(body);
  const route = (withDirection?.[1] ?? withoutDirection?.[1] ?? "").trim() || undefined;
  const direction = withDirection?.[2]?.trim()
    ? `towards ${withDirection[2].trim()}`
    : undefined;

  const landmarkMatch = /\b(after|before|at|between|near)\s+(.+?)(?=\.\s*(?:Avoid\b|$)|\s*$)/i.exec(body);
  const landmark = landmarkMatch
    ? `${landmarkMatch[1]} ${landmarkMatch[2]}`.replace(/\s+/g, " ").trim()
    : undefined;

  const laneMatch = /avoid\s+lane\s+([^.;]+)/i.exec(body);
  const lane = laneMatch ? laneMatch[1].replace(/\s+/g, " ").trim() : undefined;

  return { reportedText, body, route, direction, landmark, lane };
}

export function normaliseTrafficIncidents(records: RawRecord[]): RoadConditionFeature[] {
  const features: RoadConditionFeature[] = [];
  for (const record of records) {
    const coordinates = point(asNumber(record.Longitude), asNumber(record.Latitude));
    const type = asText(record.Type) || "Traffic incident";
    const description = asText(record.Message);
    const identity = [
      type,
      asText(record.Longitude),
      asText(record.Latitude),
      description,
    ].join("\u001f");
    // TrafficIncidents has no documented upstream ID. Derive a stable
    // fingerprint solely from the four fields in the official schema.
    const sourceId = hash(identity);
    const { kind, layer } = incidentCategory(type);
    const parsed = parseIncidentMessage(description);
    features.push({
      type: "Feature",
      id: featureId(kind, sourceId, description),
      geometry: coordinates ? { type: "Point", coordinates } : null,
      properties: {
        layer,
        kind,
        title: parsed.body || type,
        description: description || undefined,
        sourceId,
        route: parsed.route,
        direction: parsed.direction,
        landmark: parsed.landmark,
        lane: parsed.lane,
        reportedText: parsed.reportedText,
        agency: "LTA",
      },
    });
  }
  return features;
}

/* ------------------------------------------------------------------ *
 * 3 · Hazards — PUB flood alerts + faulty traffic lights
 * ------------------------------------------------------------------ */

function parseFloodCircle(value: unknown) {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/.exec(
    asText(value),
  );
  if (!match) return {};
  const coordinates = point(Number(match[2]), Number(match[1]));
  return { coordinates, radiusKm: Number(match[3]) };
}

export function normaliseFloodAlerts(records: RawRecord[]): RoadConditionFeature[] {
  const features: RoadConditionFeature[] = [];
  const cancelled = new Set<string>();
  for (const record of records) {
    if (asText(record.msgType).toLowerCase() !== "cancel") continue;
    const references = Array.isArray(record.references)
      ? record.references.map(asText)
      : [asText(record.references)];
    for (const reference of references.flatMap((value) => value.split(/\s+/))) {
      if (!reference) continue;
      // CAP references use sender,identifier,sent triples.
      const parts = reference.split(",");
      cancelled.add(parts.length >= 2 ? parts[1] : reference);
    }
  }

  for (const record of records) {
    // A cancellation retracts a prior alert; it is not itself a current hazard.
    if (asText(record.msgType).toLowerCase() === "cancel") continue;
    const publishedId = asText(record.alertId);
    if (publishedId && cancelled.has(publishedId)) continue;
    const expiresAt = normaliseLtaDate(record.expires);
    const expiresMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
    if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) continue;
    const { coordinates, radiusKm } = parseFloodCircle(record.circle);
    const title = asText(record.headline) || asText(record.event) || "Flood alert";
    const description = asText(record.description) || asText(record.instruction);
    const sourceId = publishedId || hash(`${title}:${asText(record.dateTime)}:${description}`);
    features.push({
      type: "Feature",
      id: featureId("flood-alert", sourceId, description),
      geometry: coordinates ? { type: "Point", coordinates } : null,
      properties: {
        layer: "hazards",
        kind: "flood-alert",
        title,
        description: description || undefined,
        road: asText(record.areaDesc) || undefined,
        sourceId,
        // Flood alerts explicitly publish CAP severity. Preserve that value;
        // other feeds must not be assigned an inferred severity.
        severity: asText(record.severity) || undefined,
        startsAt: normaliseLtaDate(record.dateTime),
        endsAt: expiresAt,
        radiusKm,
        agency: asText(record.senderName) || "PUB",
      },
    });
  }
  return features;
}

export function normaliseFaultyTrafficLights(records: RawRecord[]): RoadConditionFeature[] {
  return records.map((record) => {
    const sourceId = asText(record.AlarmID) || asText(record.NodeID) || hash(JSON.stringify(record));
    const alarmType = asNumber(record.Type);
    const title =
      alarmType === 4
        ? "Traffic light blackout"
        : alarmType === 13
          ? "Traffic light flashing yellow"
          : "Traffic light fault";
    return {
      type: "Feature",
      id: featureId("faulty-traffic-light", sourceId, JSON.stringify(record)),
      // The official endpoint publishes no coordinates. Keep the alert useful
      // in lists/status surfaces without fabricating a map location.
      geometry: null,
      properties: {
        layer: "hazards",
        kind: "faulty-traffic-light",
        title,
        description: asText(record.Message) || undefined,
        sourceId,
        startsAt: normaliseLtaDate(record.StartDate),
        endsAt: normaliseLtaDate(record.EndDate),
        agency: "LTA",
      },
    } satisfies RoadConditionFeature;
  });
}

/* ------------------------------------------------------------------ *
 * 4 · Roadworks & planned openings — permit register
 * ------------------------------------------------------------------ */

function normaliseRoadEvents(
  records: RawRecord[],
  kind: "road-work" | "road-opening",
): RoadConditionFeature[] {
  return records.map((record) => {
    const road = asText(record.RoadName) || "Unnamed road";
    const identity = [
      asText(record.EventID),
      road,
      asText(record.StartDate),
      asText(record.EndDate),
      asText(record.SvcDept),
      asText(record.Other),
    ].join("\u001f");
    const sourceId = asText(record.EventID) || hash(identity);
    return {
      type: "Feature",
      // EventID is not unique in the live feeds; include the published record
      // fields in the map-feature identity while retaining EventID as sourceId.
      id: featureId(kind, `${sourceId}:${hash(identity)}`, identity),
      // DataMall supplies a road name but no site/extent geometry for these
      // feeds. A guessed point or whole-road highlight would be misleading.
      geometry: null,
      properties: {
        layer: "roadworks",
        kind,
        title: kind === "road-work" ? `Road works · ${road}` : `Planned opening · ${road}`,
        description: asText(record.Other) || undefined,
        road,
        // The permit register publishes a road name only — no direction, lane or
        // site geometry. Those fields are left unset rather than inferred.
        route: road,
        sourceId,
        startsAt: normaliseLtaDate(record.StartDate),
        endsAt: normaliseLtaDate(record.EndDate),
        agency: asText(record.SvcDept) || undefined,
      },
    } satisfies RoadConditionFeature;
  });
}

export const normaliseRoadWorks = (records: RawRecord[]) => normaliseRoadEvents(records, "road-work");
export const normaliseRoadOpenings = (records: RawRecord[]) =>
  normaliseRoadEvents(records, "road-opening");

/* ------------------------------------------------------------------ *
 * Feed definitions
 * ------------------------------------------------------------------ */

const def = (
  id: SourceDefinition["id"],
  layers: RoadLayerId[],
  name: string,
  pathname: string,
  ttlMs: number,
  maxStaleMs: number,
  normalise: SourceDefinition["normalise"],
): SourceDefinition => ({
  id,
  layers,
  name,
  url: dataMallUrl(pathname),
  ttlMs,
  maxStaleMs,
  fetch: () => fetchDataMallAll(pathname),
  normalise,
});

export const ROAD_CONDITION_SOURCES: SourceDefinition[] = [
  def(
    "speed-band",
    ["traffic-speed"],
    "LTA Traffic Speed Bands v4",
    "v4/TrafficSpeedBands",
    5 * 60 * 1000,
    15 * 60 * 1000,
    normaliseTrafficSpeedBands,
  ),
  def(
    "traffic-incident",
    // One feed, three driver-facing layers — see incidentCategory().
    ["traffic-speed", "incidents", "roadworks"],
    "LTA Traffic Incidents",
    "TrafficIncidents",
    2 * 60 * 1000,
    10 * 60 * 1000,
    normaliseTrafficIncidents,
  ),
  def(
    "flood-alert",
    ["hazards"],
    "PUB Flood Alerts via LTA DataMall",
    "PubFloodAlerts",
    3 * 60 * 1000,
    15 * 60 * 1000,
    normaliseFloodAlerts,
  ),
  def(
    "faulty-traffic-light",
    ["hazards"],
    "LTA Faulty Traffic Lights",
    "FaultyTrafficLights",
    2 * 60 * 1000,
    10 * 60 * 1000,
    normaliseFaultyTrafficLights,
  ),
  def(
    "road-work",
    ["roadworks"],
    "LTA Approved Road Works",
    "RoadWorks",
    24 * 60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
    normaliseRoadWorks,
  ),
  def(
    "road-opening",
    ["roadworks"],
    "LTA Planned Road Openings",
    "RoadOpenings",
    24 * 60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
    normaliseRoadOpenings,
  ),
];

export const ROAD_CONDITIONS_DOCUMENTATION_URL = DATAMALL_DOCS;
