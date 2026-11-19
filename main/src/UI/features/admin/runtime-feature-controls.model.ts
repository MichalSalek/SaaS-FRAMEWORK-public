import { runtimeFeatureCategory } from '@kernel/domain/feature-flags/runtime-feature-controls.config';
import type { RuntimeConfigEntry } from '@kernel/models/admin/admin.dto';

export function runtimeFlagCounts(entries: readonly RuntimeConfigEntry[]) {
  const flags = entries.filter(
    entry => runtimeFeatureCategory(entry.key, entry.value_type) !== null
  );
  return {
    total: flags.length,
    enabled: flags.filter(
      entry => entry.value === 'true' || entry.value === 'ON'
    ).length,
    preview: flags.filter(
      entry => entry.key === 'FREE_EMAIL_MODE' && entry.value === 'PREVIEW'
    ).length,
  };
}
