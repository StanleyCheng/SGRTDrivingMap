"use client";

import { normaliseDataGovTraffic, retargetSourcesForStatic } from "./traffic-images";
import type { CamerasResponse, TrafficImagesResponse } from "./types";

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
