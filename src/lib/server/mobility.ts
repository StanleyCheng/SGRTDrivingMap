import erpZones from "@/data/erp-zones.json";
import type { RoadConditionFeature, RoadPosition } from "../types";
import { ageMs, readDisk, readMemory, writeDisk, writeMemory, type CacheEntry } from "./cache";
import {
  asNumber,
  asText,
  dataMallUrl,
  featureId,
  fetchDataMallAll,
  fetchDataMallLink,
  fetchDataMallPage,
  hash,
  isRawRecord,
  point,
  type RawRecord,
  type SourceDefinition,
} from "./feeds";
import { datamall, dgJson, dgQueue, dgText } from "./upstream";

/**
 * Layers 5–9: the route-aware extras.
 *
 * Five official upstreams, none of them invented:
 *  - LTA Carpark Availability v2 (live lots) joined to HDB Carpark Information
 *    (published gantry height) by the official carpark code.
 *  - LTA's published ERP gantry geometry, plus LTA's ERP rate table when the
 *    DataMall rate endpoint answers; the zone names come from the published
 *    gantry/zone table (ANNEX D of the DataMall API guide).
 *  - LTA EV Charging Points Batch (live availability, connector, power).
 *  - LTA School Zone / Silver Zone boundaries (data.gov.sg GeoJSON).
 *  - LTA Estimated Travel Times and VMS/EMAS messages.
 */

/** data.gov.sg datasets that need no account key. */
const DG = {
  /** LTA School Zone boundaries (211 polygons). */
  schoolZone: "d_abf023b38d9bc451484e3d67b562bc5c",
  /** LTA Silver Zone boundaries (20 polygons). */
  silverZone: "d_dc343c021aa470fc71da90d31e552a9a",
  /** LTA Gantry — the published ERP gantry geometry (106 spans). */
  erpGantry: "d_753090823cc9920ac41efaa6530c5893",
  /** HDB Carpark Information — carries the published gantry height. */
  hdbCarpark: "d_23f946fa557947f93a8043bbef41dd09",
} as const;

const DG_URL = (id: string) => `https://data.gov.sg/datasets/${id}/view`;

/** Statutory zone speed limits (Road Traffic (Speed Limits) Rules). */
const SCHOOL_ZONE_LIMIT_KMH = 40;
const SILVER_ZONE_LIMIT_KMH = 40;

/* ------------------------------------------------------------------ *
 * Parsing helpers
 * ------------------------------------------------------------------ */

/** LTA's data.gov.sg GeoJSON is KML-converted: attributes live in an HTML table. */
function kmlAttributes(description: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of asText(description).matchAll(
    /<th[^>]*>([^<]+)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
  )) {
    out[match[1].trim()] = match[2]
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return out;
}

/** A GeoJSON position may carry a third (Z) ordinate; keep lng/lat only. */
function toPosition(value: unknown): RoadPosition | undefined {
  if (!Array.isArray(value)) return undefined;
  return point(asNumber(value[0]), asNumber(value[1]));
}

function toLine(value: unknown): RoadPosition[] {
  if (!Array.isArray(value)) return [];
  return value.map(toPosition).filter((position): position is RoadPosition => Boolean(position));
}

function toPolygon(value: unknown): RoadPosition[][] {
  if (!Array.isArray(value)) return [];
  return value
    .map((ring) => toLine(ring))
    .filter((ring) => ring.length >= 4);
}

function geometryOf(record: RawRecord) {
  const geometry = record.geometry;
  if (!isRawRecord(geometry)) return null;
  return geometry;
}

/** Minimal RFC-4180-ish CSV row splitter: quoted fields may contain commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

/* ------------------------------------------------------------------ *
 * 5 · Parking — live lots + published gantry height
 * ------------------------------------------------------------------ */

const HDB_GANTRY_KEY = "hdb-carpark-gantry";
const HDB_GANTRY_TTL = 24 * 60 * 60 * 1000;

function parseGantryHeights(text: string): Map<string, number> {
  const heights = new Map<string, number>();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? "").map((cell) => cell.trim());
  const noIndex = header.indexOf("car_park_no");
  const heightIndex = header.indexOf("gantry_height");
  if (noIndex < 0 || heightIndex < 0) return heights;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const code = (cells[noIndex] ?? "").trim();
    const height = Number((cells[heightIndex] ?? "").trim());
    if (code && Number.isFinite(height) && height > 0) heights.set(code, height);
  }
  return heights;
}

