"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { DetailPanel, type DetailImage } from "@/components/detail-panel";
import { LayerPanel } from "@/components/layer-panel";
import { RoadConditionDetail } from "@/components/road-condition-detail";
import { SourcesPanel } from "@/components/sources-panel";
import type { BasemapId, MapFocus } from "@/components/MapView";
import {
  loadCameras,
  loadRoadConditions,
  loadTrafficImages,
  STATIC_MODE,
} from "@/lib/client-data";
import { geometryFocus, geometryZoom } from "@/lib/geometry";
import { ROAD_LAYER_ORDER } from "@/lib/layers";
import { withCurrentTrafficCameras } from "@/lib/traffic-images";
import {
  DEFAULT_LAYER_FILTERS,
  type CameraPoint,
  type CamerasResponse,
  type LayerFilters,
  type LayerId,
  type RoadConditionFeature,
  type RoadConditionsResponse,
  type RoadLayerId,
  type TrafficImagesResponse,
} from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full rounded-none" />,
});

// Layers 1 and 2 (live congestion, and accident/breakdown alerts) are the
// default view per the agreed layer priority; the other seven start switched off.
const ROAD_DEFAULTS: Record<RoadLayerId, boolean> = {
  "traffic-speed": true,
  incidents: true,
  hazards: false,
  roadworks: false,
  parking: false,
  erp: false,
  ev: false,
  zones: false,
  expressway: false,
};
// The four live road layers need the DataMall key, so a static build has none of
// them. Defaulting every camera layer off as well would open on an empty map,
// so in static mode the camera layers carry the default view instead.
// Camera layers never carry the default view, in any build. The agreed default is
// driver layers 1 and 2 (live congestion, accidents & breakdowns) on and every
// other layer — including these three camera layers — off.
const ALL_ON: Record<LayerId, boolean> = { redlight: false, speed: false, snapshot: false };
const TRAFFIC_POLL_MS = 60_000;
const ROAD_POLL_MS = 60_000;
const BASEMAP_STORAGE_KEY = "sgdi.basemap";

