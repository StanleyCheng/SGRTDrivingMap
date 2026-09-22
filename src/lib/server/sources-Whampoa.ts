import { LAYERS } from "../layers";
import type {
  CameraPoint,
  CamerasResponse,
  LayerInfo,
  LayerSource,
  SourceStatus,
  TrafficCamera,
  TrafficImagesResponse,
} from "../types";
import { LTA_CAMERA_NAMES } from "../traffic-images";
import { ageMs, readDisk, readMemory, writeDisk, writeMemory } from "./cache";

/* ------------------------------------------------------------------ *
 * Upstream endpoints (all official, all real)
 * ------------------------------------------------------------------ */

/** data.gov.sg dataset ids — SPF enforcement cameras + LTA road cameras. */
export const DG_DATASETS = {
  /** Singapore Police Force Red Light Cameras (240 points). */
  rlc: "d_5f140c79c9dbee0bbb07c753afd788d8",
  /** Digital Traffic Red Light Cameras (same 240 locations, digital subset metadata). */
  dtrls: "d_0b7ddc0979dfc183e8b0e056878b14af",
  /** Fixed Speed Cameras (20 points). */
  fsc: "d_5fdeb9dccf757dbdf698240fed29f441",
  /** Police Speed Laser Cameras (48 points). */
  pslc: "d_763b60398a7749f793f1eae2fe97c775",
  /** Mobile Speed Cameras (3 points). */
  msc: "d_e411f01a5ac504f88434d7a02388c9ce",
  /**
   * "Location of Speed Cameras in Singapore" — the consolidated SPF list
   * (33 fixed incl. the 13 LTA-operated KPE/MCE cameras, 53 laser, 5 mobile).
   */
  speedList: "d_983804de2bc016f53e44031d85d1ec8a",
  /** LTA Road Camera — full camera-location inventory (254 points). */
  ltaRoadCam: "d_147f4906651f5b32925dfe6560296161",
} as const;

/** GeoJSON datasets that contribute speed-enforcement points, in fetch order. */
const SPEED_DATASETS: { key: keyof typeof DG_DATASETS; kind: CameraPoint["kind"] }[] = [
  { key: "fsc", kind: "fixed_speed" },
  { key: "pslc", kind: "laser_speed" },
  { key: "msc", kind: "mobile_speed" },
];

/** Consolidated CSV list: column value → camera kind. */
const CSV_KINDS: Record<string, CameraPoint["kind"]> = {
  "Fixed Speed Camera": "fixed_speed",
  "Police Speed Laser Cameras": "laser_speed",
  "Mobile Speed Camera": "mobile_speed",
};

/** Speed cameras LTA operates on the KPE and MCE (enforced by Traffic Police). */
const EXPRESSWAY_RE = /Kallang-Paya Lebar Expressway|Marina Coastal Expressway/i;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CAMERAS_KEY = "cameras";
const TRAFFIC_KEY = "traffic-images";
const CAMERAS_TTL = 6 * 60 * 60 * 1000; // static datasets change a few times a year
const TRAFFIC_TTL = 45 * 1000;

/* ------------------------------------------------------------------ *
 * Fetch primitives
 * ------------------------------------------------------------------ */

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function getJson(url: string, init?: RequestInit, timeoutMs = 20000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) {
      throw new UpstreamError(
        res.status === 429
          ? "Rate limited by data.gov.sg (HTTP 429)"
          : `HTTP ${res.status} from ${new URL(url).host}`,
        res.status,
      );
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * data.gov.sg allows roughly one anonymous request per 10s; serialise the whole
 * process with a gap so a cold refresh never trips HTTP 429.
 */
let dgChain: Promise<unknown> = Promise.resolve();
let dgLast = 0;
const DG_GAP = 11000;

function dgQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = dgChain.then(async () => {
    const wait = dgLast + DG_GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      dgLast = Date.now();
    }
  });
  dgChain = run.catch(() => {});
  return run;
}

