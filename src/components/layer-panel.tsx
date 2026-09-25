"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { StringKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { CloseIcon } from "./icons";
import { LAYERS, ROAD_LAYER_ORDER } from "@/lib/layers";
import {
  DEFAULT_LAYER_FILTERS,
  type LayerFilters,
  type LayerId,
  type LayerInfo,
  type RoadConditionsResponse,
  type RoadLayerId,
} from "@/lib/types";
import { useI18n } from "./i18n-provider";
import { RoadLayerInfo } from "./layer-detail";
import {
  AnyLayerGlyph,
  LIVE_ROAD_LAYERS,
  Mark,
  ROAD_LAYER_IDS,
  ROUTE_ROAD_LAYERS,
  STATUS_STYLE,
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
  /** Phone layout: the rail docks at the very bottom and drops the detail footer. */
  mobile?: boolean;
  filters?: LayerFilters;
  onFilterChange?: (patch: Partial<LayerFilters>) => void;
  className?: string;
}

/**
 * Layers whose icon opens a settings panel *in addition to* toggling. The click
 * always switches the layer — the panel is where its filters live, never a second
 * switch the user has to find.
 */
const SETTINGS_LAYERS: (LayerId | RoadLayerId)[] = ["incidents", "parking", "ev"];

/** Stable id so the shared bubble can describe the hovered icon to assistive tech. */
const HINT_ID = "atlas-layer-hint";

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
 * The layer control on both platforms: one coloured icon per layer. A click always
 * switches that layer. Layers with filters also open their settings, and a feed
 * that cannot be reached opens the reason and a Retry — but never a switch, because
 * the icon the user just clicked is the switch.
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
  open,
  onOpenChange,
  onHint,
  panelRef,
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
  open: LayerId | RoadLayerId | null;
  onOpenChange: (id: LayerId | RoadLayerId | null) => void;
  onHint: (entry: RailEntry | null, x?: number) => void;
  panelRef: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
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
  const isRoad = (id: LayerId | RoadLayerId) => ROAD_LAYER_IDS.includes(id as RoadLayerId);
  const switchLayer = (id: LayerId | RoadLayerId) => {
    if (isRoad(id)) onRoadToggle(id as RoadLayerId);
    else onToggle(id as LayerId);
  };
  /** Where the hovered tile sits, so the shared bubble can point at it. */
  const hintAt = (event: React.MouseEvent<HTMLButtonElement> | React.FocusEvent<HTMLButtonElement>) => {
    const panel = panelRef.current?.getBoundingClientRect();
    const tile = event.currentTarget.getBoundingClientRect();
    return panel ? tile.left - panel.left + tile.width / 2 : undefined;
  };

  return (
    <>
      <ul className="atlas-rail" aria-label={t("panel.title")}>
        {entries.map((entry) => {
          const settings = SETTINGS_LAYERS.includes(entry.id);
          return (
            <li key={entry.id}>
              <button
                type="button"
                data-layer={entry.id}
                data-active={entry.on}
                data-error={entry.disabled}
                aria-pressed={entry.on}
                aria-label={`${entry.name}${entry.count != null ? ` · ${entry.count}` : ""}`}
                aria-haspopup={settings || entry.disabled ? "dialog" : undefined}
                data-tip={describeEntry(entry)}
                aria-describedby={HINT_ID}
                onMouseEnter={(event) => onHint(entry, hintAt(event))}
                onMouseLeave={() => onHint(null)}
                onFocus={(event) => onHint(entry, hintAt(event))}
                onBlur={() => onHint(null)}
                onClick={(event) => {
                  // A click always switches the layer — an errored feed included, so the
                  // icon never reports a state it refuses to leave. Layers with filters
                  // also open them, and a second click on that same icon closes the
                  // panel again rather than covering the map for good.
                  switchLayer(entry.id);
                  const reopening = open !== entry.id;
                  onOpenChange(entry.disabled || settings ? (reopening ? entry.id : null) : null);
                  // Touch fires a compatibility mouseenter, which would otherwise park
                  // the bubble above the rail until the next tap somewhere else.
                  onHint(null);
                  void event;
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
          );
        })}
      </ul>

      {openEntry && (
        <div className="atlas-rail-popup" role="dialog" aria-label={openEntry.name}>
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
              onClick={() => onOpenChange(null)}
              aria-label={t("common.close")}
              className="atlas-icon-button -mt-1 -mr-1"
            >
              <CloseIcon size={15} strokeWidth={1.8} />
            </button>
          </div>

          {isRoad(openEntry.id) ? (
            <RoadLayerInfo
              id={openEntry.id as RoadLayerId}
              info={openEntry.info}
              features={features}
              active={openEntry.on}
              status={
                openEntry.info &&
                openEntry.info.status !== "ok" &&
                openEntry.info.status !== "stale"
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
              {openEntry.count != null ? `${openEntry.count} ${t(UNIT[openEntry.id as LayerId])}` : "—"}
            </span>
          )}

          {openEntry.disabled && (
            <>
              <p className="mt-2 text-[11px] leading-snug text-[var(--err)]">{t("status.error")}</p>
              <button
                type="button"
                onClick={onRoadRetry}
                className="mt-1 text-[10px] font-semibold text-[var(--err)] underline underline-offset-2"
              >
                {t("status.retry")}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Tooltip text: what the layer is, what it does, and the official feed behind it. */
function describeEntry(entry: RailEntry) {
  const head = entry.priority != null ? `#${entry.priority} ${entry.name}` : entry.name;
  const feeds = entry.info?.sources.map((source) => source.name).filter(Boolean) ?? [];
  return [head, entry.note, feeds.join(" · ")].filter(Boolean).join(" — ");
}

export function LayerPanel({
  layers,
  active,
  onToggle,
  loading,
  error,
  generatedAt,
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
  const [open, setOpen] = useState<LayerId | RoadLayerId | null>(null);
  const [hint, setHint] = useState<{ entry: RailEntry; x?: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const totalPoints = layers?.reduce((n, l) => n + l.count, 0) ?? 0;
  const anyOn = LAYERS.some((def) => active[def.id]) || ROAD_LAYER_IDS.some((id) => roadActive[id]);
  const roadStatus: { key: StringKey; color: string } | null =
    roadConditions && roadConditions.status !== "ok" && roadConditions.status !== "stale"
      ? STATUS_STYLE[roadConditions.status]
      : null;
  const total = roadConditions?.layers.reduce((sum, layer) => sum + layer.count, 0) ?? 0;
  const mapped = roadConditions?.layers.reduce((sum, layer) => sum + layer.mappedCount, 0) ?? 0;
  const layerFilters = filters ?? DEFAULT_LAYER_FILTERS;
  const changeFilters = onFilterChange ?? (() => {});

  // Retracted: a sliver of the panel, so the map keeps the space until asked.
  if (collapsed && !mobile) {
    return (
      <div
        className={`panel atlas-header atlas-layers-collapsed flex items-center gap-2 py-1.5 pr-1.5 pl-3 ${className}`}
      >
        <Mark />
        <span className="label flex-1 whitespace-nowrap">{t("panel.title")}</span>
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
      ref={panelRef}
      className={`panel atlas-layers ${mobile ? "atlas-layers-phone" : "atlas-layers-bar"} ${className}`}
    >
      {/* Floating above the whole panel, so a tooltip is never clipped by the window
          edge, never covers the icons it describes, and wraps in either language. */}
      {hint && !open && (
        <p
          id={HINT_ID}
          className="atlas-rail-hint"
          role="tooltip"
          style={{ "--hint-x": `${hint.x ?? 0}px` } as CSSProperties}
        >
          {describeEntry(hint.entry)}
        </p>
      )}

      {!mobile && (
        <header className="flex shrink-0 items-center gap-2.5 px-3 pt-2.5 pb-1">
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
          ) : error ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-[var(--err)]"
              style={{ background: "color-mix(in srgb, var(--err) 12%, transparent)" }}
            >
              {t("status.retry")}
            </button>
          ) : null}
          <button
            type="button"
            className="tip atlas-icon-button"
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
      )}

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
        open={open}
        onOpenChange={setOpen}
        onHint={(entry, x) => setHint(entry ? { entry, x } : null)}
        panelRef={panelRef}
      />

      {/* The phone rail is the control and nothing else: no counts, no timestamps,
          no error prose under the icons. Its tooltips carry the detail. */}
      {!mobile && (
        <footer className="atlas-layer-footer shrink-0 space-y-0.5 border-t border-line px-3 py-2 text-[10px] leading-snug text-muted">
          {!anyOn && (
            <p className="rounded-md bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-2 py-1 text-[11px] text-[var(--warn)]">
              {t("panel.allOff")}
            </p>
          )}
          <p>
            {t("panel.summary", { layers: LAYERS.length + ROAD_LAYER_IDS.length, points: totalPoints })}
            {roadConditions ? ` · ${t("road.panel.summary", { mapped, total })}` : ""}
          </p>
          <p>
            {roadConditions?.generatedAt
              ? `${t("road.panel.updated")} ${formatDateTime(roadConditions.generatedAt, lang)}`
              : generatedAt
                ? `${t("status.updated")} ${formatDateTime(generatedAt, lang)}`
                : ""}
          </p>
          {(error || roadError || roadConditions?.error) && (
            <p className="font-mono text-[9px] break-words text-[var(--err)]">
              {error ?? roadError ?? roadConditions?.error}{" "}
              <button type="button" onClick={roadError || roadConditions?.error ? onRoadRetry : onRetry} className="font-semibold underline underline-offset-2">
                {t("status.retry")}
              </button>
            </p>
          )}
        </footer>
      )}
    </section>
  );
}