export default function App() {
  const [basemap, setBasemap] = useState<BasemapId>("osm");
  const [cameras, setCameras] = useState<CamerasResponse | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [traffic, setTraffic] = useState<TrafficImagesResponse | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const [roadConditions, setRoadConditions] = useState<RoadConditionsResponse | null>(null);
  const [roadLoading, setRoadLoading] = useState(true);
  const [roadError, setRoadError] = useState<string | null>(null);
  const [active, setActive] = useState<Record<LayerId, boolean>>(ALL_ON);
  const [roadActive, setRoadActive] = useState<Record<RoadLayerId, boolean>>(ROAD_DEFAULTS);
  const [incidentRoute, setIncidentRoute] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRoadId, setSelectedRoadId] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [filters, setFilters] = useState<LayerFilters>(DEFAULT_LAYER_FILTERS);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [mobile, setMobile] = useState(false);

  /* ---------------- basemap preference ---------------- */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(BASEMAP_STORAGE_KEY);
      if (stored === "positron") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time persisted preference after hydration
        setBasemap("positron");
      }
    } catch {
      /* private mode */
    }
  }, []);

  const toggleBasemap = useCallback(() => {
    setBasemap((current) => {
      const next: BasemapId = current === "osm" ? "positron" : "osm";
      try {
        window.localStorage.setItem(BASEMAP_STORAGE_KEY, next);
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);

  /* ---------------- cameras ---------------- */
  useEffect(() => {
    const controller = new AbortController();
    loadCameras({ refresh: reloadKey > 0, signal: controller.signal })
      .then((data) => {
        setCameras(data);
        setCameraError(null);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setCameraError(err.message);
      });
    return () => controller.abort();
  }, [reloadKey]);

  /* ---------------- live traffic images ---------------- */
  const loadTraffic = useCallback(async (signal?: AbortSignal) => {
    try {
      setTraffic(await loadTrafficImages(signal));
    } finally {
      setTrafficLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadTraffic(controller.signal).catch((err: Error) => {
      if (err.name !== "AbortError") throw err;
    });
    const timer = setInterval(() => void loadTraffic(), TRAFFIC_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [loadTraffic]);

  /* ---------------- live road conditions ---------------- */
  // Only the layers that are switched on are fetched, so the default view stays
  // small. Toggling a layer changes this identity and refetches once.
  const activeRoadLayers = useMemo(
    () => ROAD_LAYER_ORDER.filter((id) => roadActive[id]),
    [roadActive],
  );

  // Toggling refetches with the new layer set. Serialise that, and drop a reply that
  // is no longer the newest: an older payload (from the poll or a retry) landing last
  // would otherwise overwrite the features of the layer just switched on, leaving an
  // icon that reads "on" above an empty map until the next poll.
  const roadsBusy = useRef(false);
  const roadsQueued = useRef<RoadLayerId[] | null>(null);
  const roadsRequestId = useRef(0);

  const loadRoads = useCallback(async () => {
    if (roadsBusy.current) {
      roadsQueued.current = activeRoadLayers;
      return;
    }
    roadsBusy.current = true;
    try {
      let wanted = activeRoadLayers;
      for (;;) {
        roadsQueued.current = null;
        const requestId = ++roadsRequestId.current;
        const next = await loadRoadConditions({ layers: wanted });
        // A newer request has already been issued; this reply is stale.
        if (requestId !== roadsRequestId.current) break;
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
        setRoadError(next.status === "error" ? (next.error ?? null) : null);
        // A layer was switched while that request was in flight: fetch the set the
        // user is looking at now instead of leaving the map a layer behind.
        const queued = roadsQueued.current;
        if (!queued) break;
        wanted = queued;
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") setRoadError((error as Error).message);
    } finally {
      roadsBusy.current = false;
      setRoadLoading(false);
    }
  }, [activeRoadLayers]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadRoads(), 0);
    // A static build reads one baked snapshot, so there is nothing to poll.
    const timer = STATIC_MODE ? null : setInterval(() => void loadRoads(), ROAD_POLL_MS);
    return () => {
      clearTimeout(initialTimer);
      if (timer) clearInterval(timer);
    };
  }, [loadRoads]);

  /* ---------------- responsive defaults ---------------- */
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const mq = window.matchMedia("(max-width: 640px)");
    setMobile(mq.matches);
    // The rail opens visible everywhere and is retracted on demand; starting it
    // collapsed hid the whole control behind a chip.
    setCollapsed(false);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const visibleCameras = useMemo(
    () => (cameras ? withCurrentTrafficCameras(cameras, traffic) : null),
    [cameras, traffic],
  );
  const pointMap = useMemo(
    () => new Map((visibleCameras?.points ?? []).map((p) => [p.id, p])),
    [visibleCameras],
  );
  const selected = selectedId ? (pointMap.get(selectedId) ?? null) : null;
  const selectedLayer = useMemo(
    () => visibleCameras?.layers.find((l) => l.id === selected?.layer) ?? null,
    [visibleCameras, selected],
  );
  const roadFeatureMap = useMemo(
    () => new Map((roadConditions?.features ?? []).map((feature) => [feature.id, feature])),
    [roadConditions],
  );
  const selectedRoad = selectedRoadId ? (roadFeatureMap.get(selectedRoadId) ?? null) : null;
  const selectedRoadLayer = useMemo(
    () => roadConditions?.layers.find((layer) => layer.id === selectedRoad?.properties.layer) ?? null,
    [roadConditions, selectedRoad],
  );

  /* ---------------- resolve the live image for the selection ---------------- */
  const image: DetailImage | null = useMemo(() => {
    if (!selected || selected.kind !== "snapshot" || !traffic) return null;
    const match =
      traffic.cameras.find((c) => c.cameraId === selected.ref) ??
      traffic.cameras.find(
        (c) =>
          Math.abs(c.lat - selected.lat) < 0.0015 && Math.abs(c.lng - selected.lng) < 0.0015,
      );
    return match ? { url: match.imageUrl, capturedAt: match.imageTime } : null;
  }, [selected, traffic]);

  const imageStatus: "loading" | "ok" | "error" | "none" = useMemo(() => {
    if (!selected || selected.kind !== "snapshot") return "none";
    if (image) return "ok";
    if (trafficLoading) return "loading";
    if (traffic?.status === "error") return "error";
    return "none";
  }, [selected, image, trafficLoading, traffic]);

  const focusOn = useCallback(
    (point: CameraPoint, zoom?: number) => {
      setFocus({
        lat: point.lat,
        lng: point.lng,
        zoom,
        key: `${point.id}:${Date.now()}`,
        padding: mobile ? { bottom: 340 } : { right: 400 },
      });
    },
    [mobile],
  );

  const select = useCallback(
    (point: CameraPoint | null) => {
      setSelectedId(point?.id ?? null);
      if (point) setSelectedRoadId(null);
      if (point) focusOn(point, mobile ? 16 : undefined);
    },
    [focusOn, mobile],
  );

  const focusOnRoad = useCallback(
    (feature: RoadConditionFeature, zoom?: number) => {
      const centre = geometryFocus(feature.geometry);
      if (!centre) return;
      setFocus({
        lat: centre.lat,
        lng: centre.lng,
        zoom: zoom ?? geometryZoom(feature.geometry),
        key: `${feature.id}:${Date.now()}`,
        padding: mobile ? { bottom: 320 } : { right: 400 },
      });
    },
    [mobile],
  );

  const updateFilters = useCallback((patch: Partial<LayerFilters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
  }, []);

  const selectRoad = useCallback(
    (feature: RoadConditionFeature | null) => {
      setSelectedRoadId(feature?.id ?? null);
      if (feature) {
        setSelectedId(null);
        focusOnRoad(feature);
      }
    },
    [focusOnRoad],
  );

  const toggleLayer = useCallback((id: LayerId) => {
    setActive((prev) => ({ ...prev, [id]: !prev[id] }));
    setSelectedId((current) => {
      const selectedPoint = current ? pointMap.get(current) : null;
      return selectedPoint?.layer === id ? null : current;
    });
  }, [pointMap]);

  const toggleRoadLayer = useCallback((id: RoadLayerId) => {
    setRoadActive((previous) => ({ ...previous, [id]: !previous[id] }));
    setSelectedRoadId((current) => {
      const selectedFeature = current ? roadFeatureMap.get(current) : null;
      return selectedFeature?.properties.layer === id ? null : current;
    });
  }, [roadFeatureMap]);

  const showDetail = Boolean(selected || selectedRoad);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-paper">
      <MapView
        basemap={basemap}
        points={visibleCameras?.points ?? []}
        active={active}
        selectedId={selectedId}
        onSelect={select}
        roadFeatures={roadConditions?.features ?? []}
        roadActive={roadActive}
        layerFilters={filters}
        incidentRoute={incidentRoute}
        selectedRoadId={selectedRoadId}
        onRoadSelect={selectRoad}
        focus={focus}
        className="absolute inset-0 h-full w-full"
      />

      {/* header */}
      {/* Left-aligned so the retracted bar keeps the app icon exactly where it was. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-start p-2 sm:p-4">
        <AppHeader
          basemap={basemap}
          onToggleBasemap={toggleBasemap}
          onOpenSources={() => setSourcesOpen(true)}
          className="pointer-events-auto"
        />
      </div>

      {/* layer control — docked bottom-centre on both platforms; it retracts while a
          detail card is open, because the card can grow to the bottom of the window */}
      <div
        className={`absolute z-30 flex transition-transform duration-300 ease-out ${showDetail ? "translate-y-[110%]" : "translate-y-0"} inset-x-0 bottom-[2px] justify-center p-2 sm:bottom-4 sm:p-0`}
      >
        <LayerPanel
          layers={visibleCameras?.layers ?? null}
          active={active}
          onToggle={toggleLayer}
          loading={!cameras && !cameraError}
          error={cameraError}
          generatedAt={cameras?.generatedAt ?? null}
          onRetry={() => {
            setCameraError(null);
            setReloadKey((k) => k + 1);
          }}
          roadConditions={roadConditions}
          roadActive={roadActive}
          onRoadToggle={toggleRoadLayer}
          incidentRoute={incidentRoute}
          onIncidentRouteChange={setIncidentRoute}
          roadLoading={roadLoading}
          roadError={roadError}
          onRoadRetry={() => {
            setRoadError(null);
            setRoadLoading(true);
            void loadRoads();
          }}
          roadAvailable
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          mobile={mobile}
          filters={filters}
          onFilterChange={updateFilters}
          className={`max-h-[68vh] sm:max-h-[calc(100dvh-160px)] ${mobile ? "!w-full !rounded-b-none" : ""}`}
        />
      </div>

      {/* detail — floating card on desktop, bottom sheet on mobile */}
      <div
        className={`absolute z-40 inset-x-0 bottom-0 flex justify-center p-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:justify-end sm:p-0 ${
          showDetail ? "rise" : "pointer-events-none hidden"
        }`}
      >
        {selectedRoad ? (
          <RoadConditionDetail
            feature={selectedRoad}
            layer={selectedRoadLayer}
            onClose={() => setSelectedRoadId(null)}
            onZoom={(feature) => focusOnRoad(feature)}
            className="max-h-[70vh] sm:max-h-[calc(100dvh-32px)]"
          />
        ) : (
          <DetailPanel
            point={selected}
            layer={selectedLayer}
            image={image}
            imageStatus={imageStatus}
            imageError={traffic?.error ?? null}
            onClose={() => setSelectedId(null)}
            onZoom={(p) => focusOn(p, 17)}
            onRetryImage={() => void loadTraffic()}
            className="max-h-[70vh] sm:max-h-[calc(100dvh-32px)]"
          />
        )}
      </div>

      {/* The live-image freshness chip that used to sit here was removed: it covered
          the map and repeated what the snapshot camera layer already shows. */}

      <SourcesPanel
        basemap={basemap}
        layers={visibleCameras?.layers ?? null}
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
      />
    </div>
  );
}
