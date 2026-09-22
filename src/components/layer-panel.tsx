"use client";

import { useState } from "react";
import type { StringKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { LAYERS } from "@/lib/layers";
import type {
  LayerFilters,
  LayerId,
  LayerInfo,
  RoadConditionFeature,
  RoadConditionLayerInfo,
  RoadConditionsResponse,
  RoadLayerId,
  SourceStatus,
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
  /** Phone layout: the coloured rail replaces the collapsed chip. */
  mobile?: boolean;
  filters?: LayerFilters;
  onFilterChange?: (patch: Partial<LayerFilters>) => void;
  className?: string;
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
  const label = `${t(active ? "panel.off" : "panel.on")}: ${name}`;
  return (
    <li data-layer={id} data-active={active && !disabled} className="atlas-layer p-3" style={layerStyle(color)}>
      <div className="flex gap-2.5">
        <span className="atlas-layer-glyph" style={{ color }}>
          <AnyLayerGlyph id={id} color={color} />
        </span>
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-label={label}
          className="min-w-0 flex-1 pt-0.5 text-left disabled:cursor-not-allowed"
        >
          <span className="block text-[13px] font-semibold">{name}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted)]">{note}</span>
          {children}
          {detail}
        </button>
        <Switch on={active && !disabled} color={color} label={label} onClick={onToggle} disabled={disabled} />
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

/* ------------------------------------------------------------------ *
 * Phone rail
 * ------------------------------------------------------------------ */

interface RailEntry {
  id: LayerId | RoadLayerId;
  color: string;
  name: string;
  note: string;
  on: boolean;
  count: number | null;
  info?: RoadConditionLayerInfo;
  disabled: boolean;
}

/**
 * Phone presentation: one coloured icon per layer, docked at the bottom of the
 * window. Each icon carries a tooltip and, when tapped, opens that layer's own
 * popup above the rail — so a phone never has to show all twelve rows at once.
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
  const features = roadConditions?.features ?? [];

  const roadEntries: RailEntry[] = roadAvailable
    ? [...LIVE_ROAD_LAYERS, ...ROUTE_ROAD_LAYERS].map((def) => {
        const info = roadConditions?.layers.find((layer) => layer.id === def.id);
        return {
          id: def.id,
          color: def.color,
          name: t(`road.layer.${def.id}.name`),
          note: t(`road.layer.${def.id}.note`),
          on: roadActive[def.id],
          count: info ? info.mappedCount : null,
          info,
          disabled: !roadLoading && info?.status === "error" && (info?.count ?? 0) === 0,
        };
      })
    : [];

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

  return (
    <>
      {openEntry && (
        <div className="atlas-rail-popup" role="dialog" aria-label={openEntry.name}>
          <div className="flex items-start gap-2">
            <span className="atlas-layer-glyph" style={{ color: openEntry.color }}>
              <AnyLayerGlyph id={openEntry.id} color={openEntry.color} />
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
              on={openEntry.on && !openEntry.disabled}
              color={openEntry.color}
              label={`${t(openEntry.on ? "panel.off" : "panel.on")}: ${openEntry.name}`}
              onClick={() =>
                isRoad(openEntry.id)
                  ? onRoadToggle(openEntry.id as RoadLayerId)
                  : onToggle(openEntry.id as LayerId)
              }
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
                data-tip={entry.disabled ? t("status.error") : entry.name}
                onClick={() => setOpen(open === entry.id ? null : entry.id)}
                className="tip atlas-rail-icon"
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

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

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
    LAYERS.some((def) => active[def.id]) || (roadAvailable && ROAD_LAYER_IDS.some((id) => roadActive[id]));
  const features = roadConditions?.features ?? [];
  const roadStatus =
    roadConditions && roadConditions.status !== "ok" ? STATUS_STYLE[roadConditions.status] : null;
  const total = roadConditions?.layers.reduce((sum, layer) => sum + layer.count, 0) ?? 0;
  const mapped = roadConditions?.layers.reduce((sum, layer) => sum + layer.mappedCount, 0) ?? 0;
  const unmapped = Math.max(0, total - mapped);

  const changeFilters = onFilterChange ?? (() => {});
  const layerFilters = filters ?? DEFAULT_LAYER_FILTERS;

  /* Phone: the rail is the control; there is no collapsed chip to hunt for. */
  if (mobile) {
    return (
      <section className={`panel atlas-layers atlas-layers-mobile w-[100vw] sm:w-[min(92vw,340px)] ${className}`}>
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
          roadLoading={roadLoading}
          filters={layerFilters}
          onFilterChange={changeFilters}
          onRoadRetry={onRoadRetry}
        />
        {roadError && (
          <p className="px-3 pb-2 font-mono text-[9px] break-words text-[var(--err)]">{roadError}</p>
        )}
      </section>
    );
  }

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
                {LIVE_ROAD_LAYERS.map((def) => (
                  <RoadLayerRow
                    key={def.id}
                    id={def.id}
                    color={def.color}
                    info={roadConditions?.layers.find((layer) => layer.id === def.id)}
                    features={features}
                    active={roadActive[def.id]}
                    roadLoading={roadLoading}
                    incidentRoute={incidentRoute}
                    onIncidentRouteChange={onIncidentRouteChange}
                    onRoadToggle={onRoadToggle}
                    onRoadRetry={onRoadRetry}
                    filters={layerFilters}
                    onFilterChange={changeFilters}
                  />
                ))}
              </ul>
            )}

            <p className="label mt-4 px-4 pb-1">{t("road.panel.mobilityGroup")}</p>
            <ul className="space-y-2 px-3">
              {ROUTE_ROAD_LAYERS.map((def) => (
                <RoadLayerRow
                  key={def.id}
                  id={def.id}
                  color={def.color}
                  info={roadConditions?.layers.find((layer) => layer.id === def.id)}
                  features={features}
                  active={roadActive[def.id]}
                  roadLoading={roadLoading}
                  incidentRoute={incidentRoute}
                  onIncidentRouteChange={onIncidentRouteChange}
                  onRoadToggle={onRoadToggle}
                  onRoadRetry={onRoadRetry}
                  filters={layerFilters}
                  onFilterChange={changeFilters}
                />
              ))}
            </ul>
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

      {layers && (
        <footer className="atlas-layer-footer shrink-0 space-y-1 border-t border-line px-4 py-3 text-[10px] leading-relaxed text-muted">
          {!anyOn && (
            <p className="mb-2 rounded-md bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--warn)]">
              {t("panel.allOff")}
            </p>
          )}
          <p>{t("panel.summary", { layers: LAYERS.length + ROAD_LAYER_IDS.length, points: totalPoints })}</p>
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

/** One road-condition row: health, count, per-layer summary and filters. */
function RoadLayerRow({
  id,
  color,
  info,
  features,
  active,
  roadLoading,
  incidentRoute,
  onIncidentRouteChange,
  onRoadToggle,
  onRoadRetry,
  filters,
  onFilterChange,
}: {
  id: RoadLayerId;
  color: string;
  info: RoadConditionLayerInfo | undefined;
  features: RoadConditionFeature[];
  active: boolean;
  roadLoading: boolean;
  incidentRoute: string | null;
  onIncidentRouteChange: (route: string | null) => void;
  onRoadToggle: (id: RoadLayerId) => void;
  onRoadRetry: () => void;
  filters: LayerFilters;
  onFilterChange: (patch: Partial<LayerFilters>) => void;
}) {
  const { t } = useI18n();
  const status: { key: StringKey; color: string } | null =
    info && info.status !== "ok" ? STATUS_STYLE[info.status as Exclude<SourceStatus, "ok">] : null;
  const disabled = !roadLoading && info?.status === "error" && (info?.count ?? 0) === 0;
  return (
    <LayerRow
      id={id}
      color={color}
      name={t(`road.layer.${id}.name`)}
      note={t(`road.layer.${id}.note`)}
      active={active}
      disabled={disabled}
      status={status}
      onToggle={() => onRoadToggle(id)}
      onRetry={onRoadRetry}
      detail={
        <RoadLayerInfo
          id={id}
          info={info}
          features={features}
          active={active}
          status={null}
          incidentRoute={incidentRoute}
          onIncidentRouteChange={onIncidentRouteChange}
          filters={filters}
          onFilterChange={onFilterChange}
        />
      }
    />
  );
}
