/**
 * Generic in-memory TTL cache utility.
 * Use for short-lived caches where eventual consistency is acceptable.
 *
 * Design notes:
 * - Per-instance (not shared across replicas) — suitable for read-heavy data with short TTL
 * - Lazy expiration (expired entries cleaned on access, not proactively)
 * - Bounded by maxSize — evicts oldest entry (insertion order) when limit is reached
 * - Periodic GC every 100 get calls to prune expired-but-unaccessed entries
 * - For shared state across instances, replace Map with Redis client (same interface)
 */

export type CacheEntry<T> = {
  data: T;
  expires: number;
};

export type Cache<T> = Map<string, CacheEntry<T>>;

/**
 * Create a new TTL-based cache.
 * @param ttlMs - Time-to-live in milliseconds
 * @param maxSize - Maximum number of entries; oldest entry evicted when limit is reached (default 1000)
 */
export const createCache = <T>(ttlMs: number, maxSize = 1000) => {
  const cache: Cache<T> = new Map();
  let getCallCount = 0;

  return {
    /**
     * Get cached value if still valid (not expired).
     * Returns null if key not found or expired.
     * Every 100 calls runs a GC pass to evict expired entries.
     */
    get: (key: string): T | null => {
      getCallCount++;
      if (getCallCount % 100 === 0) {
        const now = Date.now();
        for (const [k, entry] of cache) {
          if (now > entry.expires) {
            cache.delete(k);
          }
        }
      }
      const entry = cache.get(key);
      if (!entry) {
        return null;
      }
      if (Date.now() > entry.expires) {
        cache.delete(key);
        return null;
      }
      return entry.data;
    },

    /**
     * Set cache value with TTL.
     * Evicts the oldest entry when maxSize is reached.
     * @param ttlOverrideMs - optional per-entry TTL (e.g. short TTL for
     *   degraded/fallback payloads, so recovery isn't blocked by a long cache)
     */
    set: (key: string, data: T, ttlOverrideMs?: number): void => {
      if (cache.size >= maxSize && !cache.has(key)) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        }
      }
      cache.set(key, {
        data,
        expires: Date.now() + (ttlOverrideMs ?? ttlMs),
      });
    },

    /**
     * Invalidate (delete) a specific key.
     */
    invalidate: (key: string): void => {
      cache.delete(key);
    },

    /**
     * Clear all cached entries.
     */
    clear: (): void => {
      cache.clear();
    },

    /**
     * Get cache size (number of entries, including expired ones).
     */
    size: (): number => {
      return cache.size;
    },
  };
};
