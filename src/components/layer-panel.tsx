"use client";

import { useState, type CSSProperties } from "react";
import type { StringKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { LAYERS } from "@/lib/layers";
import type {
  LayerId,
  LayerInfo,
  RoadConditionFeature,
  RoadConditionsResponse,
  RoadLayerId,
  SourceStatus,
} from "@/lib/types";
import { useI18n } from "./i18n-provider";

export interface LayerPanelProps {
  layers: LayerInfo[] | null;
  active: Record<LayerId, boolean>;
  onToggle: (id: LayerId) => void;
  loading: boolean;
  error: string | null;
  generatedAt: string | null;
  fromCache: boolean;
  onRetry: () => void;
  roadConditions: RoadConditionsResponse | null;
  roadActive: Record<RoadLayerId, boolean>;
  onRoadToggle: (id: RoadLayerId) => void;
  /** Route filter for the incident alert icons (null = every route). */
  incidentRoute: string | null;
  onIncidentRouteChange: (route: string | null) => void;
  roadLoading: boolean;
  roadError: string | null;
  onRoadRetry: () => void;
  roadAvailable: boolean;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  className?: string;
}

const UNIT: Record<LayerId, StringKey> = {
  redlight: "common.locations",
  speed: "common.locations",
  snapshot: "common.cameras",
};

const STATUS_STYLE: Record<Exclude<SourceStatus, "ok">, { key: StringKey; color: string }> = {
  error: { key: "status.error", color: "var(--err)" },
  partial: { key: "status.partial", color: "var(--warn)" },
  stale: { key: "status.stale", color: "var(--warn)" },
};

/** Layer priority: the four live road-condition layers come first. */
const ROAD_LAYERS: { id: RoadLayerId; color: string }[] = [
  { id: "traffic-speed", color: "var(--c-traffic)" },
  { id: "incidents", color: "var(--c-incident)" },
  { id: "hazards", color: "var(--c-hazard)" },
  { id: "roadworks", color: "var(--c-roadworks)" },
];

function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      <path d="M6 3.4 L11.6 13.2 H0.4 Z" fill="none" stroke="var(--c-speed)" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="7.6" y="7.4" width="9.4" height="9.4" rx="2.2" fill="none" stroke="var(--c-snapshot)" strokeWidth="1.5" />
      <circle cx="6.4" cy="12.4" r="2.8" fill="var(--c-redlight)" />
    </svg>
  );
}

function Glyph({ id, color }: { id: LayerId; color: string }) {
  const common = { fill: "none", stroke: color, strokeWidth: 2.1 } as const;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 shrink-0">
      {id === "redlight" && (
        <>
          <circle cx="10" cy="10" r="6" {...common} />
          <circle cx="10" cy="10" r="2" fill={color} />
        </>
      )}
      {id === "speed" && <path d="M10 3.4 L17 16.4 H3 Z" {...common} strokeLinejoin="round" />}
      {id === "snapshot" && (
        <>
          <rect x="3" y="4.6" width="14" height="10.8" rx="2.4" {...common} />
          <circle cx="10" cy="10" r="2.2" fill={color} />
        </>
      )}
    </svg>
  );
}

function RoadGlyph({ id, size = 20 }: { id: RoadLayerId; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {id === "traffic-speed" && (
        <>
          <path d="M2 5.5h16M2 10h16M2 14.5h16" />
          <path d="M5 3.5v4M10 8v4M15 12.5v4" opacity=".45" />
        </>
      )}
      {id === "incidents" && (
        <>
          <path d="M10 2.5 18 17H2L10 2.5Z" />
          <path d="M10 7v4.5M10 14.2v.1" />
        </>
      )}
      {id === "hazards" && (
        <>
          <path d="M10 1.8 18.2 10 10 18.2 1.8 10 10 1.8Z" />
          <path d="M10 5.8v5.2M10 14v.1" />
        </>
      )}
      {id === "roadworks" && (
        <>
          <path d="M3 6.5h14v7H3zM5.5 6.5l3 7M11.5 6.5l3 7M5 13.5 3.8 18M15 13.5l1.2 4.5" />
        </>
      )}
    </svg>
  );
}

