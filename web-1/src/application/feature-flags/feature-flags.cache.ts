import { createCache } from '@app/cache/cache.utils';
import { DB_CLIENT } from '@app/db/db.client';
import { CACHE_TTL } from '@kernel/domain/admin/admin.config';

const CACHE_KEY = 'all_flags';
// L3 r28: explicit maxSize — single-key cache, no need for default 1000
// DECISION: in-memory PER-INSTANCE cache (createCache = local Map, TTL=FEATURE_FLAGS 60s).
// invalidateFeatureFlagCache() clears only this process, so cross-route / cross-replica
// reactivity is TTL-bounded EVENTUAL CONSISTENCY by design (ADR-008, no Redis, docs/DECISION_LOG.md):
// a public read may serve a stale flag for up to 60s after an admin toggle, which is expected, not
// a bug (Next dev's per-route module isolation amplifies it). Do NOT add cross-instance
// invalidation or pub/sub, or shorten the TTL to "fix" this; revisit only at the ADR-008
// threshold (createCache's Map is swap-compatible with a Redis client).
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
