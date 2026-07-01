/**
 * Tiny provenance-friendly disk cache for fetched plan/provider/formulary data.
 *
 * Everything we pull from the Marketplace API or an issuer MRF is large and regenerable, so it lives
 * under `data/cache/` (gitignored). Caching keeps eval runs cheap and lets us record *when* a datum
 * was fetched — which the provenance layer needs. This is deliberately minimal (no TTL eviction);
 * the freshness signal lives in the data, not in the cache.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const CACHE_ROOT = path.join(process.cwd(), "data", "cache");

function keyToPath(namespace: string, key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return path.join(CACHE_ROOT, namespace, `${hash}.json`);
}

export async function cacheGet<T>(namespace: string, key: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(keyToPath(namespace, key), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function cacheSet<T>(namespace: string, key: string, value: T): Promise<void> {
  const file = keyToPath(namespace, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/** Read-through cache helper: return cached value or compute, store, and return it. */
export async function cached<T>(
  namespace: string,
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(namespace, key);
  if (hit !== undefined) return hit;
  const value = await compute();
  await cacheSet(namespace, key, value);
  return value;
}
