"use client";

import { formatCoords, formatDate } from "@/lib/format";
import { LAYER_BY_ID, layerColor } from "@/lib/layers";
import type { CameraPoint, LayerInfo } from "@/lib/types";
import { useI18n } from "./i18n-provider";
import { TrafficImage } from "./traffic-image";

export interface DetailImage {
  url: string;
  capturedAt?: string | null;
}

export interface DetailPanelProps {
  point: CameraPoint | null;
  layer: LayerInfo | null;
  image: DetailImage | null;
  imageStatus: "loading" | "ok" | "error" | "none";
  imageError?: string | null;
  onClose: () => void;
  onZoom: (point: CameraPoint) => void;
  onRetryImage?: () => void;
  className?: string;
}

function CloseGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function CrosshairGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function ExternalGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function DetailPanel({
  point,
  layer,
  image,
  imageStatus,
  imageError,
  onClose,
  onZoom,
  onRetryImage,
  className = "",
}: DetailPanelProps) {
  const { t, lang } = useI18n();

  const shell = `panel rise w-[min(92vw,360px)] p-4 max-h-[70vh] overflow-y-auto scroll-thin ${className}`;

  if (!point) {
    return (
      <div className={shell}>
        <div className="flex items-start gap-2.5 py-1 text-[13px] text-[var(--muted)]">
          <span className="mt-0.5 shrink-0">
            <CrosshairGlyph size={15} />
          </span>
          <p className="leading-snug">{t("detail.empty")}</p>
        </div>
      </div>
    );
  }

  const color = layerColor(point.layer);
  const def = LAYER_BY_ID.get(point.layer);
  const title = point.road || `${t("kind.snapshot")} #${point.ref}`;

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: t("detail.road"), value: point.road || "—" },
    ...(point.desc ? [{ label: t("detail.desc"), value: point.desc }] : []),
    { label: t("detail.coords"), value: formatCoords(point.lat, point.lng), mono: true },
    { label: t("detail.ref"), value: point.ref, mono: true },
  ];

  return (
    <div className={shell}>
      <div
        className="-mx-4 -mt-4 mb-3 h-[3px] rounded-t-[13px]"
        style={{ background: color }}
        aria-hidden="true"
      />

      <div className="flex items-start justify-between gap-3">
        <span
          className="inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-semibold"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
            color,
          }}
        >
          {t(`kind.${point.kind}`)}
        </span>
        <button
          type="button"
          onClick={onClose}
          data-tip={t("common.close")}
          aria-label={t("common.close")}
          className="tip tip-right -mt-1 -mr-1 grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        >
          <CloseGlyph />
        </button>
      </div>

      <h2
        className={`mt-2 text-[17px] leading-snug font-semibold ${lang === "zh" ? "tracking-tight" : ""}`}
      >
        {title}
      </h2>
      {point.direction && (
        <p className="mt-1 text-[12px] text-[var(--ink-2)]">
          {t("detail.direction")}: {point.direction}
        </p>
      )}
      {point.live && (
        <span
          className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-semibold"
          style={{
            backgroundColor: "color-mix(in srgb, var(--c-snapshot) 12%, transparent)",
            color: "var(--c-snapshot)",
          }}
        >
          <span
            className="pulse h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--c-snapshot)" }}
          />
          {t("common.live")}
        </span>
      )}

      <dl className="mt-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-0.5 border-t border-[var(--line)] py-2 sm:flex-row sm:items-baseline sm:gap-3"
          >
            <dt className="label text-[var(--muted)] sm:w-24 sm:shrink-0">{row.label}</dt>
            <dd
              className={`text-[13px] break-words text-[var(--ink)] ${row.mono ? "font-mono text-[12px]" : ""}`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {point.layer === "snapshot" && (
        <section className="mt-4">
          <h3 className="label mb-2 text-[var(--muted)]">{t("detail.snapshot")}</h3>
          <TrafficImage
            url={image?.url ?? null}
            capturedAt={image?.capturedAt}
            status={imageStatus}
            errorText={imageError}
            alt={title}
            onRetry={onRetryImage}
          />
        </section>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--line)] pt-3">
        <button
          type="button"
          onClick={() => onZoom(point)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[12px] font-medium hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]"
        >
          <CrosshairGlyph size={14} />
          {t("detail.zoom")}
        </button>
      </div>

      {def && (
        <section className="mt-4 border-t border-[var(--line)] pt-3">
          <h3 className="label mb-2 text-[var(--muted)]">{t("detail.source")}</h3>
          <ul className="space-y-1.5">
            {def.source.map((s) => {
              const live = layer?.sources.find((ls) => ls.name.includes(s.dataset));
              return (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-start gap-1 text-[11px] leading-snug text-[var(--muted)] hover:text-[var(--ink)]"
                  >
                    <span>
                      {lang === "zh" ? s.agencyZh : s.agency} —{" "}
                      {lang === "zh" ? s.datasetZh : s.dataset}
                    </span>
                    <span className="mt-0.5 shrink-0">
                      <ExternalGlyph />
                    </span>
                  </a>
                  {live?.updatedAt && (
                    <p className="num text-[10px] text-[var(--muted)] opacity-80">
                      {t("status.sourceRev")} {formatDate(live.updatedAt, lang)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
