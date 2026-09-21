"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { DetailPanel, type DetailImage } from "@/components/detail-panel";
import { LayerPanel } from "@/components/layer-panel";
import { SourcesPanel } from "@/components/sources-panel";
import { useI18n } from "@/components/i18n-provider";
import type { MapFocus } from "@/components/MapView";
import { loadCameras, loadTrafficImages } from "@/lib/client-data";
import type { CameraPoint, CamerasResponse, LayerId, TrafficImagesResponse } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full rounded-none" />,
});

const ALL_ON: Record<LayerId, boolean> = { redlight: true, speed: true, snapshot: true };
const TRAFFIC_POLL_MS = 60_000;

export default function App() {
  const { t } = useI18n();
  const [cameras, setCameras] = useState<CamerasResponse | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [traffic, setTraffic] = useState<TrafficImagesResponse | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const [active, setActive] = useState<Record<LayerId, boolean>>(ALL_ON);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [mobile, setMobile] = useState(false);

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
    void loadTraffic(controller.signal);
    const timer = setInterval(() => void loadTraffic(), TRAFFIC_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [loadTraffic]);

  /* ---------------- responsive defaults ---------------- */
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const mq = window.matchMedia("(max-width: 640px)");
    setMobile(mq.matches);
    setCollapsed(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const pointMap = useMemo(() => new Map((cameras?.points ?? []).map((p) => [p.id, p])), [cameras]);
  const selected = selectedId ? (pointMap.get(selectedId) ?? null) : null;
  const selectedLayer = useMemo(
    () => cameras?.layers.find((l) => l.id === selected?.layer) ?? null,
    [cameras, selected],
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
      if (point) focusOn(point, mobile ? 16 : undefined);
    },
    [focusOn, mobile],
  );

  const toggleLayer = useCallback((id: LayerId) => {
    setActive((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const showDetail = Boolean(selected);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-paper">
      <MapView
        points={cameras?.points ?? []}
        active={active}
        selectedId={selectedId}
        onSelect={select}
        focus={focus}
        className="absolute inset-0 h-full w-full"
      />

      {/* header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-2 sm:justify-start sm:p-4">
        <AppHeader onOpenSources={() => setSourcesOpen(true)} className="pointer-events-auto" />
      </div>

      {/* layer control — bottom sheet on mobile, floating card on desktop */}
      <div
        className={`absolute z-30 flex transition-transform duration-300 ease-out ${showDetail && mobile ? "translate-y-[110%]" : "translate-y-0"} inset-x-0 bottom-0 justify-center p-2 sm:inset-x-auto sm:bottom-4 sm:left-4 sm:top-[104px] sm:justify-start sm:p-0`}
      >
        <LayerPanel
          layers={cameras?.layers ?? null}
          active={active}
          onToggle={toggleLayer}
          loading={!cameras && !cameraError}
          error={cameraError}
          generatedAt={cameras?.generatedAt ?? null}
          fromCache={cameras?.fromCache ?? false}
          onRetry={() => {
            setCameraError(null);
            setReloadKey((k) => k + 1);
          }}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          className="max-h-[68vh] sm:max-h-[calc(100dvh-160px)]"
        />
      </div>

      {/* detail — floating card on desktop, bottom sheet on mobile */}
      <div
        className={`absolute z-40 inset-x-0 bottom-0 flex justify-center p-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:justify-end sm:p-0 ${
          showDetail ? "rise" : "pointer-events-none hidden"
        }`}
      >
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
      </div>

      {/* live-traffic freshness footer */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 hidden -translate-x-1/2 md:block">
        <div className="panel pointer-events-auto flex items-center gap-2 px-3 py-1.5">
          <span
            className={`inline-block size-1.5 rounded-full ${
              traffic?.status === "ok" ? "pulse bg-[var(--c-snapshot)]" : "bg-[var(--muted)]"
            }`}
          />
          <span className="label text-muted">{t("traffic.title")}</span>
          <span className="num text-[11px] text-ink-2">
            {traffic?.cameras.length ?? 0} {t("common.liveImages")}
          </span>
          <span className="text-[11px] text-muted">
            {traffic?.feedTimestamp
              ? `${t("traffic.feed")} ${new Date(traffic.feedTimestamp).toLocaleTimeString("en-GB", {
                  hour12: false,
                  timeZone: "Asia/Singapore",
                })} SGT`
              : traffic?.error
                ? t("traffic.error")
                : t("status.loading")}
          </span>
        </div>
      </div>

      <SourcesPanel layers={cameras?.layers ?? null} open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
    </div>
  );
}
