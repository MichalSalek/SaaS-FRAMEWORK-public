import { DB_CLIENT } from '@app/db/db.client';
import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_DESCRIPTIONS,
} from '@kernel/domain/feature-flags/feature-flags.config';
import type { FeatureFlagKey } from '@kernel/domain/feature-flags/feature-flags.config';

/**
 * Seed feature flags from SSOT config.
 * Uses createMany + skipDuplicates (idempotent — safe to run multiple times).
 */
export const seedFeatureFlags = async (): Promise<void> => {
  const entries = Object.entries(FEATURE_FLAG_DEFAULTS) as Array<
    [FeatureFlagKey, boolean]
  >;

  await DB_CLIENT.use.featureFlag.createMany({
    data: entries.map(([key, is_enabled]) => ({
      key,
      is_enabled,
      description: FEATURE_FLAG_DESCRIPTIONS[key] ?? null,
    })),
    skipDuplicates: true,
  });

  // DECISION: de-seed reconcile deletes flags that vanished from the kernel SSOT. All rows come
  // from FEATURE_FLAG_DEFAULTS (admin only toggles existing flags, never creates), so a key
  // outside the current SSOT is a stale orphan, and nothing references FeatureFlag by FK.
  // Idempotent. SAFETY: `notIn: []` would match everything, so the empty set is guarded against
  // a table wipe on boot.
  const flagKernelKeys = Object.keys(FEATURE_FLAG_DEFAULTS);
  if (flagKernelKeys.length > 0) {
    await DB_CLIENT.use.featureFlag.deleteMany({
      where: { key: { notIn: flagKernelKeys } },
    });
  }
};
