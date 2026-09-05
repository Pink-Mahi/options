/**
 * Lightweight TTL cache for market data.
 *
 * Different data types use different TTLs per the spec:
 *  - quotes: very short while market open
 *  - option chains: short while market open
 *  - historical daily prices: long
 *  - corporate events: medium
 *
 * The cache ALWAYS preserves the original `fetchedAt` timestamp so the UI can
 * show data freshness even when serving from cache.
 */

import type { MarketDataResult } from "./provider";

interface CacheEntry<T> {
  result: MarketDataResult<T>;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;

export class MarketDataCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private pending = new Map<string, Promise<MarketDataResult<unknown>>>();
  private ttlByKind: Record<string, number>;
  private readonly maxEntries = 500;

  constructor(ttlByKind: Partial<Record<string, number>> = {}) {
    this.ttlByKind = {
      quote: 15_000,
      expirations: 30_000,
      option_chain: 30_000,
      historical: 6 * 60 * 60 * 1000, // 6h
      events: 60 * 60 * 1000, // 1h
      ...ttlByKind,
    };
  }

  /** Returns a cached result if still fresh, else null. */
  get<T>(key: string): MarketDataResult<T> | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // Return a copy with fromCache=true, preserving original fetchedAt.
    return { ...entry.result, fromCache: true };
  }

  set<T>(key: string, kind: keyof typeof this.ttlByKind, result: MarketDataResult<T>): void {
    // Simple FIFO eviction to prevent unbounded memory growth.
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    const ttl = this.ttlByKind[kind] ?? DEFAULT_TTL_MS;
    this.store.set(key, {
      result: { ...result, fromCache: false },
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Returns a cached result if fresh, otherwise calls `fn` and caches the result.
   * Prevents cache stampedes by deduplicating concurrent fetches for the same key
   * via a pending-promise map.
   */
  async getOrSet<T>(
    key: string,
    kind: keyof typeof this.ttlByKind,
    fn: () => Promise<MarketDataResult<T>>,
  ): Promise<MarketDataResult<T>> {
    const cached = this.get<T>(key);
    if (cached) return cached;

    // Deduplicate: if another request already started this fetch, wait for it.
    const existing = this.pending.get(key);
    if (existing) {
      return existing as Promise<MarketDataResult<T>>;
    }

    const promise = fn()
      .then((result) => {
        this.set(key, kind, result);
        this.pending.delete(key);
        return result;
      })
      .catch((err) => {
        this.pending.delete(key);
        throw err;
      });
    this.pending.set(key, promise as Promise<MarketDataResult<unknown>>);
    return promise as Promise<MarketDataResult<T>>;
  }

  clear(): void {
    this.store.clear();
    this.pending.clear();
  }

  size(): number {
    return this.store.size;
  }
}

/** Singleton cache used by the server-side market-data service. */
let _cache: MarketDataCache | null = null;
export function getCache(): MarketDataCache {
  if (!_cache) _cache = new MarketDataCache();
  return _cache;
}
