import { describe, expect, it } from 'vitest';
import { RUNTIME_CONFIG_KEYS } from '@kernel/domain/admin/runtime-config.config';
import { runtimeFeatureCategory } from '@kernel/domain/feature-flags/runtime-feature-controls.config';
import type { RuntimeConfigEntry } from '@kernel/models/admin/admin.dto';
import { runtimeFlagCounts } from './runtime-feature-controls.model';

const entry = (
  key: string,
  value: string,
  value_type: RuntimeConfigEntry['value_type'] = 'boolean'
): RuntimeConfigEntry => ({
  id: key,
  key,
  value,
  value_type,
  description: null,
  is_predefined: true,
  updated_at: '2026-10-23T00:00:00Z',
});

describe('runtime feature controls', () => {
  it('places every boolean and the Free delivery mode in feature flags', () => {
    for (const [key, config] of Object.entries(RUNTIME_CONFIG_KEYS)) {
      const isFeature = config.type === 'boolean' || key === 'FREE_EMAIL_MODE';
      expect(runtimeFeatureCategory(key, config.type) !== null).toBe(isFeature);
    }
  });

  it('keeps custom boolean controls discoverable without treating numeric limits as flags', () => {
    expect(runtimeFeatureCategory('CUSTOM_FLAG', 'boolean')).toBe(
      'OtherControls'
    );
    expect(runtimeFeatureCategory('CUSTOM_LIMIT', 'number')).toBeNull();
    expect(runtimeFeatureCategory('CUSTOM_MESSAGE', 'string')).toBeNull();
  });

  it('preserves all original values and counts preview separately from enabled and disabled', () => {
    const entries = [
      entry('FREE_EMAIL_MODE', 'PREVIEW', 'string'),
      entry('MAINTENANCE_MODE', 'false'),
      entry('VERBOSE_LOG_MODE', 'true'),
      entry('EVENT_LOG_MAX_RECORDS', '50000', 'number'),
    ];
    const before = JSON.stringify(entries);
    expect(runtimeFlagCounts(entries)).toEqual({
      total: 3,
      enabled: 1,
      preview: 1,
    });
    expect(JSON.stringify(entries)).toBe(before);
  });

  it.each(['OFF', 'ON'])(
    'counts Free %s without changing its stored mode',
    value => {
      expect(
        runtimeFlagCounts([entry('FREE_EMAIL_MODE', value, 'string')])
      ).toEqual({ total: 1, enabled: value === 'ON' ? 1 : 0, preview: 0 });
    }
  );
});
