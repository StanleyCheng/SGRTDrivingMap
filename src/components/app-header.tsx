"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import appIcon from "@/app/icon.png";
import { useI18n } from "@/components/i18n-provider";
import { LANGS } from "@/lib/i18n";

export interface AppHeaderProps {
  onOpenSources: () => void;
  className?: string;
}

function LogoMark() {
  return (
    <Image
      src={appIcon}
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

  return (
    <header className={`panel flex items-center gap-3 px-3 py-2 ${className}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <LogoMark />
        <div className="min-w-0">
          <h1 className="truncate font-display text-[15px] leading-tight text-ink">{t("app.title")}</h1>
          <p className="max-w-[42vw] truncate text-[10px] leading-tight text-muted sm:max-w-none">
            {t("app.subtitle")}
          </p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden items-baseline gap-1.5 sm:flex">
          <span className="label text-muted">SGT</span>
          <span className="num text-[13px] font-medium text-ink-2">{clock}</span>
        </div>

        <div
          role="group"
          aria-label={t("lang.switch")}
          className="relative flex h-8 w-[100px] shrink-0 items-center rounded-full border border-line bg-paper p-0.5"
        >
          <span
            aria-hidden="true"
            className="absolute top-0.5 bottom-0.5 left-0.5 w-[46px] rounded-full border border-line bg-surface shadow-[0_1px_2px_rgba(23,19,15,0.10)] transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{ transform: lang === "zh" ? "translateX(48px)" : "translateX(0)" }}
          />
          {LANGS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLang(l.id)}
              aria-pressed={lang === l.id}
              aria-label={l.id === "en" ? t("lang.en") : t("lang.zh")}
              className={`relative z-10 h-7 flex-1 rounded-full text-[11px] font-semibold leading-none transition-colors ${
                lang === l.id ? "text-ink" : "text-muted hover:text-ink-2"
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
          className="tip tip-right grid size-9 place-items-center rounded-xl border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          data-tip={t("src.title")}
        >
          <SourcesIcon />
        </button>
      </div>
    </header>
  );
}