/**
 * The gantry-height table changes only when HDB rebuilds a carpark, so it is
 * cached for a day rather than re-downloaded on every one-minute lot refresh.
 */
async function hdbGantryHeights(): Promise<Map<string, number>> {
  const cached =
    readMemory<Record<string, number>>(HDB_GANTRY_KEY) ??
    (await readDisk<Record<string, number>>(HDB_GANTRY_KEY));
  if (cached && ageMs(cached) <= HDB_GANTRY_TTL) return new Map(Object.entries(cached.data));
  try {
    const map = parseGantryHeights(await dgQueue(() => dgText(DG.hdbCarpark)));
    const entry: CacheEntry<Record<string, number>> = {
      data: Object.fromEntries(map),
      generatedAt: new Date().toISOString(),
    };
    writeMemory(HDB_GANTRY_KEY, entry);
    void writeDisk(HDB_GANTRY_KEY, entry);
    return map;
  } catch {
    // The lot feed still works without heights; never fail the layer for this.
    return cached ? new Map(Object.entries(cached.data)) : new Map();
  }
}

/** LTA publishes `Location` as a single "lat lng" string for this feed. */
function parseCarparkLocation(value: unknown): RoadPosition | undefined {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/.exec(asText(value));
  if (!match) return undefined;
  return point(Number(match[2]), Number(match[1]));
}

async function fetchCarparks(): Promise<RawRecord[]> {
  const [lots, heights] = await Promise.all([fetchDataMallAll("CarParkAvailabilityv2"), hdbGantryHeights()]);
  return lots.map((record) => ({
    ...record,
    GantryHeightM: heights.get(asText(record.CarParkID)) ?? "",
  }));
}

/** LTA lot types are a published code, not a free label. */
export const LOT_TYPE_LABEL: Record<string, string> = {
  C: "Cars",
  H: "Heavy vehicles",
  Y: "Motorcycles",
};

export function normaliseCarparks(records: RawRecord[]): RoadConditionFeature[] {
  const features: RoadConditionFeature[] = [];
  for (const record of records) {
    const carparkId = asText(record.CarParkID);
    const lotType = asText(record.LotType).toUpperCase();
    if (!carparkId || !lotType) continue;
    const development = asText(record.Development) || asText(record.Area) || `Carpark ${carparkId}`;
    const area = asText(record.Area);
    const availableLots = asNumber(record.AvailableLots);
    const gantryHeightM = asNumber(record.GantryHeightM);
    const coordinates = parseCarparkLocation(record.Location);
    features.push({
      type: "Feature",
      id: featureId("parking-lot", `${carparkId}:${lotType}`, `${carparkId}:${lotType}`),
      geometry: coordinates ? { type: "Point", coordinates } : null,
      properties: {
        layer: "parking",
        kind: "parking-lot",
        title: `${development} · ${LOT_TYPE_LABEL[lotType] ?? lotType}`,
        road: development,
        sourceId: carparkId,
        agency: asText(record.Agency) || undefined,
        availableLots,
        lotType,
        gantryHeightM,
        development,
        area: area || undefined,
      },
    });
  }
  return features;
}

/* ------------------------------------------------------------------ *
 * 6 · ERP — published gantry geometry + rate table
 * ------------------------------------------------------------------ */

const ZONE_BY_ID = new Map<string, { zoneId: string; location: string }[]>();
for (const zone of (erpZones as { zones: { zoneId: string; gantryNo: number; location: string }[] }).zones) {
  const list = ZONE_BY_ID.get(zone.zoneId) ?? [];
  list.push({ zoneId: zone.zoneId, location: zone.location });
  ZONE_BY_ID.set(zone.zoneId, list);
}

function zoneLocation(zoneId: string) {
  const list = ZONE_BY_ID.get(zoneId.toUpperCase());
  if (!list?.length) return undefined;
  return list.map((entry) => entry.location).join(" / ");
}

async function fetchErpGantries(): Promise<RawRecord[]> {
  const geojson = await dgQueue(() => dgJson(DG.erpGantry));
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  return features.filter(isRawRecord);
}

