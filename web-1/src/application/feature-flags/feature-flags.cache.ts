import { createCache } from '@app/cache/cache.utils';
import { DB_CLIENT } from '@app/db/db.client';
import { CACHE_TTL } from '@kernel/domain/admin/admin.config';

const CACHE_KEY = 'all_flags';
// L3 r28: explicit maxSize — single-key cache, no need for default 1000
// DECISION (nie usuwaj tego komentarza):
// In-memory PER-INSTANCE cache (createCache = local Map, TTL=FEATURE_FLAGS 60s).
// invalidateFeatureFlagCache() clears ONLY this process instance — it cannot reach
// another Node worker or another replica. Cross-route / cross-replica reactivity is
// therefore TTL-bounded EVENTUAL CONSISTENCY, BY DESIGN per ADR-008 (No Redis,
// docs/DECISION_LOG.md): a public read may keep serving a stale flag for up to the
// 60s TTL after an admin toggle. A QA report "feature-flag toggle not instantly
// reflected on the public read" is EXPECTED behaviour, not a bug (also amplified in
// Next.js dev by per-route module isolation = separate cache instances). Revisit only
// at the ADR-008 threshold: >5k concurrent users + multi-instance → move shared cache
// to Redis (createCache's Map is swap-compatible with a Redis client). Do NOT add
// cross-instance invalidation, pub/sub, or shorten the TTL to "fix" this.
const flagsCache = createCache<Map<string, boolean>>(
  CACHE_TTL.FEATURE_FLAGS,
  10
);

/**
 * Get all feature flags from cache (or fetch from DB if expired).
 */
export const getFeatureFlags = async (): Promise<Map<string, boolean>> => {
  const cached = flagsCache.get(CACHE_KEY);
  if (cached) {
    return cached;
  }

  const flags = await DB_CLIENT.use.featureFlag.findMany({ take: 200 });
  const result = new Map(flags.map(f => [f.key, f.is_enabled]));
  flagsCache.set(CACHE_KEY, result);
  return result;
};

/**
 * Invalidate the feature flag cache (call after toggle).
 */
export const invalidateFeatureFlagCache = (): void => {
  flagsCache.invalidate(CACHE_KEY);
};
