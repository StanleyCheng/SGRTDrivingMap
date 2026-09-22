import type {
  RoadConditionFeature,
  RoadConditionKind,
  RoadConditionLayerInfo,
  RoadConditionSourceId,
  RoadConditionSourceStatus,
  RoadConditionsResponse,
  RoadLayerId,
  RoadPosition,
  SourceStatus,
} from "../types";
import { ageMs, readDisk, readMemory, writeDisk, writeMemory, type CacheEntry } from "./cache";

const DATAMALL_BASE = "https://datamall2.mytransport.sg/ltaodataservice";
const DATAMALL_DOCS =
  "https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf";
const PAGE_SIZE = 500;
// TrafficSpeedBands v4 published 143,787 links on 22 Sep 2026 and grows over
// time, so the cap must stay well clear of the real feed — it exists only to
// stop an upstream runaway, not as a working limit.
const MAX_PAGES = 320;

// Wide enough to include Singapore's outlying road links while rejecting
// zeroes, swapped coordinates, and unrelated global positions.
const SINGAPORE_BOUNDS = {
  minLng: 103.4,
  maxLng: 104.1,
  minLat: 1.15,
  maxLat: 1.5,
} as const;

type RawRecord = Record<string, unknown>;
type Normaliser = (records: RawRecord[]) => RoadConditionFeature[];

interface SourceDefinition {
  id: RoadConditionSourceId;
  /** Every driver-facing layer this feed contributes features to. */
  layers: RoadLayerId[];
  name: string;
  pathname: string;
  ttlMs: number;
  /** Old safety data must not remain visible indefinitely after failures. */
  maxStaleMs: number;
  normalise: Normaliser;
}

interface LoadedSource {
  features: RoadConditionFeature[];
  source: RoadConditionSourceStatus;
  fromCache: boolean;
}

class DataMallError extends Error {}

const asText = (value: unknown) => (value == null ? "" : String(value).trim());
const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
const asNumber = (value: unknown) => {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};
const round = (number: number) => Math.round(number * 1e6) / 1e6;
const isRawRecord = (value: unknown): value is RawRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isSourceCacheEntry(value: unknown): value is CacheEntry<RawRecord[]> {
  if (!isRawRecord(value)) return false;
  const data = value.data;
  const generatedAt = value.generatedAt;
  return (
    Array.isArray(data) &&
    data.every(isRawRecord) &&
    typeof generatedAt === "string" &&
    Number.isFinite(Date.parse(generatedAt))
  );
}

function point(lng: number | undefined, lat: number | undefined): RoadPosition | undefined {
  if (
    lng === undefined ||
    lat === undefined ||
    lng < SINGAPORE_BOUNDS.minLng ||
    lng > SINGAPORE_BOUNDS.maxLng ||
    lat < SINGAPORE_BOUNDS.minLat ||
    lat > SINGAPORE_BOUNDS.maxLat
  ) {
    return undefined;
  }
  return [round(lng), round(lat)];
}

/** Small deterministic hash for stable IDs when an upstream feed has no record ID. */
function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function featureId(kind: RoadConditionKind, sourceId: string, fallback: string) {
  return `${kind}:${sourceId || hash(fallback)}`;
}

