"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { LANGS } from "@/lib/i18n";

export interface AppHeaderProps {
  onOpenSources: () => void;
  className?: string;
}

function LogoMark() {
  return (
    <Image
      src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon.png`}
      alt=""
      width={30}
      height={30}
      className="size-[34px] shrink-0 rounded-[var(--radius-control)] sm:size-10"
      priority
    />
  );
}

function SourcesIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden="true">
      <path
        d="M5.5 3.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M11.5 3.6V7h3.4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
      <path d="M7.5 11h5M7.5 13.8h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function AppHeader({ onOpenSources, className = "" }: AppHeaderProps) {
  const { lang, setLang, t } = useI18n();
  const [clock, setClock] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      hour12: false,
      timeZone: "Asia/Singapore",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const tick = () => setClock(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-expanded={false}
        aria-label={t("header.expand")}
        data-tip={t("header.expand")}
        className={`tip tip-right panel atlas-header inline-flex items-center p-1.5 ${className}`}
      >
        <LogoMark />
      </button>
    );
  }

  return (
    <header
      // The bar itself retracts; the controls inside opt out via stopPropagation.
      role="button"
      tabIndex={0}
      aria-expanded
      aria-label={t("header.collapse")}
      data-tip={t("header.collapse")}
      onClick={() => setCollapsed(true)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setCollapsed(true);
      }}
      className={`tip tip-right panel atlas-header flex min-w-0 max-w-full cursor-pointer items-center gap-3 px-3 py-2.5 sm:gap-5 sm:px-4 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <LogoMark />
        <div className="min-w-0">
          <h1 className="atlas-wordmark truncate font-display text-[17px] leading-tight text-ink sm:text-[23px]">{t("app.title")}</h1>
          <p className="mt-0.5 max-w-[42vw] truncate text-[10px] leading-tight text-ink-2 sm:max-w-none sm:text-[11px]">
            {t("app.subtitle")}
          </p>
        </div>
      </div>

      <div
        className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="atlas-clock hidden flex-col gap-1 lg:flex">
          <span className="label text-muted">SGT</span>
          <span className="num text-[13px] font-medium text-ink-2">{clock}</span>
        </div>

        <div
          role="group"
          aria-label={t("lang.switch")}
          className="relative flex h-10 w-[100px] shrink-0 items-center rounded-full border border-line-strong/50 bg-surface/60 p-0.5"
        >
          <span
            aria-hidden="true"
            className="absolute top-0.5 bottom-0.5 left-0.5 w-[46px] rounded-full bg-accent transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{ transform: lang === "zh" ? "translateX(48px)" : "translateX(0)" }}
          />
          {LANGS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLang(l.id)}
              aria-pressed={lang === l.id}
              aria-label={l.id === "en" ? t("lang.en") : t("lang.zh")}
              className={`relative z-10 h-10 flex-1 rounded-full text-[11px] font-semibold leading-none transition-colors ${
                lang === l.id ? "text-accent-ink" : "text-ink-2 hover:text-ink"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onOpenSources}
          aria-label={t("src.title")}
          className="tip tip-right atlas-icon-button"
          data-tip={t("src.title")}
        >
          <SourcesIcon />
        </button>
      </div>
    </header>
  );
}
