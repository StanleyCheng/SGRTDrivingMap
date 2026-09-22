"use client";

import { useState } from "react";
import type { StringKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { LAYERS, ROAD_LAYER_ORDER } from "@/lib/layers";
import type {
  LayerFilters,
  LayerId,
  LayerInfo,
  RoadConditionsResponse,
  RoadLayerId,
} from "@/lib/types";
import { DEFAULT_LAYER_FILTERS } from "@/lib/types";
import { useI18n } from "./i18n-provider";
import { RoadLayerInfo } from "./layer-detail";
import {
  AnyLayerGlyph,
  LIVE_ROAD_LAYERS,
  Mark,
  ROAD_LAYER_IDS,
  ROUTE_ROAD_LAYERS,
  STATUS_STYLE,
  Switch,
  UNIT,
  layerStyle,
} from "./layer-ui";

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
  /** Phone layout: the rail docks at the bottom instead of the top-left card. */
  mobile?: boolean;
  filters?: LayerFilters;
  onFilterChange?: (patch: Partial<LayerFilters>) => void;
  className?: string;
}

/**
 * Rail layers whose tap opens a panel rather than toggling, because they have
 * something to set: the incident route filter, the parking vehicle type, and the
 * EV connector / power / availability filters. Every other layer is a single tap.
 */
const RAIL_OPTION_LAYERS: (LayerId | RoadLayerId)[] = ["incidents", "parking", "ev"];

interface RailEntry {
  id: LayerId | RoadLayerId;
  color: string;
  name: string;
  note: string;
  on: boolean;
  count: number | null;
  info?: RoadConditionsResponse["layers"][number];
  disabled: boolean;
  /** Panel priority (#1…#9) for the driver layers; camera layers have none. */
  priority?: number;
}

/**
 * The layer control, identical on desktop and phone: one coloured icon per layer,
 * a tooltip describing it, and a tap that switches a layer with nothing to
 * configure straight away. A layer with settings opens its own panel, and a
 * failing feed opens one holding the reason and Retry, because those carry
 * information a single tap cannot express.
 */