export function normaliseErpGantries(records: RawRecord[]): RoadConditionFeature[] {
  const features: RoadConditionFeature[] = [];
  for (const record of records) {
    const geometry = geometryOf(record);
    if (!geometry || asText(geometry.type) !== "LineString") continue;
    const coordinates = toLine(geometry.coordinates);
    if (coordinates.length < 2) continue;
    const attributes = kmlAttributes((record.properties as RawRecord | undefined)?.Description);
    const number = attributes.GNTRY_NUM;
    const uniqueId = attributes.UNIQUE_ID || hash(JSON.stringify(coordinates));
    features.push({
      type: "Feature",
      id: featureId("erp-gantry", uniqueId, JSON.stringify(coordinates)),
      geometry: { type: "LineString", coordinates },
      properties: {
        layer: "erp",
        kind: "erp-gantry",
        // The published gantry number is often blank or "UNK"; the KML name is
        // just "kml_1", so it is never shown as if it were a real identifier.
        title: number && number !== "UNK" ? `ERP gantry ${number}` : "ERP gantry",
        sourceId: uniqueId,
        agency: "LTA",
      },
    });
  }
  return features;
}

/** LTA restarted publishing ERP rates as a static table in Sep 2024. */
async function fetchErpRates(): Promise<RawRecord[]> {
  // The live ERPRates route still answers behind DataMall auth; when it refuses,
  // the layer reports the failure and the UI links to the official table rather
  // than showing a guessed charge.
  const payload = await datamall("ERPRates");
  const rows = Array.isArray((payload as { value?: unknown })?.value)
    ? ((payload as { value: unknown[] }).value.filter(isRawRecord))
    : Array.isArray((payload as { ERP?: unknown })?.ERP)
      ? ((payload as { ERP: unknown[] }).ERP.filter(isRawRecord))
      : [];
  if (!rows.length) throw new Error("LTA DataMall returned no ERP rate rows");
  const flat: RawRecord[] = [];
  for (const record of rows) {
    // Newer payloads nest the per-window rates; the classic shape is flat.
    const rates = record.Rates;
    if (Array.isArray(rates)) {
      for (const rate of rates) if (isRawRecord(rate)) flat.push({ ...record, ...rate });
      continue;
    }
    flat.push(record);
  }
  return flat;
}

/** Minutes since midnight in Singapore, for matching the published windows. */
function singaporeMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [hour, minute] = parts.split(":").map(Number);
  return hour * 60 + minute;
}

