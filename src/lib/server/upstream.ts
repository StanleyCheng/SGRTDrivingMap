/**
 * Shared upstream plumbing for the two official feeds this app reads:
 *
 *  - data.gov.sg — keyless, but anonymous callers are limited to roughly one
 *    request every 10 seconds, so every caller in the process shares one queue.
 *  - LTA DataMall — every request needs the server-only `DATAMALL_ACCOUNT_KEY`.
 *
 * Both live here so the camera, road-condition and mobility modules cannot
 * accidentally double up on either budget.
 */

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export async function getJson(url: string, init?: RequestInit, timeoutMs = 20000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) {
      throw new UpstreamError(
        res.status === 429
          ? "Rate limited by data.gov.sg (HTTP 429)"
          : `HTTP ${res.status} from ${new URL(url).host}`,
        res.status,
      );
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * LTA DataMall
 * ------------------------------------------------------------------ */

export const DATAMALL_BASE = "https://datamall2.mytransport.sg/ltaodataservice";

export function datamallKey() {
  const key = process.env.DATAMALL_ACCOUNT_KEY?.trim();
  if (!key) throw new UpstreamError("DATAMALL_ACCOUNT_KEY is not configured");
  return key;
}

export async function datamall(pathname: string, timeoutMs = 20000): Promise<any> {
  return getJson(
    `${DATAMALL_BASE}/${pathname}`,
    { headers: { AccountKey: datamallKey(), accept: "application/json", "User-Agent": BROWSER_UA } },
    timeoutMs,
  );
}

/* ------------------------------------------------------------------ *
 * data.gov.sg
 * ------------------------------------------------------------------ */

/**
 * data.gov.sg allows roughly one anonymous request per 10s; serialise the whole
 * process with a gap so a cold refresh never trips HTTP 429.
 */
let dgChain: Promise<unknown> = Promise.resolve();
let dgLast = 0;
const DG_GAP = 11000;

export function dgQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = dgChain.then(async () => {
    const wait = dgLast + DG_GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      dgLast = Date.now();
    }
  });
  dgChain = run.catch(() => {});
  return run;
}

/** Download a data.gov.sg dataset (poll-download → presigned S3 URL) as text. */
export async function dgDownload(datasetId: string, attempt = 0): Promise<any> {
  try {
    const poll = await getJson(
      `https://api-open.data.gov.sg/v1/public/api/datasets/${datasetId}/poll-download`,
      { headers: { "x-api-key": "public", "User-Agent": BROWSER_UA, Accept: "*/*" } },
    );
    if (poll?.code !== 0 || !poll?.data?.url) {
      throw new UpstreamError(poll?.errorMsg ?? "data.gov.sg returned no download URL");
    }
    const res = await fetch(poll.data.url, { cache: "no-store" });
    if (!res.ok) throw new UpstreamError(`Dataset file download failed (HTTP ${res.status})`);
    return res.text();
  } catch (err) {
    const retriable = !(err instanceof UpstreamError) || err.status === 429;
    if (retriable && attempt < 2) {
      await new Promise((r) => setTimeout(r, 12000 * (attempt + 1)));
      return dgDownload(datasetId, attempt + 1);
    }
    throw err;
  }
}

export async function dgJson(datasetId: string): Promise<any> {
  const text = await dgDownload(datasetId);
  return JSON.parse(String(text).replace(/^\uFEFF/, ""));
}

export async function dgText(datasetId: string): Promise<string> {
  return String(await dgDownload(datasetId)).replace(/^\uFEFF/, "");
}

/** data.gov.sg catalogue metadata — no anonymous rate limit observed. */
export async function dgMetadata(datasetId: string): Promise<any | null> {
  try {
    const j = await getJson(
      `https://api-production.data.gov.sg/v2/public/api/datasets/${datasetId}/metadata`,
      { headers: { "User-Agent": BROWSER_UA } },
      10000,
    );
    return j?.data ?? null;
  } catch {
    return null;
  }
}
