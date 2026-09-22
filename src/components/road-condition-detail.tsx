"use client";

import type { CSSProperties } from "react";
import { formatCoords, formatDateTime } from "@/lib/format";
import { geometryFocus } from "@/lib/geometry";
import { ROAD_LAYER_COLOR } from "@/lib/layers";
import type { RoadConditionFeature, RoadConditionLayerInfo } from "@/lib/types";
import { useI18n } from "./i18n-provider";
import { LOT_TYPE_KEYS } from "./layer-ui";

function CloseGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function CrosshairGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function ExternalGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

interface RoadConditionDetailProps {
  feature: RoadConditionFeature;
  layer: RoadConditionLayerInfo | null;
  onClose: () => void;
  onZoom: (feature: RoadConditionFeature) => void;
  className?: string;
}

export function RoadConditionDetail({
  feature,
  layer,
  onClose,
  onZoom,
  className = "",
}: RoadConditionDetailProps) {
  const { t, lang } = useI18n();
  const { properties, geometry } = feature;
  const color = ROAD_LAYER_COLOR[properties.layer];
  const centre = geometryFocus(geometry);
  const coordinates =
    geometry?.type === "Point"
      ? formatCoords(geometry.coordinates[1], geometry.coordinates[0])
      : geometry?.type === "LineString" && geometry.coordinates.length >= 2
        ? `${formatCoords(geometry.coordinates[0][1], geometry.coordinates[0][0])} ${t("road.detail.to")} ${formatCoords(
            geometry.coordinates[geometry.coordinates.length - 1][1],
            geometry.coordinates[geometry.coordinates.length - 1][0],
          )}`
        : centre
          ? formatCoords(centre.lat, centre.lng)
          : "—";
  const speed =
    properties.minimumSpeed != null || properties.maximumSpeed != null
      ? `${properties.minimumSpeed ?? 0}–${properties.maximumSpeed ?? "∞"} km/h`
      : properties.speedBand != null
        ? `${t("road.detail.band")} ${properties.speedBand}`
        : null;
  const period =
    properties.startsAt && properties.endsAt
      ? `${formatDateTime(properties.startsAt, lang)} ${t("road.detail.to")} ${formatDateTime(properties.endsAt, lang)}`
      : null;

  const money = (value: number) => `$${value.toFixed(2)}`;
  const lotType = properties.lotType ? t(LOT_TYPE_KEYS[properties.lotType] ?? "road.detail.lotType") : null;
  const points =
    properties.totalPoints != null
      ? `${properties.availablePoints ?? 0} / ${properties.totalPoints}`
      : null;
  const segment =
    properties.startPoint || properties.endPoint
      ? `${properties.startPoint ?? "—"} → ${properties.endPoint ?? "—"}`
      : null;

  const rows = [
    properties.route ? { label: t("road.detail.route"), value: properties.route } : null,
    properties.direction ? { label: t("road.detail.direction"), value: properties.direction } : null,
    properties.directionLabel
      ? { label: t("road.detail.direction"), value: properties.directionLabel }
      : null,
    properties.landmark ? { label: t("road.detail.landmark"), value: properties.landmark } : null,
    properties.lane ? { label: t("road.detail.lane"), value: properties.lane } : null,
    properties.reportedText
      ? { label: t("road.detail.reported"), value: properties.reportedText }
      : null,
    properties.road && properties.road !== properties.route
      ? { label: t("road.detail.road"), value: properties.road }
      : null,
    properties.development && properties.development !== properties.road
      ? { label: t("road.detail.development"), value: properties.development }
      : null,
    properties.description
      ? { label: t("road.detail.description"), value: properties.description }
      : null,
    speed ? { label: t("road.detail.speed"), value: speed } : null,
    properties.severity
      ? { label: t("road.detail.severity"), value: properties.severity }
      : null,
    properties.availableLots != null
      ? { label: t("road.detail.lots"), value: `${properties.availableLots}` }
      : null,
    lotType ? { label: t("road.detail.lotType"), value: lotType } : null,
    properties.kind === "parking-lot"
      ? {
          label: t("road.detail.gantryHeight"),
          // URA and LTA carparks have no published height; say so instead of
          // implying the data is missing by accident.
          value:
            properties.gantryHeightM != null
              ? `${properties.gantryHeightM} m · HDB Carpark Information`
              : t("road.parking.noHeight"),
        }
      : null,
    properties.zoneId ? { label: t("road.detail.zone"), value: properties.zoneId } : null,
    properties.charge != null
      ? {
          label: t("road.detail.charge"),
          value: `${money(properties.charge)}${properties.chargeWindow ? ` · ${properties.chargeWindow}` : ""}`,
        }
      : null,
    properties.nextCharge != null
      ? {
          label: t("road.detail.nextCharge"),
          value: `${money(properties.nextCharge)}${properties.nextWindow ? ` · ${properties.nextWindow}` : ""}`,
        }
      : null,
    properties.plugType ? { label: t("road.detail.connector"), value: properties.plugType } : null,
    properties.powerRatingKw != null
      ? { label: t("road.detail.power"), value: `${properties.powerRatingKw} kW` }
      : null,
    properties.chargingSpeedKw != null
      ? { label: t("road.detail.chargingSpeed"), value: `${properties.chargingSpeedKw} kW` }
      : null,
    properties.operatorName
      ? { label: t("road.detail.operator"), value: properties.operatorName }
      : null,
    points ? { label: t("road.detail.points"), value: points } : null,
    properties.zoneType ? { label: t("road.detail.zoneType"), value: properties.zoneType } : null,
    properties.speedLimitKmh != null
      ? { label: t("road.detail.speedLimit"), value: t("road.zones.limit", { n: properties.speedLimitKmh }) }
      : null,
    properties.corridor ? { label: t("road.detail.corridor"), value: properties.corridor } : null,
    properties.estMinutes != null
      ? { label: t("road.detail.estTime"), value: t("road.expressway.minutes", { n: properties.estMinutes }) }
      : null,
    segment ? { label: t("road.detail.segment"), value: segment } : null,
    properties.equipmentId
      ? { label: t("road.detail.equipment"), value: properties.equipmentId }
      : null,
    period ? { label: t("road.detail.period"), value: period } : null,
    properties.startsAt && !properties.endsAt && !properties.reportedText
      ? { label: t("road.detail.reported"), value: formatDateTime(properties.startsAt, lang) }
      : null,
    { label: t(geometry?.type === "LineString" ? "road.detail.segment" : "road.detail.coords"), value: coordinates, mono: true },
    { label: t("road.detail.ref"), value: properties.sourceId, mono: true },
    properties.agency ? { label: t("road.detail.agency"), value: properties.agency } : null,
  ].filter((row): row is { label: string; value: string; mono?: boolean } => Boolean(row));

  return (
    <article
      className={`panel atlas-road-detail rise w-[min(92vw,360px)] max-h-[70vh] overflow-y-auto p-5 scroll-thin ${className}`}
      style={{ "--detail-color": color } as CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-semibold"
          style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
        >
          {t(`road.kind.${properties.kind}`)}
        </span>
        <button
          type="button"
          onClick={onClose}
          data-tip={t("common.close")}
          aria-label={t("common.close")}
          className="tip tip-right atlas-icon-button -mt-1 -mr-1"
        >
          <CloseGlyph />
        </button>
      </div>

      <h2 className={`mt-3 text-[20px] leading-snug font-semibold ${lang === "zh" ? "tracking-tight" : ""}`}>
        {properties.title}
      </h2>

      <dl className="mt-4 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1 border-t border-line py-2.5 first:border-t-0 sm:flex-row sm:items-baseline sm:gap-3">
            <dt className="label text-[var(--muted)] sm:w-24 sm:shrink-0">{row.label}</dt>
            <dd className={`text-[13px] break-words text-[var(--ink)] ${row.mono ? "font-mono text-[11px]" : ""}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--line)] pt-3">
        <button
          type="button"
          onClick={() => onZoom(feature)}
          className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-ink transition-colors hover:bg-ink"
        >
          <CrosshairGlyph />
          {t("detail.zoom")}
        </button>
      </div>

      {layer && layer.sources.length > 0 && (
        <section className="mt-4 border-t border-[var(--line)] pt-3">
          <h3 className="label mb-2 text-[var(--muted)]">{t("road.detail.source")}</h3>
          <ul className="space-y-1.5">
            {layer.sources.map((source) => (
              <li key={`${source.name}:${source.url}`}>
                <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-[11px] leading-snug text-[var(--muted)] hover:text-[var(--ink)]">
                  <span>{source.name}</span>
                  <span className="mt-0.5 shrink-0"><ExternalGlyph /></span>
                </a>
                {source.fetchedAt && (
                  <p className="num text-[10px] text-[var(--muted)] opacity-80">
                    {t("status.updated")} {formatDateTime(source.fetchedAt, lang)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
