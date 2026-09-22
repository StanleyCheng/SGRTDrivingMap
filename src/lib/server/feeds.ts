import type {
  RoadConditionFeature,
  RoadConditionLayerInfo,
  RoadConditionKind,
  RoadConditionSourceId,
  RoadConditionSourceStatus,
  RoadLayerId,
  RoadPosition,
  SourceStatus,
} from "../types";
import { ageMs, readDisk, readMemory, writeDisk, writeMemory, type CacheEntry } from "./cache";
import { DATAMALL_BASE, UpstreamError, datamall } from "./upstream";

/**
 * Generic machinery shared by every driver-facing overlay: DataMall pagination,
 * memory→disk caching with a source TTL, stale-but-recent fallback, and
 * per-layer aggregation.
 *
 * A "source" is one upstream feed. One feed can populate several layers (LTA's
 * Traffic Incidents feed does), and one layer can be fed by several sources.
 */

export const PAGE_SIZE = 500;
// TrafficSpeedBands v4 published 143,787 links on 22 Sep 2026 and grows over
// time, so the cap must stay well clear of the real feed — it exists only to
// stop an upstream runaway, not as a working limit.
export const MAX_PAGES = 320;

export type RawRecord = Record<string, unknown>;

export interface SourceDefinition {
  id: RoadConditionSourceId;
  /** Every driver-facing layer this feed contributes features to. */
  layers: RoadLayerId[];
  name: string;
  /** Public documentation/attribution URL surfaced in the UI. */
  url: string;
  ttlMs: number;
  /** Old safety data must not remain visible indefinitely after failures. */
  maxStaleMs: number;
  /** Fetch the raw upstream records (already flattened to one record per row). */
  fetch: () => Promise<RawRecord[]>;
  normalise: (records: RawRecord[]) => RoadConditionFeature[];
}

export interface LoadedSource {
  features: RoadConditionFeature[];
  source: RoadConditionSourceStatus;
  fromCache: boolean;
}

/* ------------------------------------------------------------------ *
 * Parsing helpers
 * ------------------------------------------------------------------ */

export const asText = (value: unknown) => (value == null ? "" : String(value).trim());
export const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
export const asNumber = (value: unknown) => {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};
export const round = (number: number) => Math.round(number * 1e6) / 1e6;
export const isRawRecord = (value: unknown): value is RawRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Wide enough to include Singapore's outlying road links while rejecting
// zeroes, swapped coordinates, and unrelated global positions.
export const SINGAPORE_BOUNDS = {
  minLng: 103.4,
  maxLng: 104.1,
  minLat: 1.15,
  maxLat: 1.5,
} as const;

