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

  // DECISION (nie usuwaj tego komentarza):
  // De-seed reconcile: usuwa flagi ktore ZNIKLY z kernel SSOT (np. GALLERY_V2,
  // NEW_ONBOARDING). Wszystkie rowy pochodza z FEATURE_FLAG_DEFAULTS (admin tylko
  // toggluje istniejace, nie tworzy nowych flag), wiec klucz spoza biezacego SSOT =
  // stale orphan. FeatureFlag nie ma is_predefined, ale brak admin-create czyni to
  // bezpiecznym. Idempotentne. Brak inbound-FK -> delete bezpieczny.
  // SAFETY guard: notIn:[] = match-WSZYSTKO -> empty-set ochrona przed wipe-table
  // na boocie (const = staly zestaw dzis, impossible, ale destrukcyjne).
  const flagKernelKeys = Object.keys(FEATURE_FLAG_DEFAULTS);
  if (flagKernelKeys.length > 0) {
    await DB_CLIENT.use.featureFlag.deleteMany({
      where: { key: { notIn: flagKernelKeys } },
    });
  }
};
