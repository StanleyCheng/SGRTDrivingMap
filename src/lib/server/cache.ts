import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Tiny JSON cache: memory → disk → bundled seed.
 * Next.js route handlers are dynamic, so this module owns all caching.
 * ponytail: no cache library, no TTL daemon — one file per key + in-process Map.
 */
export interface CacheEntry<T> {
  data: T;
  /** ISO time this payload was successfully pulled from upstream. */
  generatedAt: string;
}

const mem = new Map<string, CacheEntry<unknown>>();
const DIR = path.join(process.cwd(), ".cache");

export function readMemory<T>(key: string): CacheEntry<T> | undefined {
  return mem.get(key) as CacheEntry<T> | undefined;
}

export function writeMemory<T>(key: string, entry: CacheEntry<T>) {
  mem.set(key, entry);
}

export async function readDisk<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, `${key}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function writeDisk<T>(key: string, entry: CacheEntry<T>) {
  try {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, `${key}.json`), JSON.stringify(entry));
  } catch (error) {
    // Read-only filesystem (e.g. serverless): memory cache still applies. Any
    // other failure is worth surfacing once, because it silently weakens the
    // stale-fallback this app relies on when an upstream feed is unreachable.
    const code = (error as NodeJS.ErrnoException).code;
    if (code && !["EROFS", "EACCES", "EPERM"].includes(code)) {
      console.error(`[cache] could not persist ${key}:`, error);
    }
  }
}

export function ageMs(entry: CacheEntry<unknown>) {
  return Date.now() - new Date(entry.generatedAt).getTime();
}