/** Convert DataMall's Singapore-local date strings into ISO-shaped values. */
export function normaliseLtaDate(value: unknown): string | undefined {
  const input = asText(value);
  if (!input) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return `${input}T00:00:00+08:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(input)) {
    return `${input.replace(" ", "T")}+08:00`;
  }
  return input;
}

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
function parseIncidentMessage(message: string) {
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

const SOURCES: SourceDefinition[] = [
  {
    id: "speed-band",
    layers: ["traffic-speed"],
    name: "LTA Traffic Speed Bands v4",
    pathname: "v4/TrafficSpeedBands",
    ttlMs: 5 * 60 * 1000,
    maxStaleMs: 15 * 60 * 1000,
    normalise: normaliseTrafficSpeedBands,
  },
  {
    id: "traffic-incident",
    // One feed, three driver-facing layers — see incidentCategory().
    layers: ["traffic-speed", "incidents", "roadworks"],
    name: "LTA Traffic Incidents",
    pathname: "TrafficIncidents",
    ttlMs: 2 * 60 * 1000,
    maxStaleMs: 10 * 60 * 1000,
    normalise: normaliseTrafficIncidents,
  },
  {
    id: "flood-alert",
    layers: ["hazards"],
    name: "PUB Flood Alerts via LTA DataMall",
    pathname: "PubFloodAlerts",
    ttlMs: 3 * 60 * 1000,
    maxStaleMs: 15 * 60 * 1000,
    normalise: normaliseFloodAlerts,
  },
  {
    id: "faulty-traffic-light",
    layers: ["hazards"],
    name: "LTA Faulty Traffic Lights",
    pathname: "FaultyTrafficLights",
    ttlMs: 2 * 60 * 1000,
    maxStaleMs: 10 * 60 * 1000,
    normalise: normaliseFaultyTrafficLights,
  },
  {
    id: "road-work",
    layers: ["roadworks"],
    name: "LTA Approved Road Works",
    pathname: "RoadWorks",
    ttlMs: 24 * 60 * 60 * 1000,
    maxStaleMs: 7 * 24 * 60 * 60 * 1000,
    normalise: normaliseRoadWorks,
  },
  {
    id: "road-opening",
    layers: ["roadworks"],
    name: "LTA Planned Road Openings",
    pathname: "RoadOpenings",
    ttlMs: 24 * 60 * 60 * 1000,
    maxStaleMs: 7 * 24 * 60 * 60 * 1000,
    normalise: normaliseRoadOpenings,
  },
];

const SOURCE_URL = (pathname: string) => `${DATAMALL_BASE}/${pathname}`;

function accountKey() {
  const key = process.env.DATAMALL_ACCOUNT_KEY?.trim();
  if (!key) throw new DataMallError("DATAMALL_ACCOUNT_KEY is not configured");
  return key;
}

async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { AccountKey: accountKey(), accept: "application/json" },
    });
    if (!response.ok) throw new DataMallError(`LTA DataMall returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new DataMallError("LTA DataMall request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** DataMall limits normal responses to 500 rows; exhaust the documented `$skip` pages. */
async function fetchAll(pathname: string): Promise<RawRecord[]> {
  const records: RawRecord[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(SOURCE_URL(pathname));
    if (page > 0) url.searchParams.set("$skip", String(page * PAGE_SIZE));
    const payload = await fetchJson(url.toString());
    const value = (payload as { value?: unknown })?.value;
    if (!Array.isArray(value)) throw new DataMallError("LTA DataMall returned an unexpected response");
    const pageRecords = value.filter(isRawRecord);
    records.push(...pageRecords);
    if (value.length < PAGE_SIZE) return records;
  }
  throw new DataMallError(`LTA DataMall response exceeded ${MAX_PAGES * PAGE_SIZE} records`);
}

const inflight = new Map<RoadConditionSourceId, Promise<CacheEntry<RawRecord[]>>>();

function refreshSource(definition: SourceDefinition) {
  const running = inflight.get(definition.id);
  if (running) return running;
  const task = fetchAll(definition.pathname)
    .then((data) => {
      const entry = { data, generatedAt: new Date().toISOString() };
      writeMemory(`road-condition-${definition.id}`, entry);
      void writeDisk(`road-condition-${definition.id}`, entry);
      return entry;
    })
    .finally(() => inflight.delete(definition.id));
  inflight.set(definition.id, task);
  return task;
}

async function loadSource(definition: SourceDefinition): Promise<LoadedSource> {
  const cacheKey = `road-condition-${definition.id}`;
  const memoryEntry = readMemory<unknown>(cacheKey);
  let entry = isSourceCacheEntry(memoryEntry) ? memoryEntry : undefined;
  if (!entry) {
    const diskEntry = await readDisk<unknown>(cacheKey);
    entry = isSourceCacheEntry(diskEntry) ? diskEntry : undefined;
    if (entry) writeMemory(cacheKey, entry);
  }
  let status: SourceStatus = "ok";
  let error: string | undefined;
  let fromCache = Boolean(entry);

  if (!entry || ageMs(entry) > definition.ttlMs) {
    try {
      entry = await refreshSource(definition);
      fromCache = false;
    } catch (cause) {
      error = errorMessage(cause);
      status = entry && ageMs(entry) <= definition.maxStaleMs ? "stale" : "error";
    }
  }

  const usableEntry = entry && (status !== "error" || !error) ? entry : undefined;
  let normalised: RoadConditionFeature[] = [];
  if (usableEntry) {
    try {
      normalised = definition.normalise(usableEntry.data);
    } catch (cause) {
      const message = `Could not process LTA response: ${errorMessage(cause)}`;
      error = error ? `${error}; ${message}` : message;
      status = "error";
    }
  }
  // Upstream pages can contain duplicate logical records (notably road works
  // and openings). Stable IDs make de-duplication deterministic.
  const features = [...new Map(normalised.map((feature) => [feature.id, feature])).values()];
  const mappedCount = features.filter((feature) => feature.geometry !== null).length;
  return {
    features,
    fromCache,
    source: {
      id: definition.id,
      name: definition.name,
      url: SOURCE_URL(definition.pathname),
      status,
      count: features.length,
      mappedCount,
      // Records LTA published, before this app's drawing scope was applied.
      upstreamCount: usableEntry?.data.length,
      fetchedAt: entry?.generatedAt,
      error,
    },
  };
}

function failedSource(definition: SourceDefinition, cause: unknown): LoadedSource {
  return {
    features: [],
    fromCache: false,
    source: {
      id: definition.id,
      name: definition.name,
      url: SOURCE_URL(definition.pathname),
      status: "error",
      count: 0,
      mappedCount: 0,
      error: `Could not load source: ${errorMessage(cause)}`,
    },
  };
}

function aggregateStatus(statuses: SourceStatus[]): SourceStatus {
  if (statuses.every((status) => status === "ok")) return "ok";
  if (statuses.every((status) => status === "error")) return "error";
  if (statuses.every((status) => status === "stale")) return "stale";
  return "partial";
}

function buildLayer(id: RoadLayerId, loaded: LoadedSource[]): RoadConditionLayerInfo {
  // Counts come from each feature's own layer; feed attribution comes from the
  // declared feed→layer map, so a layer with zero current records (hazards)
  // still reports the health of the feeds that would populate it.
  const contributes = (result: LoadedSource) =>
    SOURCES.find((source) => source.id === result.source.id)?.layers.includes(id) ?? false;
  const features = loaded.flatMap((result) => result.features).filter((feature) => feature.properties.layer === id);
  const relevant = loaded.filter(contributes);
  const errors = relevant.flatMap((result) =>
    result.source.error ? [`${result.source.name}: ${result.source.error}`] : [],
  );
  return {
    id,
    count: features.length,
    mappedCount: features.filter((feature) => feature.geometry !== null).length,
    status: aggregateStatus(relevant.map((result) => result.source.status)),
    sources: relevant.map((result) => result.source),
    error: errors.length ? [...new Set(errors)].join("; ") : undefined,
  };
}

const LAYER_IDS: RoadLayerId[] = ["traffic-speed", "incidents", "hazards", "roadworks"];

/** Aggregate the six server-only DataMall feeds into four driver-facing layers. */
export async function getRoadConditions(): Promise<RoadConditionsResponse> {
  const loaded = await Promise.all(
    SOURCES.map(async (source) => {
      try {
        return await loadSource(source);
      } catch (cause) {
        return failedSource(source, cause);
      }
    }),
  );
  const layers = LAYER_IDS.map((id) => buildLayer(id, loaded));
  const status = aggregateStatus(layers.map((layer) => layer.status));
  const errors = layers.flatMap((layer) => (layer.error ? [layer.error] : []));
  return {
    generatedAt: new Date().toISOString(),
    status,
    fromCache: loaded.some((source) => source.fromCache),
    layers,
    // Only features that can actually be drawn are sent: the layer counts above
    // stay exact, but the ~9.8k permit records with no published coordinates no
    // longer cost 4 MB of JSON on every poll.
    features: loaded.flatMap((source) => source.features).filter((feature) => feature.geometry !== null),
    error: errors.length ? [...new Set(errors)].join("; ") : undefined,
  };
}

/** Exported for source panels/documentation without leaking an account key. */
export const ROAD_CONDITIONS_DOCUMENTATION_URL = DATAMALL_DOCS;