/** Download a data.gov.sg dataset (poll-download → presigned S3 URL) as text. */
async function dgDownload(datasetId: string, attempt = 0): Promise<any> {
  try {
    const poll = await getJson(
      `https://api-open.data.gov.sg/v1/public/api/datasets/${datasetId}/poll-download`,
      { headers: { "x-api-key": "public", "User-Agent": BROWSER_UA, Accept: "*/*" } },
    );
    if (poll?.code !== 0 || !poll?.data?.url) {
      throw new UpstreamError(poll?.errorMsg ?? "data.gov.sg returned no download URL");
    }
    const res = await fetch(poll.data.url, { cache: "no-store" });
    if (!res.ok) throw new UpstreamError(`Dataset file download failed (HTTP ${res.status})`);
    return res.text();
  } catch (err) {
    const retriable = !(err instanceof UpstreamError) || err.status === 429;
    if (retriable && attempt < 2) {
      await new Promise((r) => setTimeout(r, 12000 * (attempt + 1)));
      return dgDownload(datasetId, attempt + 1);
    }
    throw err;
  }
}

async function dgJson(datasetId: string): Promise<any> {
  const text = await dgDownload(datasetId);
  return JSON.parse(String(text).replace(/^\uFEFF/, ""));
}

async function dgText(datasetId: string): Promise<string> {
  return String(await dgDownload(datasetId)).replace(/^\uFEFF/, "");
}

/** data.gov.sg catalogue metadata — no anonymous rate limit observed. */
async function dgMetadata(datasetId: string): Promise<any | null> {
  try {
    const j = await getJson(
      `https://api-production.data.gov.sg/v2/public/api/datasets/${datasetId}/metadata`,
      { headers: { "User-Agent": BROWSER_UA } },
      10000,
    );
    return j?.data ?? null;
  } catch {
    return null;
  }
}

function datamallKey() {
  const key = process.env.DATAMALL_ACCOUNT_KEY;
  if (!key) throw new UpstreamError("DATAMALL_ACCOUNT_KEY is not configured");
  return key;
}