function Switch({
  on,
  color,
  label,
  onClick,
  disabled = false,
}: {
  on: boolean;
  color: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="relative h-10 w-10 shrink-0 self-center rounded-full disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span
        className="absolute inset-x-0 top-2 h-6 rounded-full border transition-colors"
        style={{ background: on ? color : "var(--line-strong)", borderColor: on ? color : "var(--line-strong)" }}
      >
        <span
          className="absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-surface shadow-sm transition-transform"
          style={{ transform: on ? "translateX(16px)" : "none" }}
        />
      </span>
    </button>
  );
}

function SpeedLegend() {
  const { t } = useI18n();
  return (
    <div className="atlas-speed-legend mt-2" aria-label={t("legend.title")}>
      <span style={{ "--speed-color": "var(--c-traffic-free)" } as CSSProperties}><i />{t("road.legend.clear")}<b>60+ km/h</b></span>
      <span style={{ "--speed-color": "var(--c-traffic-moderate)" } as CSSProperties}><i />{t("road.legend.moderate")}<b>40–59 km/h</b></span>
      <span style={{ "--speed-color": "var(--c-traffic-heavy)" } as CSSProperties}><i />{t("road.legend.heavy")}<b>20–39 km/h</b></span>
      <span style={{ "--speed-color": "var(--c-traffic-severe)" } as CSSProperties}><i />{t("road.legend.severe")}<b>0–19 km/h</b></span>
    </div>
  );
}

