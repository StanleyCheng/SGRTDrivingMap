import { translate, type StringKey } from "./i18n";
import type { Lang } from "./types";

const LOCALE: Record<Lang, string> = { en: "en-SG", zh: "zh-Hant-SG" };

export function formatDateTime(iso: string | undefined | null, lang: Lang): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).format(d);
}

export function formatTime(iso: string | undefined | null, lang: Lang): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE[lang], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).format(d);
}

export function formatDate(iso: string | undefined | null, lang: Lang): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(d);
}

export function relativeAge(iso: string | undefined | null, lang: Lang): string {
  if (!iso) return "—";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return translate(lang, "traffic.age", { n: secs });
  const mins = Math.round(secs / 60);
  return lang === "zh" ? `${mins} 分鐘前` : `${mins} min ago`;
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function t(lang: Lang, key: StringKey, vars?: Record<string, string | number>) {
  return translate(lang, key, vars);
}