async function datamall(pathname: string): Promise<any> {
  return getJson(`https://datamall2.mytransport.sg/ltaodataservice/${pathname}`, {
    headers: { AccountKey: datamallKey(), accept: "application/json", "User-Agent": BROWSER_UA },
  });
}

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** Great-circle distance in metres. */
function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function fromGeoJson(
  geojson: any,
  layer: CameraPoint["layer"],
  kind: CameraPoint["kind"],
): CameraPoint[] {
  const out: CameraPoint[] = [];
  for (const f of geojson?.features ?? []) {
    const p = f?.properties ?? {};
    const lat = Number(p.LATITUDE ?? f?.geometry?.coordinates?.[1]);
    const lng = Number(p.LONGITUDE ?? f?.geometry?.coordinates?.[0]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const ref = String(p.OBJECTID ?? p.ID ?? out.length + 1);
    out.push({
      id: `${kind}:${ref}`,
      layer,
      kind,
      lat: round(lat),
      lng: round(lng),
      road: String(p.ROAD_NAME ?? "").trim() || "—",
      direction: String(p.DIRECTION ?? "").trim() || undefined,
      desc: String(p.DESCP ?? "").trim() || undefined,
      ref,
    });
  }
  return out;
}

function fromSpeedCsv(text: string): CameraPoint[] {
  const out: CameraPoint[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (parts.length < 4) continue;
    const lat = Number(parts[parts.length - 2]);
    const lng = Number(parts[parts.length - 1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const type = parts[0].trim();
    const location = parts.slice(1, -2).join(",").trim();
    const baseKind = CSV_KINDS[type];
    if (!baseKind) continue;
    const [road, direction] = location.split(/\s+towards\s+/i);
    const kind: CameraPoint["kind"] =
      baseKind === "fixed_speed" && EXPRESSWAY_RE.test(location) ? "expressway_speed" : baseKind;
    out.push({
      id: `${kind}:csv-${out.length + 1}`,
      layer: "speed",
      kind,
      lat: round(lat),
      lng: round(lng),
      road: road.trim(),
      direction: direction?.trim(),
      desc: location,
      ref: `${type} #${out.length + 1}`,
    });
  }
  return out;
}

/** LTA road-camera inventory: KML-style features with UNIQUE_ID inside an HTML blob. */
function fromLtaRoadCameras(geojson: any): CameraPoint[] {
  const out: CameraPoint[] = [];
  for (const f of geojson?.features ?? []) {
    const c = f?.geometry?.coordinates;
    if (!c) continue;
    const m = /UNIQUE_ID<\/th>\s*<td>(\d+)<\/td>/.exec(f?.properties?.Description ?? "");
    const ref = m?.[1] ?? String(out.length + 1);
    out.push({
      id: `snapshot:${ref}`,
      layer: "snapshot",
      kind: "snapshot",
      lat: round(Number(c[1])),
      lng: round(Number(c[0])),
      road: "",
      ref,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Aggregation
 * ------------------------------------------------------------------ */

export interface CameraPayload {
  points: CameraPoint[];
  layers: LayerInfo[];
  /** Upstream dataset keys that failed during the last successful refresh. */
  failures: string[];
}

interface BuiltCameras {
  points: CameraPoint[];
  layers: LayerInfo[];
  failures: string[];
}

async function buildCameras(): Promise<BuiltCameras> {
  const failures: string[] = [];
  const points: CameraPoint[] = [];

  const sources: Record<string, LayerSource[]> = { redlight: [], speed: [], snapshot: [] };
  const status: Record<string, SourceStatus> = { redlight: "ok", speed: "ok", snapshot: "ok" };

  const push = (layer: CameraPoint["layer"], name: string, url: string, updatedAt?: string) => {
    sources[layer].push({ name, url, updatedAt });
  };

  const settle = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      failures.push(`${label}: ${(err as Error).message}`);
      return null;
    }
  };

  // --- Red-light cameras (RLC is a superset of DTRLS: same 240 locations) ---
  const rlcMeta = await settle("rlc-meta", () => dgMetadata(DG_DATASETS.rlc));
  const rlc = await settle("rlc", () => dgQueuedJson(DG_DATASETS.rlc));
  if (rlc) {
    points.push(...fromGeoJson(rlc, "redlight", "redlight"));
    push(
      "redlight",
      "Singapore Police Force — Red Light Cameras (RLC)",
      LAYERS[0].source[0].url,
      rlcMeta?.lastUpdatedAt,
    );
    const dtrlsMeta = await settle("dtrls-meta", () => dgMetadata(DG_DATASETS.dtrls));
    push(
      "redlight",
      "Singapore Police Force — Digital Traffic Red Light Cameras (DTRLS)",
      LAYERS[0].source[1].url,
      dtrlsMeta?.lastUpdatedAt,
    );
  } else {
    status.redlight = "error";
  }

  // --- Speed enforcement cameras: SPF GeoJSON datasets ∪ consolidated SPF list ---
  const geoPoints: CameraPoint[] = [];
  for (const { key, kind } of SPEED_DATASETS) {
    const id = DG_DATASETS[key];
    const def = LAYERS[1].source.find((s) => s.url.includes(id));
    const meta = await settle(`${key}-meta`, () => dgMetadata(id));
    const json = await settle(key, () => dgQueuedJson(id));
    if (json) {
      geoPoints.push(...fromGeoJson(json, "speed", kind));
      push("speed", `Singapore Police Force — ${def?.dataset ?? key}`, def?.url ?? "", meta?.lastUpdatedAt);
    } else {
      status.speed = status.speed === "error" ? "error" : "partial";
    }
  }

  const listMeta = await settle("speedlist-meta", () => dgMetadata(DG_DATASETS.speedList));
  const csv = await settle("speedlist", () => dgQueuedText(DG_DATASETS.speedList));
  if (csv) {
    const csvPoints = fromSpeedCsv(csv);
    // The consolidated list is the published superset (it includes the 13
    // LTA-operated KPE/MCE cameras); add only the GeoJSON points it lacks.
    const geoExtra = geoPoints.filter(
      (g) => !csvPoints.some((c) => c.kind === g.kind && metres(g.lat, g.lng, c.lat, c.lng) < 150),
    );
    points.push(...csvPoints, ...geoExtra);
    const def = LAYERS[1].source.find((s) => s.url.includes(DG_DATASETS.speedList));
    push(
      "speed",
      `Singapore Police Force — ${def?.dataset ?? "Location of Speed Cameras in Singapore"}`,
      def?.url ?? "",
      listMeta?.lastUpdatedAt,
    );
  } else {
    points.push(...geoPoints);
    status.speed = status.speed === "error" ? "error" : "partial";
  }

  // --- LTA road cameras (location inventory) ---
  const ltaMeta = await settle("lta-roadcam-meta", () => dgMetadata(DG_DATASETS.ltaRoadCam));
  const lta = await settle("lta-roadcam", () => dgQueuedJson(DG_DATASETS.ltaRoadCam));
  const staticSnapshots = lta ? fromLtaRoadCameras(lta) : [];
  points.push(...staticSnapshots);
  push(
    "snapshot",
    "Land Transport Authority — Road Camera locations",
    LAYERS[2].source[0].url,
    ltaMeta?.lastUpdatedAt,
  );
  if (!lta) status.snapshot = "error";

  // --- Live traffic images: flag matching cameras, add any not in the inventory ---
  const traffic = await settle("traffic-images", () => rawTrafficImages());
  if (traffic) {
    push(
      "snapshot",
      "Land Transport Authority — Traffic Images (live stills)",
      LAYERS[2].source[1].url,
      traffic.feedTimestamp,
    );
    for (const cam of traffic.cameras) {
      // Only the static inventory can absorb a live camera; two live cameras are
      // always distinct sites even when they sit a few metres apart.
      const near = staticSnapshots.find((p) => metres(p.lat, p.lng, cam.lat, cam.lng) < 60);
      if (near) {
        near.live = true;
        near.road = cam.name;
        near.ref = cam.cameraId;
      } else {
        points.push({
          id: `snapshot:live-${cam.cameraId}`,
          layer: "snapshot",
          kind: "snapshot",
          lat: round(cam.lat),
          lng: round(cam.lng),
          road: cam.name,
          ref: cam.cameraId,
          live: true,
        });
      }
    }
  } else {
    status.snapshot = status.snapshot === "error" ? "error" : "partial";
  }


  const layers: LayerInfo[] = LAYERS.map((def) => {
    const pts = points.filter((p) => p.layer === def.id);
    const kinds: Partial<Record<CameraPoint["kind"], number>> = {};
    for (const p of pts) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    return {
      id: def.id,
      sources: sources[def.id],
      count: pts.length,
      liveCount: def.id === "snapshot" ? pts.filter((p) => p.live).length : undefined,
      status: status[def.id],
      kinds,
    };
  });

  return { points, layers, failures };
}

const dgQueuedJson = (id: string) => dgQueue(() => dgJson(id));
const dgQueuedText = (id: string) => dgQueue(() => dgText(id));

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

async function loadCameras(): Promise<CameraPayload> {
  const built = await buildCameras();
  return { points: built.points, layers: built.layers, failures: built.failures };
}

/** Resolve cached cameras; refresh in the background when older than the TTL. */
export async function getCameras(opts: { force?: boolean } = {}): Promise<CamerasResponse> {
  let entry =
    readMemory<CameraPayload>(CAMERAS_KEY) ??
    (await readDisk<CameraPayload>(CAMERAS_KEY)) ??
    (await seedCameras());

  const stale = !entry || ageMs(entry) > CAMERAS_TTL;
  let fetchedNow = false;

  if (stale || opts.force) {
    if (opts.force || !entry) {
      try {
        const built = await loadCameras();
        entry = { data: built, generatedAt: new Date().toISOString() };
        fetchedNow = true;
        writeMemory(CAMERAS_KEY, entry);
        void writeDisk(CAMERAS_KEY, entry);
      } catch (err) {
        if (!entry) throw err;
      }
    } else {
      // Serve now, refresh behind the request.
      void loadCameras()
        .then((built) => {
          const fresh = { data: built, generatedAt: new Date().toISOString() };
          writeMemory(CAMERAS_KEY, fresh);
          return writeDisk(CAMERAS_KEY, fresh);
        })
        .catch(() => {});
    }
  }

  if (!entry) throw new UpstreamError("No camera data available from data.gov.sg");
  if (!readMemory(CAMERAS_KEY)) writeMemory(CAMERAS_KEY, entry);

  return {
    generatedAt: entry.generatedAt,
    fromCache: stale && !fetchedNow,
    layers: entry.data.layers,
    points: entry.data.points,
  };
}

/** Bundled copy of a real refresh, so the first page load is never empty. */
async function seedCameras() {
  try {
    const mod = await import("@/data/cameras-seed.json");
    const seed = mod.default as unknown as { generatedAt: string; data: CameraPayload };
    return { data: seed.data, generatedAt: seed.generatedAt };
  } catch {
    return null;
  }
}

export interface RawTraffic {
  feedTimestamp?: string;
  cameras: TrafficCamera[];
}

async function rawTrafficImages(): Promise<RawTraffic> {
  const j = await datamall("Traffic-Imagesv2");
  const cameras: TrafficCamera[] = [];
  for (const c of j?.value ?? []) {
    const id = String(c.CameraID ?? "");
    const lat = Number(c.Latitude);
    const lng = Number(c.Longitude);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng) || !c.ImageLink) continue;
    cameras.push({
      cameraId: id,
      name: LTA_CAMERA_NAMES[id] ?? `LTA camera ${id}`,
      lat: round(lat),
      lng: round(lng),
      imageUrl: String(c.ImageLink),
      imageTime: new Date().toISOString(),
    });
  }
  return { cameras, feedTimestamp: new Date().toISOString() };
}

export async function getTrafficImages(): Promise<TrafficImagesResponse> {
  const cached = readMemory<RawTraffic>(TRAFFIC_KEY) ?? (await readDisk<RawTraffic>(TRAFFIC_KEY));
  if (cached && ageMs(cached) <= TRAFFIC_TTL) {
    return {
      generatedAt: cached.generatedAt,
      feedTimestamp: cached.data.feedTimestamp,
      status: "ok",
      cameras: cached.data.cameras,
    };
  }
  try {
    const raw = await rawTrafficImages();
    const entry = {
      data: { ...raw, feedTimestamp: new Date().toISOString() },
      generatedAt: new Date().toISOString(),
    };
    writeMemory(TRAFFIC_KEY, entry);
    void writeDisk(TRAFFIC_KEY, entry);
    return {
      generatedAt: entry.generatedAt,
      feedTimestamp: entry.data.feedTimestamp,
      status: "ok",
      cameras: entry.data.cameras,
    };
  } catch (err) {
    if (cached) {
      return {
        generatedAt: cached.generatedAt,
        feedTimestamp: cached.data.feedTimestamp,
        status: "stale",
        error: (err as Error).message,
        cameras: cached.data.cameras,
      };
    }
    return {
      generatedAt: new Date().toISOString(),
      status: "error",
      error: (err as Error).message,
      cameras: [],
    };
  }
}