function LayerRail({
  layers,
  active,
  roadConditions,
  roadActive,
  incidentRoute,
  onIncidentRouteChange,
  onToggle,
  onRoadToggle,
  roadAvailable,
  roadLoading,
  filters,
  onFilterChange,
  onRoadRetry,
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
  roadLoading: boolean;
  filters: LayerFilters;
  onFilterChange: (patch: Partial<LayerFilters>) => void;
  onRoadRetry: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<LayerId | RoadLayerId | null>(null);
  const [hint, setHint] = useState<LayerId | RoadLayerId | null>(null);
  const features = roadConditions?.features ?? [];

  const roadEntries: RailEntry[] = [...LIVE_ROAD_LAYERS, ...ROUTE_ROAD_LAYERS].map((def) => {
    const info = roadConditions?.layers.find((layer) => layer.id === def.id);
    return {
      id: def.id,
      color: def.color,
      name: t(`road.layer.${def.id}.name`),
      note: t(`road.layer.${def.id}.note`),
      on: roadActive[def.id],
      count: info ? info.mappedCount : null,
      info,
      disabled: roadAvailable && !roadLoading && info?.status === "error" && (info?.count ?? 0) === 0,
      priority: ROAD_LAYER_ORDER.indexOf(def.id) + 1,
    };
  });

  const cameraEntries: RailEntry[] = LAYERS.map((def) => {
    const info = layers?.find((layer) => layer.id === def.id);
    return {
      id: def.id,
      color: def.color,
      name: t(`layer.${def.id}.name`),
      note: t(`layer.${def.id}.note`),
      on: active[def.id],
      count: info ? info.count : null,
      disabled: false,
    };
  });

  const entries = [...roadEntries, ...cameraEntries];
  const openEntry = entries.find((entry) => entry.id === open) ?? null;
  const hintEntry = entries.find((entry) => entry.id === hint) ?? null;
  const isRoad = (id: LayerId | RoadLayerId) => ROAD_LAYER_IDS.includes(id as RoadLayerId);
  const hasOptions = (id: LayerId | RoadLayerId) => RAIL_OPTION_LAYERS.includes(id);

  const switchLayer = (id: LayerId | RoadLayerId) => {
    if (isRoad(id)) onRoadToggle(id as RoadLayerId);
    else onToggle(id as LayerId);
  };

  /** Tooltip text: what the layer is, what it does, and the feed behind it. */
  const describe = (entry: RailEntry) => {
    const head = entry.priority != null ? `#${entry.priority} ${entry.name}` : entry.name;
    const feeds = entry.info?.sources.map((source) => source.name).filter(Boolean) ?? [];
    return [head, entry.note, feeds.join(" · ")].filter(Boolean).join(" — ");
  };

  return (
    <>
      {openEntry && (
        <div
          className="atlas-rail-popup"
          role="dialog"
          aria-label={openEntry.name}
        >
          <div className="flex items-start gap-2">
            <span className="atlas-layer-glyph" style={{ color: openEntry.color }}>
              <AnyLayerGlyph id={openEntry.id} color={openEntry.color} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-snug">
                {openEntry.priority != null ? `#${openEntry.priority} ` : ""}
                {openEntry.name}
              </p>
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
              on={openEntry.on && !openEntry.disabled}
              color={openEntry.color}
              label={`${t(openEntry.on ? "panel.off" : "panel.on")}: ${openEntry.name}`}
              onClick={() => switchLayer(openEntry.id)}
              disabled={openEntry.disabled}
            />
            <span className="flex-1 text-[11px] text-muted">
              {openEntry.disabled ? t("status.error") : openEntry.on ? t("common.live") : t("panel.off")}
            </span>
          </div>

          {isRoad(openEntry.id) ? (
            <RoadLayerInfo
              id={openEntry.id as RoadLayerId}
              info={openEntry.info}
              features={features}
              active={openEntry.on}
              status={
                openEntry.info && openEntry.info.status !== "ok"
                  ? STATUS_STYLE[openEntry.info.status]
                  : null
              }
              incidentRoute={incidentRoute}
              onIncidentRouteChange={onIncidentRouteChange}
              filters={filters}
              onFilterChange={onFilterChange}
            />
          ) : (
            <span className="mt-2 block text-[10px] leading-relaxed text-muted">
              {openEntry.count != null
                ? `${openEntry.count} ${t(UNIT[openEntry.id as LayerId])}`
                : "—"}
            </span>
          )}

          {openEntry.disabled && (
            <button
              type="button"
              onClick={onRoadRetry}
              className="mt-2 text-[10px] font-semibold text-[var(--err)] underline underline-offset-2"
            >
              {t("status.retry")}
            </button>
          )}
        </div>
      )}

      <div className="atlas-rail-bar">
        <span className="label shrink-0 px-1 text-muted">{t("panel.title")}</span>
        {hintEntry && (
          <p className="atlas-rail-hint" role="tooltip">
            {describe(hintEntry)}
          </p>
        )}
        <ul className="atlas-rail" aria-label={t("panel.title")}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                data-layer={entry.id}
                data-active={entry.on}
                data-error={entry.disabled}
                aria-pressed={entry.on}
                aria-label={`${entry.name}${entry.count != null ? ` · ${entry.count}` : ""}`}
                aria-haspopup={entry.disabled || hasOptions(entry.id) ? "dialog" : undefined}
                data-tip={describe(entry)}
                title={entry.name}
                onMouseEnter={() => setHint(entry.id)}
                onMouseLeave={() => setHint((current) => (current === entry.id ? null : current))}
                onFocus={() => setHint(entry.id)}
                onBlur={() => setHint((current) => (current === entry.id ? null : current))}
                onClick={() => {
                  // Feed errors keep their panel (it holds the reason and Retry);
                  // layers with settings open theirs; the rest toggle in one tap.
                  if (entry.disabled || hasOptions(entry.id)) {
                    setOpen(open === entry.id ? null : entry.id);
                    return;
                  }
                  setOpen(null);
                  switchLayer(entry.id);
                }}
                className="atlas-rail-icon"
                style={layerStyle(entry.color)}
              >
                <span className="atlas-rail-glyph">
                  <AnyLayerGlyph id={entry.id} color={entry.color} size={22} />
                </span>
                {entry.count != null && <span className="atlas-rail-count num">{entry.count}</span>}
                {entry.on && <span className="atlas-rail-dot" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
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
  mobile = false,
  filters,
  onFilterChange,
  className = "",
}: LayerPanelProps) {
  const { t, lang } = useI18n();
  const totalPoints = layers?.reduce((n, l) => n + l.count, 0) ?? 0;
  const anyOn =
    LAYERS.some((def) => active[def.id]) || ROAD_LAYER_IDS.some((id) => roadActive[id]);
  const roadStatus: { key: StringKey; color: string } | null =
    roadConditions && roadConditions.status !== "ok" ? STATUS_STYLE[roadConditions.status] : null;
  const total = roadConditions?.layers.reduce((sum, layer) => sum + layer.count, 0) ?? 0;
  const mapped = roadConditions?.layers.reduce((sum, layer) => sum + layer.mappedCount, 0) ?? 0;
  const unmapped = Math.max(0, total - mapped);
  const layerFilters = filters ?? DEFAULT_LAYER_FILTERS;
  const changeFilters = onFilterChange ?? (() => {});

  // The strip is small, so it collapses to its own glyph the same way the header
  // does. The phone rail is already compact and never collapses.
  if (collapsed && !mobile) {
    return (
      <div className={`panel atlas-header inline-flex self-start items-center gap-3 py-2 pr-2 pl-4 ${className}`}>
        <Mark />
        <span className="label">{t("panel.title")}</span>
        <span className="num rounded-full bg-surface px-2 py-1 text-[12px] font-semibold text-ink-2">
          {totalPoints || "—"}
        </span>
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
    <section
      className={`panel atlas-layers ${mobile ? "atlas-layers-bottom w-[100vw] sm:w-[min(92vw,340px)]" : "atlas-layers-side w-[248px]"} ${className}`}
    >
      <header className="flex shrink-0 items-center gap-2.5 px-3 pt-3 pb-1">
        <Mark />
        <h2 className="label flex-1">{t("panel.title")}</h2>
        {loading && layers ? (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] font-semibold text-muted">
            {t("status.refreshing")}
          </span>
        ) : roadLoading && !roadConditions ? (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] font-semibold text-muted">
            {t("status.loading")}
          </span>
        ) : roadStatus ? (
          <span
            className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
            style={{ color: roadStatus.color, background: `color-mix(in srgb, ${roadStatus.color} 11%, transparent)` }}
          >
            {t(roadStatus.key)}
          </span>
        ) : null}
        {!mobile && (
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
        )}
      </header>

      <LayerRail
        layers={layers}
        active={active}
        roadConditions={roadConditions}
        roadActive={roadActive}
        incidentRoute={incidentRoute}
        onIncidentRouteChange={onIncidentRouteChange}
        onToggle={onToggle}
        onRoadToggle={onRoadToggle}
        roadAvailable={roadAvailable}
        roadLoading={roadLoading}
        filters={layerFilters}
        onFilterChange={changeFilters}
        onRoadRetry={onRoadRetry}
      />

      <footer className="atlas-layer-footer shrink-0 space-y-1 border-t border-line px-3 py-2.5 text-[10px] leading-relaxed text-muted">
        {error && (
          <div className="rounded-lg border border-[var(--err)] bg-[color-mix(in_srgb,var(--err)_8%,transparent)] p-2">
            <p className="text-[11px] font-semibold text-[var(--err)]">{t("err.upstream")}</p>
            <p className="mt-1 font-mono text-[10px] break-words text-[var(--ink-2)]">{error}</p>
            <button type="button" onClick={onRetry} className="mt-1 text-[10px] font-semibold text-[var(--err)] underline underline-offset-2">
              {t("status.retry")}
            </button>
          </div>
        )}
        {!anyOn && (
          <p className="rounded-md bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--warn)]">
            {t("panel.allOff")}
          </p>
        )}
        <p>{t("panel.summary", { layers: LAYERS.length + ROAD_LAYER_IDS.length, points: totalPoints })}</p>
        {roadConditions && <p>{t("road.panel.summary", { mapped, total })}</p>}
        {roadConditions?.generatedAt && (
          <p>
            {t("road.panel.updated")} {formatDateTime(roadConditions.generatedAt, lang)}
          </p>
        )}
        {generatedAt && (
          <p>
            {t("status.updated")} {formatDateTime(generatedAt, lang)}
          </p>
        )}
        {unmapped > 0 && <p className="text-[var(--warn)]">{t("road.panel.unmapped", { n: unmapped })}</p>}
        {(roadConditions?.fromCache || fromCache) && (
          <p className="text-[var(--warn)]">{t("status.cachedNote")}</p>
        )}
        {(roadError || roadConditions?.error) && (
          <div className="pt-1">
            <p className="font-mono text-[9px] break-words text-[var(--err)]">{roadError ?? roadConditions?.error}</p>
            <button type="button" onClick={onRoadRetry} className="mt-1 font-semibold text-[var(--err)] underline underline-offset-2">
              {t("status.retry")}
            </button>
          </div>
        )}
      </footer>
    </section>
  );
}
