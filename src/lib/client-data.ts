"use client";

import { normaliseDataGovTraffic, retargetSourcesForStatic } from "./traffic-images";
import type {
  CamerasResponse,
  RoadConditionLayerInfo,
  RoadConditionsResponse,
  RoadLayerId,
  TrafficImagesResponse,
} from "./types";

/**
 * Data access for the UI. The self-hosted build talks to this app's own API
 * routes (which hold the DataMall key server-side); the static GitHub Pages
 * build reads the baked camera snapshot and the keyless data.gov.sg mirror of
 * LTA's live image feed.
 */
export const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_MODE === "1";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const DATA_GOV_TRAFFIC = "https://api.data.gov.sg/v1/transport/traffic-images";

export async function loadCameras(options: { refresh?: boolean; signal?: AbortSignal } = {}) {
  const url = STATIC_MODE ? `${BASE}/data/cameras.json` : `/api/cameras${options.refresh ? "?refresh=1" : ""}`;
  const res = await fetch(url, { signal: options.signal, cache: STATIC_MODE ? "no-cache" : "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`);
  const data = body as CamerasResponse;
  return STATIC_MODE
    ? { ...data, layers: retargetSourcesForStatic(data.layers) as CamerasResponse["layers"] }
    : data;
}

export async function loadTrafficImages(signal?: AbortSignal): Promise<TrafficImagesResponse> {
  const generatedAt = new Date().toISOString();
  try {
    const url = STATIC_MODE ? DATA_GOV_TRAFFIC : "/api/traffic-images";
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!STATIC_MODE) return (await res.json()) as TrafficImagesResponse;
    const normalised = normaliseDataGovTraffic(await res.json());
    return { generatedAt, status: "ok", ...normalised };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { generatedAt, status: "error", error: (err as Error).message, cameras: [] };
  }
}

/** Every driver-facing layer, in panel priority order. */
const ROAD_LAYER_IDS: RoadLayerId[] = [
  "traffic-speed",
  "incidents",
  "hazards",
  "roadworks",
  "parking",
  "erp",
  "ev",
  "zones",
  "expressway",
];

function unavailableRoadConditions(error: string): RoadConditionsResponse {
  const layers: RoadConditionLayerInfo[] = ROAD_LAYER_IDS.map((id) => ({
    id,
    count: 0,
    mappedCount: 0,
    status: "error",
    sources: [],
    error,
  }));
  return {
    generatedAt: new Date().toISOString(),
    status: "error",
    fromCache: false,
    layers,
    features: [],
    error,
  };
}

/**
 * Load live road conditions without ever putting the DataMall key in a browser
 * bundle. GitHub Pages has no server-side proxy, so a static build reads the
 * snapshot baked at build time instead — one file per layer, so only the layers
 * switched on are downloaded, and reported as a cached copy rather than live.
 */
export async function loadRoadConditions(
  options: { signal?: AbortSignal; layers?: RoadLayerId[] } = {},
): Promise<RoadConditionsResponse> {
  if (STATIC_MODE) {
    try {
      const indexResponse = await fetch(`${BASE}/data/road-conditions/index.json`, {
        signal: options.signal,
        cache: "no-cache",
      });
      if (!indexResponse.ok) throw new Error(`HTTP ${indexResponse.status}`);
      const index = (await indexResponse.json()) as RoadConditionsResponse;
      const wanted = options.layers ?? ROAD_LAYER_IDS;
      const parts = await Promise.all(
        wanted.map(async (id) => {
          const response = await fetch(`${BASE}/data/road-conditions/${id}.json`, {
            signal: options.signal,
            cache: "no-cache",
          });
          if (!response.ok) return [];
          return ((await response.json()) as { features: RoadConditionsResponse["features"] }).features;
        }),
      );
      return {
        ...index,
        // A baked payload is never "live": say so, so the panel shows the cached
        // copy note next to the snapshot's own timestamp.
        status: "stale",
        fromCache: true,
        features: parts.flat(),
      };
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      return unavailableRoadConditions((error as Error).message);
    }
  }

  // Layer counts always come back in full; the feature list is narrowed to the
  // layers that are actually switched on. An empty list sends `?layers=` so an
  // "everything off" view fetches counts only.
  const query = options.layers ? `?layers=${options.layers.join(",")}` : "";
  try {
    const response = await fetch(`/api/road-conditions${query}`, {
      signal: options.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as RoadConditionsResponse;
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return unavailableRoadConditions((error as Error).message);
  }
}
