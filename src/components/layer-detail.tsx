"use client";

import { useMemo, type CSSProperties } from "react";
import type { StringKey } from "@/lib/i18n";
import { DOC_LINKS } from "@/lib/layers";
import type {
  LayerFilters,
  RoadConditionFeature,
  RoadConditionLayerInfo,
  RoadLayerId,
} from "@/lib/types";
import { useI18n } from "./i18n-provider";
import { Chip, LOT_TYPE_KEYS } from "./layer-ui";

/**
 * The per-layer content of the layer panel — shown inline on desktop and inside
 * the phone rail popup. Every layer owns its own summary, filter and legend so
 * the shell stays layout-only.
 */

export interface RoadInfoProps {
  id: RoadLayerId;
  info: RoadConditionLayerInfo | undefined;
  /** Every live feature, unfiltered; each layer picks its own. */
  features: RoadConditionFeature[];
  active: boolean;
  status: { key: StringKey; color: string } | null;
  incidentRoute: string | null;
  onIncidentRouteChange: (route: string | null) => void;
  filters: LayerFilters;
  onFilterChange: (patch: Partial<LayerFilters>) => void;
}

const EXTERNAL_LINK =
  "inline-flex items-center gap-1 text-[10px] font-semibold underline underline-offset-2";

function byLayer(features: RoadConditionFeature[], id: RoadLayerId) {
  return features.filter((feature) => feature.properties.layer === id);
}

/* ------------------------------------------------------------------ *
 * Shared controls
 * ------------------------------------------------------------------ */

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <span className="mt-2 block">
      <label className="label mb-1 block text-[9px] text-muted" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[11px] text-ink"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mt-2 flex min-h-9 items-center gap-2 text-[11px] text-ink-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

