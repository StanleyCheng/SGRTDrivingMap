"use client";

import { useState } from "react";
import { formatTime, relativeAge } from "@/lib/format";
import { useI18n } from "./i18n-provider";

export interface TrafficImageProps {
  url: string | null;
  capturedAt?: string | null;
  status: "loading" | "ok" | "error" | "none";
  errorText?: string | null;
  alt: string;
  onRetry?: () => void;
}

function WarningGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--err)"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function NoImageGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--muted)"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-1.8h7.2L16.8 6h1.7A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-8Z" />
      <path d="m4 4 16 16" />
    </svg>
  );
}

export function TrafficImage({
  url,
  capturedAt,
  status,
  errorText,
  alt,
  onRetry,
}: TrafficImageProps) {
  const { t, lang } = useI18n();
  // Track the failed URL rather than a boolean, so a fresh URL clears the error
  // without an effect-driven state reset.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  const broken = Boolean(url) && brokenUrl === url;

  const showImage = status === "ok" && Boolean(url) && !broken;
  const empty = status === "none";

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)]">
        {status === "loading" && (
          <>
            <div className="skeleton absolute inset-0" />
            <span className="absolute inset-0 grid place-items-center text-[12px] text-[var(--muted)]">
              {t("traffic.loadingTitle")}
            </span>
          </>
        )}

        {showImage && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url as string}
            alt={alt}
            loading="lazy"
            decoding="async"
            onError={() => url && setBrokenUrl(url)}
            className="h-full w-full object-cover"
          />
        )}

        {status !== "loading" && !showImage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center">
            {empty ? <NoImageGlyph /> : <WarningGlyph />}
            <p className="text-[12px] leading-snug text-[var(--ink-2)]">
              {empty ? t("detail.noImage") : t("traffic.error")}
            </p>
            {!empty && errorText && (
              <p className="max-w-full font-mono text-[11px] break-words text-[var(--muted)]">
                {errorText}
              </p>
            )}
            {!empty && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="label mt-0.5 rounded px-1 py-0.5 text-[var(--accent)] hover:underline"
              >
                {t("status.retry")}
              </button>
            )}
          </div>
        )}
      </div>

      {(capturedAt || showImage) && (
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
          <span className="text-[var(--ink-2)]">
            {capturedAt ? `${t("detail.captured")} ${formatTime(capturedAt, lang)}` : ""}
          </span>
          <span className="num text-[var(--muted)]">
            {capturedAt ? relativeAge(capturedAt, lang) : ""}
          </span>
        </div>
      )}

      {showImage && url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--ink)]"
        >
          {t("detail.openFull")}
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
        </a>
      )}
    </div>
  );
}
