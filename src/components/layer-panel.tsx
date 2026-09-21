"use client";

import type { StringKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { LAYERS } from "@/lib/layers";
import type { LayerId, LayerInfo, SourceStatus } from "@/lib/types";
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

function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      <path
        d="M6 3.4 L11.6 13.2 H0.4 Z"
        fill="none"
        stroke="var(--c-speed)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <rect
        x="7.6"
        y="7.4"
        width="9.4"
        height="9.4"
        rx="2.2"
        fill="none"
        stroke="var(--c-snapshot)"
        strokeWidth="1.5"
      />
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
      {id === "speed" && (
        <path d="M10 3.4 L17 16.4 H3 Z" {...common} strokeLinejoin="round" />
      )}
      {id === "snapshot" && (
        <>
          <rect x="3" y="4.6" width="14" height="10.8" rx="2.4" {...common} />
          <circle cx="10" cy="10" r="2.2" fill={color} />
        </>
      )}
    </svg>
  );
}

function Switch({ on, color, label, onClick }: { on: boolean; color: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="relative h-10 w-10 shrink-0 self-center rounded-full"
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

export function LayerPanel({
  layers,
  active,
  onToggle,
  loading,
  error,
  generatedAt,
  fromCache,
  onRetry,
  collapsed,
  onCollapsedChange,
  className = "",
}: LayerPanelProps) {
  const { t, lang } = useI18n();
  const totalPoints = layers?.reduce((n, l) => n + l.count, 0) ?? 0;
  const anyOn = LAYERS.some((def) => active[def.id]);

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
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-[11px] font-semibold text-[var(--err)] underline underline-offset-2"
          >
            {t("status.retry")}
          </button>
        </div>
      )}

      {loading && !layers ? (
        <ul className="px-4 pb-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 py-4">
              <div className="skeleton h-5 w-5 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-3 w-24 rounded-full" />
                <div className="skeleton h-2.5 w-40 rounded-full" />
                <div className="skeleton h-4 w-14 rounded-full" />
              </div>
              <div className="skeleton h-6 w-10 rounded-full" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="scroll-thin min-h-0 space-y-2 overflow-y-auto px-3">
          {LAYERS.map((def) => {
            const info = layers?.find((l) => l.id === def.id);
            const on = active[def.id];
            const kinds = def.kinds
              .map((k) => [k, info?.kinds?.[k] ?? 0] as const)
              .filter(([, n]) => n > 0);
            const status = info && info.status !== "ok" ? STATUS_STYLE[info.status] : null;
            return (
              <li key={def.id} data-layer={def.id} data-active={on} className="atlas-layer p-3">
                <div className="flex gap-2.5">
                  <span className="atlas-layer-glyph"><Glyph id={def.id} color={def.color} /></span>
                  <button
                    type="button"
                    onClick={() => onToggle(def.id)}
                    aria-label={t(on ? "panel.off" : "panel.on")}
                    className="min-w-0 flex-1 pt-0.5 text-left"
                  >
                    <span className="block text-[13px] font-semibold">{t(`layer.${def.id}.name`)}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted)]">
                      {t(`layer.${def.id}.note`)}
                    </span>
                    <span className="mt-2 flex flex-wrap items-baseline gap-1.5">
                      <span className={`num text-[26px] leading-none font-medium tracking-tight ${on ? "" : "text-[var(--muted)]"}`}>
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
                  </button>
                  <Switch
                    on={on}
                    color={def.color}
                    label={t(on ? "panel.off" : "panel.on")}
                    onClick={() => onToggle(def.id)}
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
          })}
        </ul>
      )}

      {layers && (
        <footer className="atlas-layer-footer shrink-0 space-y-1 border-t border-line px-4 py-3 text-[10px] leading-relaxed text-muted">
          {!anyOn && (
            <p className="mb-2 rounded-md bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--warn)]">
              {t("panel.allOff")}
            </p>
          )}
          <p>{t("panel.summary", { layers: LAYERS.length, points: totalPoints })}</p>
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