/** Routes LTA names in the live incident messages, most affected first. */
function routeOptions(features: RoadConditionFeature[]) {
  const counts = new Map<string, number>();
  for (const feature of features) {
    if (feature.properties.layer !== "incidents") continue;
    const route = feature.properties.route;
    if (route) counts.set(route, (counts.get(route) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

interface RoadInfoProps {
  id: RoadLayerId;
  info: RoadConditionsResponse["layers"][number] | undefined;
  features: RoadConditionFeature[];
  active: boolean;
  status: { key: StringKey; color: string } | null;
  incidentRoute: string | null;
  onIncidentRouteChange: (route: string | null) => void;
}

/** The layer's own detail — shown inline on desktop and in the mobile popup. */
function RoadLayerInfo({
  id,
  info,
  features,
  active,
  status,
  incidentRoute,
  onIncidentRouteChange,
}: RoadInfoProps) {
  const { t } = useI18n();
  const routes = id === "incidents" && active ? routeOptions(features) : [];
  const upstream = info?.sources.reduce((max, source) => Math.max(max, source.upstreamCount ?? 0), 0) ?? 0;

  return (
    <>
      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-muted">
        <span className="num font-semibold text-ink-2">{info?.mappedCount ?? "—"}</span>
        <span>{t("common.mapped")}</span>
        {info && <span>· {info.count} {t("common.reports")}</span>}
        {status && <span style={{ color: status.color }}>· {t(status.key)}</span>}
      </span>

      {id === "hazards" && Boolean(info?.count) && (
        <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--c-hazard)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--c-hazard)]">
          <span className="pulse h-1.5 w-1.5 rounded-full bg-[var(--c-hazard)]" />
          {t("road.panel.activeNow")}
        </span>
      )}

      {id === "traffic-speed" && active && <SpeedLegend />}
      {id === "traffic-speed" && upstream > 0 && (
        <span className="mt-1.5 block text-[9px] leading-relaxed text-muted">
          {t("road.panel.coverage", { n: upstream.toLocaleString("en-GB") })}
        </span>
      )}

      {routes.length > 0 && (
        <span className="mt-2 block">
          <label className="label mb-1 block text-[9px] text-muted" htmlFor={`route-${id}`}>
            {t("road.filter.route")}
          </label>
          <select
            id={`route-${id}`}
            value={incidentRoute ?? ""}
            onChange={(event) => onIncidentRouteChange(event.target.value || null)}
            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[11px] text-ink"
          >
            <option value="">{t("road.filter.allRoutes")}</option>
            {routes.map(([route, count]) => (
              <option key={route} value={route}>
                {route} ({count})
              </option>
            ))}
          </select>
        </span>
      )}
    </>
  );
}

interface LayerRowProps {
  id: LayerId | RoadLayerId;
  color: string;
  name: string;
  note: string;
  active: boolean;
  disabled: boolean;
  status: { key: StringKey; color: string } | null;
  onToggle: () => void;
  onRetry: () => void;
  /** Headline count + badges for camera layers. */
  children?: React.ReactNode;
  detail?: React.ReactNode;
}

function LayerRow({
  id,
  color,
  name,
  note,
  active,
  disabled,
  status,
  onToggle,
  onRetry,
  children,
  detail,
}: LayerRowProps) {
  const { t } = useI18n();
  return (
    <li
      data-layer={id}
      data-active={active && !disabled}
      className="atlas-layer p-3"
      style={{ "--layer-color": color } as CSSProperties}
    >
      <div className="flex gap-2.5">
        <span className="atlas-layer-glyph" style={{ color }}>
          {"redlight" === id || "speed" === id || "snapshot" === id ? (
            <Glyph id={id as LayerId} color={color} />
          ) : (
            <RoadGlyph id={id as RoadLayerId} />
          )}
        </span>
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-label={`${t(active ? "panel.off" : "panel.on")}: ${name}`}
          className="min-w-0 flex-1 pt-0.5 text-left disabled:cursor-not-allowed"
        >
          <span className="block text-[13px] font-semibold">{name}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted)]">{note}</span>
          {children}
          {detail}
        </button>
        <Switch
          on={active && !disabled}
          color={color}
          label={`${t(active ? "panel.off" : "panel.on")}: ${name}`}
          onClick={onToggle}
          disabled={disabled}
        />
      </div>
      {status && (
        <div className="mt-2 flex items-center gap-2 pl-8">
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ color: status.color, background: `color-mix(in srgb, ${status.color} 12%, transparent)` }}
          >
            {t(status.key)}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="text-[10px] font-semibold underline underline-offset-2"
            style={{ color: status.color }}
          >
            {t("status.retry")}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Mobile presentation: one coloured icon per layer in a compact rail. Tapping an
 * icon opens that layer's own panel as a popup, so the phone never has to show
 * all nine rows at once.
 */
function MobileLayerRail({
  layers,
  active,
  roadConditions,
  roadActive,
  incidentRoute,
  onIncidentRouteChange,
  onToggle,
  onRoadToggle,
  roadAvailable,
  loading,
}: {
  layers: LayerInfo[] | null;
  active: Record<LayerId, boolean>;
  roadConditions: RoadConditionsResponse | null;
  roadActive: Record<RoadLayerId, boolean>;
  incidentRoute: string | null;
  onIncidentRouteChange: (route: string | null) => void;
  onToggle: (id: LayerId) => void;
  onRoadToggle: (id: RoadLayerId) => void;
  roadAvailable: boolean;
  loading: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<LayerId | RoadLayerId | null>(null);
  const features = roadConditions?.features ?? [];

  if (!roadAvailable) {
    // Static builds have no road-condition feeds at all; keep the original list.
    return null;
  }

  const entries: {
    id: LayerId | RoadLayerId;
    color: string;
    name: string;
    note: string;
    on: boolean;
    count: number | null;
  }[] = [
    ...ROAD_LAYERS.map((def) => {
      const info = roadConditions?.layers.find((layer) => layer.id === def.id);
      return {
        id: def.id,
        color: def.color,
        name: t(`road.layer.${def.id}.name`),
        note: t(`road.layer.${def.id}.note`),
        on: roadActive[def.id],
        count: info ? info.mappedCount : null,
      };
    }),
    ...LAYERS.map((def) => {
      const info = layers?.find((layer) => layer.id === def.id);
      return {
        id: def.id,
        color: def.color,
        name: t(`layer.${def.id}.name`),
        note: t(`layer.${def.id}.note`),
        on: active[def.id],
        count: info ? info.count : null,
      };
    }),
  ];

  const openEntry = entries.find((entry) => entry.id === open) ?? null;

  return (
    <>
      <ul className="atlas-rail" aria-label={t("panel.title")}>
        {entries.map((entry) => {
          const isRoad = ROAD_LAYERS.some((def) => def.id === entry.id);
          const info = isRoad
            ? roadConditions?.layers.find((layer) => layer.id === entry.id)
            : undefined;
          const disabled =
            isRoad && !loading && info?.status === "error" && info.count === 0;
          return (
            <li key={entry.id}>
              <button
                type="button"
                data-layer={entry.id}
                data-active={entry.on}
                data-error={disabled}
                aria-pressed={entry.on}
                aria-label={`${entry.name}${entry.count != null ? ` · ${entry.count}` : ""}`}
                onClick={() => setOpen(open === entry.id ? null : entry.id)}
                className="atlas-rail-icon"
                style={{ "--layer-color": entry.color } as CSSProperties}
                title={disabled ? t("status.error") : entry.name}
              >
                <span className="atlas-rail-glyph">
                  {isRoad ? (
                    <RoadGlyph id={entry.id as RoadLayerId} size={22} />
                  ) : (
                    <Glyph id={entry.id as LayerId} color={entry.color} />
                  )}
                </span>
                {entry.count != null && <span className="atlas-rail-count num">{entry.count}</span>}
                {entry.on && <span className="atlas-rail-dot" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>

      {openEntry && (
        <div className="atlas-rail-popup" role="dialog" aria-label={openEntry.name}>
          <div className="flex items-start gap-2">
            <span className="atlas-layer-glyph" style={{ color: openEntry.color }}>
              {ROAD_LAYERS.some((def) => def.id === openEntry.id) ? (
                <RoadGlyph id={openEntry.id as RoadLayerId} />
              ) : (
                <Glyph id={openEntry.id as LayerId} color={openEntry.color} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-snug">{openEntry.name}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted">{openEntry.note}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label={t("common.close")}
              className="atlas-icon-button -mt-1 -mr-1"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Switch
              on={openEntry.on}
              color={openEntry.color}
              label={`${t(openEntry.on ? "panel.off" : "panel.on")}: ${openEntry.name}`}
              onClick={() =>
                ROAD_LAYERS.some((def) => def.id === openEntry.id)
                  ? onRoadToggle(openEntry.id as RoadLayerId)
                  : onToggle(openEntry.id as LayerId)
              }
            />
            <span className="flex-1 text-[11px] text-muted">
              {openEntry.on ? t("common.live") : t("panel.off")}
            </span>
          </div>

          {ROAD_LAYERS.some((def) => def.id === openEntry.id) && (
            <RoadLayerInfo
              id={openEntry.id as RoadLayerId}
              info={roadConditions?.layers.find((layer) => layer.id === openEntry.id)}
              features={features}
              active={openEntry.on}
              status={null}
              incidentRoute={incidentRoute}
              onIncidentRouteChange={onIncidentRouteChange}
            />
          )}

          {!ROAD_LAYERS.some((def) => def.id === openEntry.id) && (
            <span className="mt-2 block text-[10px] leading-relaxed text-muted">
              {openEntry.count != null ? `${openEntry.count} ${t(UNIT[openEntry.id as LayerId])}` : "—"}
            </span>
          )}
        </div>
      )}
    </>
  );
}

export function LayerPanel({
  layers,
  active,
  onToggle,
  loading,
  error,
  generatedAt,
  fromCache,
  onRetry,
  roadConditions,
  roadActive,
  onRoadToggle,
  incidentRoute,
  onIncidentRouteChange,
  roadLoading,
  roadError,
  onRoadRetry,
  roadAvailable,
  collapsed,
  onCollapsedChange,
  className = "",
}: LayerPanelProps) {
  const { t, lang } = useI18n();
  const totalPoints = layers?.reduce((n, l) => n + l.count, 0) ?? 0;
  const anyOn = LAYERS.some((def) => active[def.id]) || ROAD_LAYERS.some((def) => roadActive[def.id]);
  const features = roadConditions?.features ?? [];
  const roadStatus = roadConditions && roadConditions.status !== "ok" ? STATUS_STYLE[roadConditions.status] : null;
  const total = roadConditions?.layers.reduce((sum, layer) => sum + layer.count, 0) ?? 0;
  const mapped = roadConditions?.layers.reduce((sum, layer) => sum + layer.mappedCount, 0) ?? 0;
  const unmapped = Math.max(0, total - mapped);

  if (collapsed) {
    return (
      <div className={`panel atlas-header inline-flex self-start items-center gap-3 py-2 pr-2 pl-4 ${className}`}>
        <Mark />
        <span className="label">{t("panel.title")}</span>
        <span className="num rounded-full bg-surface px-2 py-1 text-[12px] font-semibold text-ink-2">{totalPoints || "—"}</span>
        <button
          type="button"
          className="tip atlas-icon-button"
          data-tip={t("panel.expand")}
          aria-label={t("panel.expand")}
          onClick={() => onCollapsedChange(false)}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 4.5 L16 11.5 M10 4.5 L4 11.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M10 11 V16.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <section className={`panel atlas-layers w-[min(92vw,340px)] ${className}`}>
      <header className="flex shrink-0 items-center gap-2.5 px-4 pt-3 pb-2">
        <Mark />
        <h2 className="label flex-1">{t("panel.title")}</h2>
        {loading && layers ? (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] font-semibold text-muted">
            {t("status.refreshing")}
          </span>
        ) : roadStatus ? (
          <span
            className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
            style={{ color: roadStatus.color, background: `color-mix(in srgb, ${roadStatus.color} 11%, transparent)` }}
          >
            {t(roadStatus.key)}
          </span>
        ) : null}
        <button
          type="button"
          className="tip tip-right atlas-icon-button"
          data-tip={t("panel.collapse")}
          aria-label={t("panel.collapse")}
          onClick={() => onCollapsedChange(true)}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 12.5 L10 5.5 L16 12.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 13 V17.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {error && (
        <div className="mx-4 mb-3 rounded-lg border border-[var(--err)] bg-[color-mix(in_srgb,var(--err)_8%,transparent)] p-3">
          <p className="text-[12px] font-semibold text-[var(--err)]">{t("err.upstream")}</p>
          <p className="mt-1 font-mono text-[11px] break-words text-[var(--ink-2)]">{error}</p>
          <button type="button" onClick={onRetry} className="mt-2 text-[11px] font-semibold text-[var(--err)] underline underline-offset-2">
            {t("status.retry")}
          </button>
        </div>
      )}

      <div className="scroll-thin min-h-0 overflow-y-auto">
        {/* Phone: coloured icon rail + popup. */}
        {roadAvailable && (
          <div className="sm:hidden">
            <MobileLayerRail
              layers={layers}
              active={active}
              roadConditions={roadConditions}
              roadActive={roadActive}
              incidentRoute={incidentRoute}
              onIncidentRouteChange={onIncidentRouteChange}
              onToggle={onToggle}
              onRoadToggle={onRoadToggle}
              roadAvailable={roadAvailable}
              loading={roadLoading}
            />
          </div>
        )}

        {/* Desktop: one list, four road-condition layers first, then cameras.
            Without the live feeds (static build) the camera list stands alone. */}
        <div className={roadAvailable ? "hidden sm:block" : ""}>
          {roadAvailable && (
            <>
              <p className="label px-4 pb-1">{t("road.panel.title")}</p>
              {roadLoading && !roadConditions ? (
                <ul className="space-y-2 px-3">
                  {[0, 1, 2, 3].map((i) => (
                    <li key={i} className="skeleton h-16 rounded-[var(--radius-control)]" />
                  ))}
                </ul>
              ) : (
                <ul className="space-y-2 px-3">
                  {ROAD_LAYERS.map((def) => {
                    const info = roadConditions?.layers.find((layer) => layer.id === def.id);
                    const status = info && info.status !== "ok" ? STATUS_STYLE[info.status] : null;
                    const disabled = !roadLoading && info?.status === "error" && info.count === 0;
                    return (
                      <LayerRow
                        key={def.id}
                        id={def.id}
                        color={def.color}
                        name={t(`road.layer.${def.id}.name`)}
                        note={t(`road.layer.${def.id}.note`)}
                        active={roadActive[def.id]}
                        disabled={disabled}
                        status={status}
                        onToggle={() => onRoadToggle(def.id)}
                        onRetry={onRoadRetry}
                        detail={
                          <RoadLayerInfo
                            id={def.id}
                            info={info}
                            features={features}
                            active={roadActive[def.id]}
                            status={null}
                            incidentRoute={incidentRoute}
                            onIncidentRouteChange={onIncidentRouteChange}
                          />
                        }
                      />
                    );
                  })}
                </ul>
              )}
            </>
          )}

          <p className="label mt-4 px-4 pb-1">{t("road.panel.cameraGroup")}</p>
          {loading && !layers ? (
            <ul className="space-y-2 px-3">
              {[0, 1, 2].map((i) => (
                <li key={i} className="skeleton h-16 rounded-[var(--radius-control)]" />
              ))}
            </ul>
          ) : (
            <ul className="space-y-2 px-3">
              {LAYERS.map((def) => {
                const info = layers?.find((l) => l.id === def.id);
                const status = info && info.status !== "ok" ? STATUS_STYLE[info.status] : null;
                const kinds = def.kinds
                  .map((k) => [k, info?.kinds?.[k] ?? 0] as const)
                  .filter(([, n]) => n > 0);
                return (
                  <LayerRow
                    key={def.id}
                    id={def.id}
                    color={def.color}
                    name={t(`layer.${def.id}.name`)}
                    note={t(`layer.${def.id}.note`)}
                    active={active[def.id]}
                    disabled={false}
                    status={status}
                    onToggle={() => onToggle(def.id)}
                    onRetry={onRetry}
                  >
                    <span className="mt-2 flex flex-wrap items-baseline gap-1.5">
                      <span className={`num text-[26px] leading-none font-medium tracking-tight ${active[def.id] ? "" : "text-[var(--muted)]"}`}>
                        {info ? info.count : "—"}
                      </span>
                      <span className="label text-[var(--muted)]">{t(UNIT[def.id])}</span>
                      {Boolean(info?.liveCount) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface/80 px-1.5 py-1 text-[10px] font-semibold text-[var(--c-live)]">
                          <span className="pulse h-1.5 w-1.5 rounded-full bg-[var(--c-live)]" />
                          {info?.liveCount} {t("common.liveImages")}
                        </span>
                      )}
                    </span>
                    {kinds.length > 1 && (
                      <span className="mt-1.5 block text-[10px] leading-relaxed text-[var(--muted)]">
                        {kinds.map(([k, n]) => `${t(`kind.${k}`)} ${n}`).join(" · ")}
                      </span>
                    )}
                  </LayerRow>
                );
              })}
            </ul>
          )}

          {roadAvailable && (
            <div className="mt-2 space-y-1 px-4 py-3 text-[9px] leading-relaxed text-muted">
              {roadConditions && <p>{t("road.panel.summary", { mapped, total })}</p>}
              {unmapped > 0 && <p className="text-[var(--warn)]">{t("road.panel.unmapped", { n: unmapped })}</p>}
              {roadConditions?.generatedAt && (
                <p>{t("road.panel.updated")} {formatDateTime(roadConditions.generatedAt, lang)}</p>
              )}
              {roadConditions?.fromCache && <p className="text-[var(--warn)]">{t("status.cachedNote")}</p>}
              {(roadError || roadConditions?.error) && (
                <div className="pt-1">
                  <p className="font-mono text-[9px] break-words text-[var(--err)]">{roadError ?? roadConditions?.error}</p>
                  <button type="button" onClick={onRoadRetry} className="mt-1 font-semibold text-[var(--err)] underline underline-offset-2">
                    {t("status.retry")}
                  </button>
                </div>
              )}
            </div>
          )}

          {!roadAvailable && (
            <p className="mx-3 mt-2 mb-3 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              {t("road.panel.serverOnly")}
            </p>
          )}
        </div>
      </div>

      {layers && (
        <footer className="atlas-layer-footer shrink-0 space-y-1 border-t border-line px-4 py-3 text-[10px] leading-relaxed text-muted">
          {!anyOn && (
            <p className="mb-2 rounded-md bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--warn)]">
              {t("panel.allOff")}
            </p>
          )}
          <p>{t("panel.summary", { layers: LAYERS.length + (roadAvailable ? ROAD_LAYERS.length : 0), points: totalPoints })}</p>
          {generatedAt && (
            <p>
              {t("status.updated")} {formatDateTime(generatedAt, lang)}
            </p>
          )}
          {fromCache && <p className="text-[var(--warn)]">{t("status.cachedNote")}</p>}
        </footer>
      )}
    </section>
  );
}
