"use client";

import { useEffect } from "react";
import { useI18n } from "@/components/i18n-provider";
import { STATIC_MODE } from "@/lib/client-data";
import { formatDate } from "@/lib/format";
import { LAYERS } from "@/lib/layers";
import type { CameraKind, LayerInfo } from "@/lib/types";

export interface SourcesPanelProps {
  layers: LayerInfo[] | null;
  open: boolean;
  onClose: () => void;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden="true">
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5 shrink-0" aria-hidden="true">
      <path
        d="M8 5.5H5.6a1 1 0 0 0-1 1v7.9a1 1 0 0 0 1 1h7.9a1 1 0 0 0 1-1V12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M11.6 4.4h4v4M15.2 4.8 9.6 10.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function ClusterGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0" aria-hidden="true">
      <circle cx="10" cy="10" r="6.6" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="10" cy="10" r="5.4" stroke="#fff" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

export function SourcesPanel({ layers, open, onClose }: SourcesPanelProps) {
  const { t, lang } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const dot = (color: string) => (
    <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="fixed inset-0 cursor-default"
        style={{ background: "rgba(23,19,15,0.35)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("src.title")}
        className="panel rise scroll-thin relative max-h-[82vh] w-[min(94vw,520px)] overflow-y-auto p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-[17px] leading-tight text-ink">{t("src.title")}</h2>
            <p className="mt-0.5 text-[11px] text-muted">{t("src.attribution")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="tip tip-right grid size-9 shrink-0 place-items-center rounded-xl border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            data-tip={t("common.close")}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {LAYERS.map((def) => {
            const info = layers?.find((l) => l.id === def.id);
            const kindEntries = Object.entries(info?.kinds ?? {}) as [CameraKind, number][];
            return (
              <section key={def.id}>
                <div className="flex items-center gap-2">
                  {dot(def.color)}
                  <h3 className="text-[13px] font-semibold text-ink">{t(`layer.${def.id}.name`)}</h3>
                  <span className="num ml-auto text-[11px] text-ink-2">
                    {info ? (
                      <>
                        {info.count} {t("common.locations")}
                      </>
                    ) : (
                      <span className="skeleton block h-3 w-24 rounded" />
                    )}
                  </span>
                </div>

                {kindEntries.length > 1 && (
                  <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {kindEntries.map(([kind, count]) => (
                      <li key={kind} className="num flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="size-1.5 rounded-full" style={{ background: def.color }} />
                        {t(`kind.${kind}`)} {count}
                      </li>
                    ))}
                  </ul>
                )}

                <ul className="mt-2 space-y-1">
                  {def.source.map((s) => (
                    <li key={s.url}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-ink-2">
                            {lang === "zh" ? s.datasetZh : s.dataset}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted">
                            {lang === "zh" ? s.agencyZh : s.agency} · {new URL(s.url).host}
                            {revision(t("status.sourceRev"), info, s.url, lang)}
                          </span>
                        </span>
                        <span className="mt-1 text-muted">
                          <ExternalIcon />
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="mt-6 border-t border-line pt-4">
          <p className="label text-muted">{t("legend.title")}</p>
          <ul className="mt-2 space-y-1.5">
            {LAYERS.map((def) => (
              <li key={def.id} className="flex items-center gap-2 text-[12px] text-ink-2">
                {dot(def.color)}
                {t(`layer.${def.id}.name`)}
              </li>
            ))}
            <li className="flex items-center gap-2 text-[12px] text-ink-2">
              <span className="text-ink">
                <ClusterGlyph />
              </span>
              {t("legend.cluster")}
            </li>
          </ul>
        </div>

        <div className="mt-5 border-t border-line pt-3">
          <p className="text-[11px] leading-relaxed text-ink-2">
            {t("src.gapNote")}{" "}
            <a
              href="https://www.police.gov.sg/Knowledge-Hub/Traffic/Traffic-Matters/Speed-Enforcement-Camera-Locations"
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-dotted underline-offset-2 hover:text-ink"
            >
              police.gov.sg
            </a>
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-2">{t("src.disclaimer")}</p>
          {STATIC_MODE && (
            <p className="mt-2 text-[11px] leading-relaxed text-warn">{t("src.staticNote")}</p>
          )}
          <p className="mt-2 text-[10px] text-muted">
            {t("src.basemap")} · © OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors
          </p>
        </div>
      </div>
    </div>
  );
}

function revision(label: string, info: LayerInfo | undefined, url: string, lang: "en" | "zh") {
  const source = info?.sources.find((s) => s.url === url);
  if (!source?.updatedAt) return "";
  return ` · ${label} ${formatDate(source.updatedAt, lang)}`;
}
