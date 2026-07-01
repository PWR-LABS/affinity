/**
 * Loader for issuer MRF files → {@link MrfDataset}.
 *
 * `providers.json` / `drugs.json` are unauthenticated (no key) but can be large, so responses are
 * cached to disk under data/cache. The loader is tolerant of the two real-world shapes: a bare array,
 * or an object wrapping the array under a `providers` / `drugs` key. The fetch timestamp is recorded
 * for provenance; the per-record `last_updated_on` carries the issuer's own freshness.
 */
import { cached } from "@/lib/cache";

import { MrfDataset } from "./dataset";
import type { MrfDrug, MrfProvider } from "./types";

export interface LoadMrfOptions {
  providersUrl: string;
  drugsUrl: string;
  fetchImpl?: typeof fetch;
  /** ISO timestamp to stamp as fetch time; defaults to now. */
  fetchedAt?: string;
  useCache?: boolean;
}

async function fetchArray<T>(
  url: string,
  key: string,
  fetchImpl: typeof fetch,
  useCache: boolean,
): Promise<T[]> {
  const doFetch = async (): Promise<T[]> => {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    const json: unknown = await res.json();
    return coerceArray<T>(json, key);
  };
  return useCache ? cached<T[]>("mrf", url, doFetch) : doFetch();
}

/** Accept a bare array or `{ [key]: [...] }`; otherwise an empty list (never throw on shape). */
function coerceArray<T>(json: unknown, key: string): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const wrapped = (json as Record<string, unknown>)[key];
    if (Array.isArray(wrapped)) return wrapped as T[];
  }
  return [];
}

export async function loadMrfDataset(opts: LoadMrfOptions): Promise<MrfDataset> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const useCache = opts.useCache ?? true;
  const fetchedAt = opts.fetchedAt ?? nowIso();
  const [providers, drugs] = await Promise.all([
    fetchArray<MrfProvider>(opts.providersUrl, "providers", fetchImpl, useCache),
    fetchArray<MrfDrug>(opts.drugsUrl, "drugs", fetchImpl, useCache),
  ]);
  return new MrfDataset(providers, drugs, fetchedAt, {
    providers: opts.providersUrl,
    drugs: opts.drugsUrl,
  });
}

/** Build a dataset directly from in-memory records (used by fixtures / tests). */
export function datasetFromRecords(
  providers: MrfProvider[],
  drugs: MrfDrug[],
  fetchedAt: string,
): MrfDataset {
  return new MrfDataset(providers, drugs, fetchedAt);
}

function nowIso(): string {
  return new Date().toISOString();
}
