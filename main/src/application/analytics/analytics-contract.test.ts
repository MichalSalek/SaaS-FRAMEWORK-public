import { describe, expect, it } from 'vitest';
import {
  createOncePerPageViewGuard,
  DATA_LAYER_PROPERTY_KEYS,
} from './analytics-contract';

describe('analytics contract', () => {
  it('clears every known dataLayer property on each event', () => {
    expect(DATA_LAYER_PROPERTY_KEYS).toEqual([
      'location',
      'plan',
      'role',
      'target',
      'depth',
      'billing_period',
      'billing_country',
      'currency',
      'confirmation_kind',
      'measurement_version',
      'measurement_changed_at',
      'demo',
      'demo_action',
      'demo_value',
      'method',
      'intent',
      'first_source',
      'first_landing',
      'first_cta',
    ]);
  });

  it('marks each key once until the page view resets', () => {
    const guard = createOncePerPageViewGuard();

    expect(guard.mark('gallery-filter|filter_tap|color')).toBe(true);
    expect(guard.mark('gallery-filter|filter_tap|color')).toBe(false);
    guard.reset();
    expect(guard.mark('gallery-filter|filter_tap|color')).toBe(true);
  });
});