function hhmm(value: unknown): number | undefined {
  const match = /^(\d{1,2}):(\d{2})/.exec(asText(value));
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

function dayTypeMatches(dayType: string, weekday: number) {
  const value = dayType.toLowerCase();
  if (/holiday/.test(value)) return false; // A public-holiday calendar is not published with the feed.
  if (/sun/.test(value)) return weekday === 0;
  if (/sat/.test(value)) return weekday === 6;
  if (/weekday|mon/.test(value)) return weekday >= 1 && weekday <= 5;
  // No day type published: treat the window as applicable rather than dropping it.
  return true;
}

const SGT_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", weekday: "short" });
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Singapore weekday index (0 = Sunday), so the published day type can be matched. */
function singaporeWeekday(now = new Date()) {
  return WEEKDAY_INDEX[SGT_DAY.format(now)] ?? now.getDay();
}

export function normaliseErpRates(records: RawRecord[]): RoadConditionFeature[] {
  const now = new Date();
  const weekdayIndex = singaporeWeekday(now);
  const minutesNow = singaporeMinutes(now);

  interface Window {
    start: number;
    end: number;
    charge: number;
    vehicleType: string;
  }
  const byZone = new Map<string, Window[]>();
  for (const record of records) {
    const zoneId = asText(record.ZoneID ?? record.zoneId).toUpperCase();
    const start = hhmm(record.StartTime ?? record.startTime);
    const end = hhmm(record.EndTime ?? record.endTime);
    const charge = asNumber(record.ChargeAmount ?? record.Fee ?? record.charge);
    if (!zoneId || start === undefined || end === undefined || charge === undefined) continue;
    if (!dayTypeMatches(asText(record.DayType ?? record.dayType), weekdayIndex)) continue;
    const list = byZone.get(zoneId) ?? [];
    list.push({ start, end, charge, vehicleType: asText(record.VehicleType) || "Passenger cars" });
    byZone.set(zoneId, list);
  }

  const features: RoadConditionFeature[] = [];
  for (const [zoneId, windows] of byZone) {
    windows.sort((a, b) => a.start - b.start);
    const current = windows.find((window) => window.start <= minutesNow && minutesNow < window.end);
    const next = windows.find((window) => window.start > minutesNow);
    const location = zoneLocation(zoneId) ?? zoneId;
    features.push({
      type: "Feature",
      id: featureId("erp-rate", zoneId, zoneId),
      // The rate table is a zone schedule, not a map location.
      geometry: null,
      properties: {
        layer: "erp",
        kind: "erp-rate",
        title: location,
        road: location,
        sourceId: zoneId,
        zoneId,
        vehicleType: current?.vehicleType ?? next?.vehicleType,
        charge: current?.charge,
        chargeWindow:
          current !== undefined ? `${clock(current.start)}–${clock(current.end)}` : undefined,
        nextCharge: next?.charge,
        nextWindow: next !== undefined ? `${clock(next.start)}–${clock(next.end)}` : undefined,
        agency: "LTA",
      },
    });
  }
  return features;
}

function clock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ *
 * 7 · EV charging — live availability by connector and power
 * ------------------------------------------------------------------ */

/** One row per (location, connector, power) so both filters stay exact. */
interface EvRow extends RawRecord {
  locationId: string;
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  plugType: string;
  powerRatingKw?: number;
  chargingSpeedKw?: number;
  operatorName: string;
  totalPoints: number;
  availablePoints: number;
}

function extractEvLocations(body: unknown): RawRecord[] {
  const value = isRawRecord(body) ? (body.value ?? body) : undefined;
  const locations = isRawRecord(value) ? value.evLocationsData : undefined;
  if (!Array.isArray(locations)) return [];
  return locations.filter(isRawRecord);
}

async function fetchEvChargers(): Promise<RawRecord[]> {
  return fetchDataMallLink("EVCBatch", (body) => flattenEvLocations(extractEvLocations(body)));
}

/** Collapse the nested chargingPoints/plugTypes tree into one row per connector. */
export function flattenEvLocations(locations: RawRecord[]): EvRow[] {
  const rows: EvRow[] = [];
  for (const location of locations) {
    const locationId = asText(location.locationId) || hash(JSON.stringify(location));
    const name = asText(location.name) || asText(location.address) || `EV charger ${locationId}`;
    const lat = asNumber(location.latitude);
    const lng = asNumber(location.longitude ?? location.longtitude);
    const groups = new Map<
      string,
      {
        plugType: string;
        powerRatingKw?: number;
        chargingSpeedKw?: number;
        operator: string;
        total: number;
        available: number;
      }
    >();
    const chargingPoints = Array.isArray(location.chargingPoints) ? location.chargingPoints : [];
    for (const charger of chargingPoints) {
      if (!isRawRecord(charger)) continue;
      const operator = asText(charger.operator);
      const plugTypes = Array.isArray(charger.plugTypes) ? charger.plugTypes : [];
      for (const plug of plugTypes) {
        if (!isRawRecord(plug)) continue;
        const plugType = asText(plug.plugType) || "Unknown connector";
        // The live feed publishes the rating in `powerRating` (kW). The API guide
        // also documents a separate `chargingSpeed`; read it when present rather
        // than assuming which one a given deployment fills in.
        const powerRatingKw = asNumber(plug.powerRating);
        const chargingSpeedKw = asNumber(plug.chargingSpeed);
        const evIds = Array.isArray(plug.evIds) ? plug.evIds.filter(isRawRecord) : [];
        const total = evIds.length;
        // Published status codes: 0 occupied, 1 available, 100 not available.
        const available = evIds.filter((ev) => asText(ev.status) === "1").length;
        const key = `${plugType}|${powerRatingKw ?? ""}`;
        const group =
          groups.get(key) ??
          { plugType, powerRatingKw, chargingSpeedKw, operator, total: 0, available: 0 };
        group.total += total;
        group.available += available;
        if (group.powerRatingKw === undefined) group.powerRatingKw = powerRatingKw;
        if (group.chargingSpeedKw === undefined) group.chargingSpeedKw = chargingSpeedKw;
        if (!group.operator && operator) group.operator = operator;
        groups.set(key, group);
      }
    }
    for (const group of groups.values()) {
      rows.push({
        locationId,
        name,
        address: asText(location.address),
        lat,
        lng,
        plugType: group.plugType,
        powerRatingKw: group.powerRatingKw,
        chargingSpeedKw: group.chargingSpeedKw,
        operatorName: group.operator,
        totalPoints: group.total,
        availablePoints: group.available,
      });
    }
  }
  return rows;
}

export function normaliseEvChargers(records: RawRecord[]): RoadConditionFeature[] {
  const features: RoadConditionFeature[] = [];
  for (const record of records) {
    const row = record as unknown as EvRow;
    const plugType = asText(row.plugType);
    if (!plugType) continue;
    const coordinates = point(row.lng, row.lat);
    features.push({
      type: "Feature",
      id: featureId(
        "ev-charger",
        `${row.locationId}:${plugType}:${row.powerRatingKw ?? ""}`,
        `${row.locationId}:${plugType}`,
      ),
      geometry: coordinates ? { type: "Point", coordinates } : null,
      properties: {
        layer: "ev",
        kind: "ev-charger",
        title: row.name,
        road: row.address || row.name,
        sourceId: row.locationId,
        plugType,
        powerRatingKw: row.powerRatingKw,
        chargingSpeedKw: row.chargingSpeedKw,
        operatorName: row.operatorName || undefined,
        availablePoints: row.availablePoints,
        totalPoints: row.totalPoints,
        agency: "LTA",
      },
    });
  }
  return features;
}

/* ------------------------------------------------------------------ *
 * 8 · School & silver zones
 * ------------------------------------------------------------------ */

function zoneFeatures(
  records: RawRecord[],
  kind: "school-zone" | "silver-zone",
  speedLimitKmh: number,
): RoadConditionFeature[] {
  const features: RoadConditionFeature[] = [];
  for (const record of records) {
    const geometry = geometryOf(record);
    if (!geometry) continue;
    const type = asText(geometry.type);
    // One published zone can be several parcels (MultiPolygon). Each parcel is
    // drawn so no part of the official boundary is silently dropped.
    const polygons: RoadPosition[][][] = [];
    if (type === "Polygon") {
      const polygon = toPolygon(geometry.coordinates);
      if (polygon.length) polygons.push(polygon);
    } else if (type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
      for (const part of geometry.coordinates) {
        const polygon = toPolygon(part);
        if (polygon.length) polygons.push(polygon);
      }
    }
    if (!polygons.length) continue;
    const properties = (record.properties ?? {}) as RawRecord;
    const attributes = kmlAttributes(properties.Description);
    const name = attributes.SITENAME || asText(properties.Name) || kind;
    const sourceId = attributes.INC_CRC || attributes.UNIQUE_ID || hash(name);
    polygons.forEach((coordinates, index) => {
      features.push({
        type: "Feature",
        id: featureId(kind, polygons.length > 1 ? `${sourceId}:${index}` : sourceId, name),
        geometry: { type: "Polygon", coordinates },
        properties: {
          layer: "zones",
          kind,
          title: name,
          road: name,
          sourceId,
          zoneType: kind === "school-zone" ? "School zone" : "Silver zone",
          speedLimitKmh,
          agency: "LTA",
        },
      });
    });
  }
  return features;
}

const fetchSchoolZones = async () => {
  const geojson = await dgQueue(() => dgJson(DG.schoolZone));
  return (Array.isArray(geojson?.features) ? geojson.features : []).filter(isRawRecord);
};

const fetchSilverZones = async () => {
  const geojson = await dgQueue(() => dgJson(DG.silverZone));
  return (Array.isArray(geojson?.features) ? geojson.features : []).filter(isRawRecord);
};

/* ------------------------------------------------------------------ *
 * 9 · Expressway travel times + EMAS messages
 * ------------------------------------------------------------------ */

/** LTA publishes direction as a code; 1 is east→west / south→north. */
function directionLabel(direction: unknown) {
  const value = asNumber(direction);
  if (value === 1) return "east to west / south to north";
  if (value === 2) return "west to east / north to south";
  return undefined;
}

export function normaliseTravelTimes(records: RawRecord[]): RoadConditionFeature[] {
  return records.map((record) => {
    const corridor = asText(record.Name) || "Expressway";
    const direction = asNumber(record.Direction);
    const startPoint = asText(record.StartPoint) || undefined;
    const endPoint = asText(record.EndPoint) || undefined;
    const farEndPoint = asText(record.FarEndPoint) || undefined;
    const estMinutes = asNumber(record.EstTime);
    const identity = [corridor, direction, startPoint, endPoint, farEndPoint].join("\u001f");
    return {
      type: "Feature",
      id: featureId("travel-time", hash(identity), identity),
      // The official feed is a corridor segment list with no coordinates.
      geometry: null,
      properties: {
        layer: "expressway",
        kind: "travel-time",
        title: `${corridor} · ${startPoint ?? ""} → ${endPoint ?? ""}`.trim(),
        road: corridor,
        sourceId: hash(identity),
        corridor,
        directionLabel: directionLabel(direction),
        startPoint,
        endPoint,
        farEndPoint,
        estMinutes,
        agency: "LTA",
      },
    } satisfies RoadConditionFeature;
  });
}

export function normaliseEmasMessages(records: RawRecord[]): RoadConditionFeature[] {
  const features: RoadConditionFeature[] = [];
  for (const record of records) {
    const message = asText(record.Message);
    // A blank signboard is not an advisory; do not pad the banner with it.
    if (!message) continue;
    const coordinates = point(asNumber(record.Longitude), asNumber(record.Latitude));
    const equipmentId = asText(record.EquipmentID);
    features.push({
      type: "Feature",
      id: featureId("emas-message", equipmentId || hash(message), message),
      geometry: coordinates ? { type: "Point", coordinates } : null,
      properties: {
        layer: "expressway",
        kind: "emas-message",
        title: message,
        description: message,
        sourceId: equipmentId || hash(message),
        equipmentId: equipmentId || undefined,
        agency: "LTA",
      },
    });
  }
  return features;
}

/* ------------------------------------------------------------------ *
 * Feed definitions
 * ------------------------------------------------------------------ */

const HOUR = 60 * 60 * 1000;

export const MOBILITY_SOURCES: SourceDefinition[] = [
  {
    id: "carpark-availability",
    layers: ["parking"],
    name: "LTA Carpark Availability v2 (+ HDB carpark gantry heights)",
    url: dataMallUrl("CarParkAvailabilityv2"),
    ttlMs: HOUR,
    maxStaleMs: 6 * HOUR,
    fetch: fetchCarparks,
    normalise: normaliseCarparks,
  },
  {
    id: "erp-gantry",
    layers: ["erp"],
    name: "LTA Gantry (ERP spans, data.gov.sg)",
    url: DG_URL(DG.erpGantry),
    ttlMs: 24 * 60 * 60 * 1000,
    maxStaleMs: 30 * 24 * 60 * 60 * 1000,
    fetch: fetchErpGantries,
    normalise: normaliseErpGantries,
  },
  {
    id: "erp-rates",
    layers: ["erp"],
    name: "LTA ERP Rates (DataMall) + published zone table (ANNEX D)",
    url: dataMallUrl("ERPRates"),
    ttlMs: 6 * HOUR,
    maxStaleMs: 24 * HOUR,
    fetch: fetchErpRates,
    normalise: normaliseErpRates,
  },
  {
    id: "ev-charging",
    layers: ["ev"],
    name: "LTA EV Charging Points Batch",
    url: dataMallUrl("EVCBatch"),
    ttlMs: 5 * 60 * 1000,
    maxStaleMs: 30 * 60 * 1000,
    fetch: fetchEvChargers,
    normalise: normaliseEvChargers,
  },
  {
    id: "school-zone",
    layers: ["zones"],
    name: "LTA School Zone (data.gov.sg)",
    url: DG_URL(DG.schoolZone),
    ttlMs: 24 * 60 * 60 * 1000,
    maxStaleMs: 30 * 24 * 60 * 60 * 1000,
    fetch: fetchSchoolZones,
    normalise: (records) => zoneFeatures(records, "school-zone", SCHOOL_ZONE_LIMIT_KMH),
  },
  {
    id: "silver-zone",
    layers: ["zones"],
    name: "LTA Silver Zone (data.gov.sg)",
    url: DG_URL(DG.silverZone),
    ttlMs: 24 * 60 * 60 * 1000,
    maxStaleMs: 30 * 24 * 60 * 60 * 1000,
    fetch: fetchSilverZones,
    normalise: (records) => zoneFeatures(records, "silver-zone", SILVER_ZONE_LIMIT_KMH),
  },
  {
    id: "travel-time",
    layers: ["expressway"],
    name: "LTA Estimated Travel Times",
    url: dataMallUrl("EstTravelTimes"),
    ttlMs: 5 * 60 * 1000,
    maxStaleMs: 30 * 60 * 1000,
    fetch: () => fetchDataMallPage("EstTravelTimes"),
    normalise: normaliseTravelTimes,
  },
  {
    id: "emas",
    layers: ["expressway"],
    name: "LTA VMS / EMAS",
    url: dataMallUrl("VMS"),
    ttlMs: 2 * 60 * 1000,
    maxStaleMs: 10 * 60 * 1000,
    fetch: () => fetchDataMallPage("VMS"),
    normalise: normaliseEmasMessages,
  },
];