export function point(lng: number | undefined, lat: number | undefined): RoadPosition | undefined {
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
export function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function featureId(kind: RoadConditionKind, sourceId: string, fallback: string) {
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

/* ------------------------------------------------------------------ *
 * DataMall fetchers
 * ------------------------------------------------------------------ */

export const dataMallUrl = (pathname: string) => `${DATAMALL_BASE}/${pathname}`;

/** DataMall limits normal responses to 500 rows; exhaust the documented `$skip` pages. */
export async function fetchDataMallAll(pathname: string): Promise<RawRecord[]> {
  const records: RawRecord[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const skip = page * PAGE_SIZE;
    const payload = await datamall(`${pathname}${skip > 0 ? `?$skip=${skip}` : ""}`);
    const value = (payload as { value?: unknown })?.value;
    if (!Array.isArray(value)) throw new UpstreamError("LTA DataMall returned an unexpected response");
    const pageRecords = value.filter(isRawRecord);
    records.push(...pageRecords);
    if (value.length < PAGE_SIZE) return records;
  }
  throw new UpstreamError(`LTA DataMall response exceeded ${MAX_PAGES * PAGE_SIZE} records`);
}

/** Endpoints that return one page only (travel times, EMAS, incident snapshots). */
export async function fetchDataMallPage(pathname: string): Promise<RawRecord[]> {
  const payload = await datamall(pathname);
  const value = (payload as { value?: unknown })?.value;
  if (!Array.isArray(value)) throw new UpstreamError("LTA DataMall returned an unexpected response");
  return value.filter(isRawRecord);
}

/**
 * Some DataMall feeds publish a short-lived presigned `Link` instead of inline
 * rows (EV Charging Points Batch). Resolve the link, then hand the parsed body
 * to `extract`, which owns the feed-specific shape.
 */
export async function fetchDataMallLink(pathname: string, extract: (body: unknown) => RawRecord[]) {
  const payload = await datamall(pathname);
  const link = (payload as { value?: { Link?: unknown }[] })?.value?.[0]?.Link;
  if (typeof link !== "string" || !link) {
    throw new UpstreamError("LTA DataMall returned no download link");
  }
  const response = await fetch(link, { cache: "no-store" });
  if (!response.ok) throw new UpstreamError(`DataMall batch download failed (HTTP ${response.status})`);
  return extract(await response.json());
}

/* ------------------------------------------------------------------ *
 * Caching
 * ------------------------------------------------------------------ */

const inflight = new Map<RoadConditionSourceId, Promise<CacheEntry<RawRecord[]>>>();

function refreshSource(definition: SourceDefinition) {
  const running = inflight.get(definition.id);
  if (running) return running;
  const cacheKey = `road-condition-${definition.id}`;
  const task = definition
    .fetch()
    .then((data) => {
      const entry = { data, generatedAt: new Date().toISOString() };
      writeMemory(cacheKey, entry);
      void writeDisk(cacheKey, entry);
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
      url: definition.url,
      status,
      count: features.length,
      mappedCount,
      // Records the upstream published, before this app's drawing scope applied.
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
      url: definition.url,
      status: "error",
      count: 0,
      mappedCount: 0,
      error: `Could not load source: ${errorMessage(cause)}`,
    },
  };
}

/** Load every feed independently: one dead upstream must not blank the map. */
export async function loadSources(definitions: SourceDefinition[]): Promise<LoadedSource[]> {
  return Promise.all(
    definitions.map(async (definition) => {
      try {
        return await loadSource(definition);
      } catch (cause) {
        return failedSource(definition, cause);
      }
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Aggregation
 * ------------------------------------------------------------------ */

export function aggregateStatus(statuses: SourceStatus[]): SourceStatus {
  if (statuses.length === 0) return "ok";
  if (statuses.every((status) => status === "ok")) return "ok";
  if (statuses.every((status) => status === "error")) return "error";
  if (statuses.every((status) => status === "stale")) return "stale";
  return "partial";
}

export function buildLayer(
  id: RoadLayerId,
  definitions: SourceDefinition[],
  loaded: LoadedSource[],
): RoadConditionLayerInfo {
  // Counts come from each feature's own layer; feed attribution comes from the
  // declared feed→layer map, so a layer with zero current records (hazards)
  // still reports the health of the feeds that would populate it.
  const features = loaded
    .flatMap((result) => result.features)
    .filter((feature) => feature.properties.layer === id);
  const relevant = loaded.filter((result) =>
    definitions.find((source) => source.id === result.source.id)?.layers.includes(id),
  );
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

/**
 * Layers whose unmapped records would be huge and are already counted in the
 * panel (the road-works permit register is ~10k rows). Everything else keeps
 * its coordinate-free records so the UI can still list them.
 */
const MAPPED_ONLY: RoadLayerId[] = ["roadworks"];

/** Only features that can be drawn or listed in the UI are sent to the browser. */
export function featuresForClient(loaded: LoadedSource[]): RoadConditionFeature[] {
  return loaded
    .flatMap((source) => source.features)
    .filter((feature) => feature.geometry !== null || !MAPPED_ONLY.includes(feature.properties.layer));
}
