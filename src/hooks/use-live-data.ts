"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadCameras,
  loadRoadConditions,
  loadTrafficImages,
  STATIC_MODE,
} from "@/lib/client-data";
import type {
  CamerasResponse,
  RoadConditionsResponse,
  RoadLayerId,
  TrafficImagesResponse,
} from "@/lib/types";

/** Both live feeds are polled once a minute while the app is open. */
const TRAFFIC_POLL_MS = 60_000;
const ROAD_POLL_MS = 60_000;

/**
 * The camera inventory: loaded once, and reloaded when the panel asks to retry.
 * A retry clears the previous error first, so the panel shows the new attempt
 * instead of the old failure.
 */
export function useCameras() {
  const [cameras, setCameras] = useState<CamerasResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadCameras({ refresh: reloadKey > 0, signal: controller.signal })
      .then((data) => {
        setCameras(data);
        setError(null);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const retry = useCallback(() => {
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  return { cameras, error, retry };
}

/** Live traffic images for the snapshot layer, polled while the app is open. */
export function useTrafficImages() {
  const [traffic, setTraffic] = useState<TrafficImagesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setTraffic(await loadTrafficImages(signal));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((err: Error) => {
      if (err.name !== "AbortError") throw err;
    });
    const timer = setInterval(() => void load(), TRAFFIC_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  // The detail card retries one image by refreshing the whole feed, which is the
  // only way to get a fresh signed URL for it.
  return { traffic, loading, reload: load };
}

/**
 * Live road conditions for the layers that are switched on, so the default view
 * stays small. Toggling a layer changes this identity and refetches once; that is
 * serialised, and a reply that is no longer the newest is dropped, because an
 * older payload (from the poll or a retry) landing last would otherwise overwrite
 * the features of the layer just switched on and leave an icon reading "on" above
 * an empty map until the next poll.
 */
export function useRoadConditions(activeLayers: RoadLayerId[]) {
  const [roadConditions, setRoadConditions] = useState<RoadConditionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const busy = useRef(false);
  const queued = useRef<RoadLayerId[] | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (busy.current) {
      queued.current = activeLayers;
      return;
    }
    busy.current = true;
    try {
      let wanted = activeLayers;
      for (;;) {
        queued.current = null;
        const id = ++requestId.current;
        const next = await loadRoadConditions({ layers: wanted });
        // A newer request has already been issued; this reply is stale.
        if (id !== requestId.current) break;
        setRoadConditions((previous) => {
          if (next.status !== "error" || next.features.length > 0 || !previous?.features.length) {
            return next;
          }
          const message = next.error ?? "Live road conditions are temporarily unavailable";
          return {
            ...previous,
            status: "stale",
            fromCache: true,
            error: message,
            layers: previous.layers.map((layer) => ({
              ...layer,
              status: "stale",
              error: message,
            })),
          };
        });
        setError(next.status === "error" ? (next.error ?? null) : null);
        // A layer was switched while that request was in flight: fetch the set the
        // user is looking at now instead of leaving the map a layer behind.
        const pending = queued.current;
        if (!pending) break;
        wanted = pending;
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [activeLayers]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void load(), 0);
    // A static build reads one baked snapshot, so there is nothing to poll.
    const timer = STATIC_MODE ? undefined : setInterval(() => void load(), ROAD_POLL_MS);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [load]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    void load();
  }, [load]);

  return { roadConditions, loading, error, retry };
}