/** Distinct published connectors, in stable order. */
function connectorValues(features: RoadConditionFeature[]) {
  const seen = new Set<string>();
  for (const feature of features) {
    const value = feature.properties.plugType;
    if (value) seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ *
 * Layer 1 · speed legend
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Layer 2 · route filter
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Layer 5 · parking
 * ------------------------------------------------------------------ */

function ParkingSummary({ features }: { features: RoadConditionFeature[] }) {
  const { t } = useI18n();
  const rows = features.filter((feature) => feature.properties.kind === "parking-lot");
  const lots = useMemo(() => {
    const byType = new Map<string, { lots: number; carparks: Set<string> }>();
    for (const feature of rows) {
      const type = feature.properties.lotType;
      if (!type) continue;
      const entry = byType.get(type) ?? { lots: 0, carparks: new Set<string>() };
      entry.lots += feature.properties.availableLots ?? 0;
      entry.carparks.add(feature.properties.sourceId);
      byType.set(type, entry);
    }
    return [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const withHeight = rows.filter((feature) => feature.properties.gantryHeightM != null).length;

  if (!rows.length) return null;
  return (
    <>
      <span className="mt-2 flex flex-wrap gap-1.5">
        {lots.map(([type, entry]) => (
          <span key={type} className="atlas-mini-card">
            <b className="num">{entry.lots.toLocaleString("en-GB")}</b>
            {/* LTA also publishes an undocumented "S" code; show the raw code
                rather than mislabelling it. */}
            <span>{LOT_TYPE_KEYS[type] ? t(LOT_TYPE_KEYS[type]) : type}</span>
            <i>{entry.carparks.size}</i>
          </span>
        ))}
      </span>
      <span className="mt-1.5 block text-[9px] leading-relaxed text-muted">
        {t("road.parking.reporting", { n: rows.length })}
        {withHeight > 0 && (
          <>
            {" · "}
            <a
              href={DOC_LINKS.hdbCarparkInfo}
              target="_blank"
              rel="noreferrer"
              className={EXTERNAL_LINK}
            >
              {t("road.parking.heightFrom")} ↗
            </a>
          </>
        )}
      </span>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Layer 6 · ERP cost summary
 * ------------------------------------------------------------------ */

function ErpSummary({ features }: { features: RoadConditionFeature[] }) {
  const { t } = useI18n();
  const rates = features.filter((feature) => feature.properties.kind === "erp-rate");
  const money = (value: number) => `$${value.toFixed(2)}`;
  const sorted = [...rates].sort((a, b) => (b.properties.charge ?? -1) - (a.properties.charge ?? -1));

  return (
    <>
      <span className="mt-1.5 block text-[9px] leading-relaxed text-muted">
        {t("road.erp.summaryNote")}
      </span>
      {sorted.length ? (
        <ul className="mt-2 space-y-1.5">
          {sorted.slice(0, 8).map((feature) => {
            const { properties } = feature;
            return (
              <li key={feature.id} className="atlas-erp-row">
                <span className="atlas-erp-zone">
                  <b>{properties.zoneId}</b>
                  <i>{properties.title}</i>
                </span>
                <span className="atlas-erp-charge">
                  {properties.charge != null ? (
                    <>
                      <b className="num">{money(properties.charge)}</b>
                      <i>{properties.chargeWindow}</i>
                    </>
                  ) : (
                    <i>—</i>
                  )}
                  {properties.nextCharge != null && (
                    <em>
                      {t("road.detail.nextCharge")} <span className="num">{money(properties.nextCharge)}</span>{" "}
                      {properties.nextWindow}
                    </em>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <span className="mt-2 block rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2 text-[10px] leading-relaxed text-muted">
          {t("road.erp.noRates")}
        </span>
      )}
      <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <a href={DOC_LINKS.erpRates} target="_blank" rel="noreferrer" className={EXTERNAL_LINK} style={{ color: "var(--c-erp)" }}>
          {t("road.erp.ratesDoc")} ↗
        </a>
        <a href={DOC_LINKS.datamallGuide} target="_blank" rel="noreferrer" className={EXTERNAL_LINK} style={{ color: "var(--c-erp)" }}>
          {t("road.erp.zoneTable")} ↗
        </a>
      </span>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Layer 8 · zones
 * ------------------------------------------------------------------ */

const ZONE_ZOOM = 14;

function ZonesSummary({ features }: { features: RoadConditionFeature[] }) {
  const { t } = useI18n();
  const school = features.filter((feature) => feature.properties.kind === "school-zone");
  const silver = features.filter((feature) => feature.properties.kind === "silver-zone");
  const limit = school[0]?.properties.speedLimitKmh ?? silver[0]?.properties.speedLimitKmh;
  return (
    <>
      <span className="mt-2 flex flex-wrap gap-1.5">
        {school.length > 0 && (
          <Chip color="var(--c-zones)">{t("road.kind.school-zone")} {school.length}</Chip>
        )}
        {silver.length > 0 && (
          <Chip color="var(--c-zones)">{t("road.kind.silver-zone")} {silver.length}</Chip>
        )}
        {limit != null && <Chip color="var(--c-zones)">{t("road.zones.limit", { n: limit })}</Chip>}
      </span>
      <span className="mt-1.5 block text-[9px] leading-relaxed text-muted">
        {t("road.zones.zoomNote", { z: ZONE_ZOOM })} · {t("road.zones.limitNote")}
      </span>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Layer 9 · expressway corridor cards + EMAS
 * ------------------------------------------------------------------ */

function CorridorCards({ features }: { features: RoadConditionFeature[] }) {
  const { t } = useI18n();
  const corridors = useMemo(() => {
    // The feed is a segment list per corridor and direction, so the card a driver
    // wants is the whole corridor's estimated time, not one segment of it.
    const grouped = new Map<
      string,
      { corridor: string; minutes: number; end: string; direction?: string }
    >();
    for (const feature of features) {
      if (feature.properties.kind !== "travel-time") continue;
      const { corridor, directionLabel, farEndPoint, endPoint, estMinutes } = feature.properties;
      if (!corridor) continue;
      const key = `${corridor}\u001f${directionLabel ?? ""}`;
      const entry =
        grouped.get(key) ??
        { corridor, minutes: 0, end: farEndPoint ?? endPoint ?? "", direction: directionLabel };
      entry.minutes += estMinutes ?? 0;
      if (!entry.end) entry.end = farEndPoint ?? endPoint ?? "";
      grouped.set(key, entry);
    }
    return [...grouped.values()].sort((a, b) => a.corridor.localeCompare(b.corridor)).slice(0, 12);
  }, [features]);

  if (!corridors.length) return null;
  return (
    <span className="mt-2 block">
      <span className="label mb-1 block text-[9px] text-muted">{t("road.expressway.corridors")}</span>
      <span className="atlas-corridor-grid">
        {corridors.map((corridor, index) => (
          <span key={`${corridor.corridor}-${corridor.direction ?? ""}-${index}`} className="atlas-mini-card atlas-corridor">
            <b>{corridor.corridor}</b>
            <em className="num">{t("road.expressway.minutes", { n: corridor.minutes })}</em>
            <i>{corridor.end || t("road.expressway.wholeRoute")}</i>
          </span>
        ))}
      </span>
    </span>
  );
}

function EmasList({ features }: { features: RoadConditionFeature[] }) {
  const { t } = useI18n();
  const messages = features.filter((feature) => feature.properties.kind === "emas-message");
  return (
    <span className="mt-2 block">
      <span className="label mb-1 block text-[9px] text-muted">{t("road.expressway.emas")}</span>
      {messages.length ? (
        <ul className="space-y-1.5">
          {messages.slice(0, 6).map((feature) => (
            <li key={feature.id} className="atlas-emas-row">
              <span className="atlas-emas-sign" aria-hidden="true" />
              <span className="min-w-0 flex-1">{feature.properties.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="block rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2 text-[10px] leading-relaxed text-muted">
          {t("road.expressway.noMessages")}
        </span>
      )}
      <span className="mt-1.5 block text-[9px] leading-relaxed text-muted">
        {t("road.expressway.cardsNote")}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The layer's own detail
 * ------------------------------------------------------------------ */

export function RoadLayerInfo({
  id,
  info,
  features,
  active,
  status,
  incidentRoute,
  onIncidentRouteChange,
  filters,
  onFilterChange,
}: RoadInfoProps) {
  const { t } = useI18n();
  const own = useMemo(() => byLayer(features, id), [features, id]);
  const routes = id === "incidents" && active ? routeOptions(features) : [];
  const upstream =
    info?.sources.reduce((max, source) => Math.max(max, source.upstreamCount ?? 0), 0) ?? 0;

  const evConnectors = id === "ev" ? connectorValues(own) : [];

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

      {id === "parking" && active && (
        <>
          <FilterSelect
            id={`filter-${id}`}
            label={t("road.filter.vehicleType")}
            value={filters.lotType}
            onChange={(value) => onFilterChange({ lotType: value })}
            options={[
              { value: "", label: t("road.filter.allTypes") },
              { value: "C", label: t(LOT_TYPE_KEYS.C) },
              { value: "H", label: t(LOT_TYPE_KEYS.H) },
              { value: "Y", label: t(LOT_TYPE_KEYS.Y) },
            ]}
          />
          <ParkingSummary features={own} />
        </>
      )}

      {id === "erp" && active && <ErpSummary features={own} />}

      {id === "ev" && active && (
        <>
          <FilterSelect
            id="filter-ev-plug"
            label={t("road.filter.connector")}
            value={filters.plugType}
            onChange={(value) => onFilterChange({ plugType: value })}
            options={[
              { value: "", label: t("road.filter.allConnectors") },
              ...evConnectors.map((value) => ({ value, label: value })),
            ]}
          />
          <FilterSelect
            id="filter-ev-power"
            label={t("road.filter.power")}
            value={filters.minPowerKw != null ? String(filters.minPowerKw) : null}
            onChange={(value) => onFilterChange({ minPowerKw: value ? Number(value) : null })}
            options={[
              { value: "", label: t("road.filter.allPower") },
              ...[7.4, 22, 50, 100].map((kw) => ({ value: String(kw), label: `≥ ${kw} kW` })),
            ]}
          />
          <Toggle
            label={t("road.filter.availableOnly")}
            checked={filters.availableOnly}
            onChange={(checked) => onFilterChange({ availableOnly: checked })}
          />
        </>
      )}

      {id === "zones" && active && <ZonesSummary features={own} />}

      {id === "expressway" && active && (
        <>
          <CorridorCards features={own} />
          <EmasList features={own} />
        </>
      )}

      {routes.length > 0 && (
        <FilterSelect
          id={`route-${id}`}
          label={t("road.filter.route")}
          value={incidentRoute}
          onChange={onIncidentRouteChange}
          options={[
            { value: "", label: t("road.filter.allRoutes") },
            ...routes.map(([route, count]) => ({ value: route, label: `${route} (${count})` })),
          ]}
        />
      )}
    </>
  );
}
