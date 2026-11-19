import { describe, expect, it } from 'vitest';
import {
  isAppZonePath,
  readLocalePrefix,
  stripLocalePrefix,
} from '@kernel/domain/routing/app-path.utils';

describe('isAppZonePath', () => {
  it.each(['/app', '/app/x', '/en/app', '/de/app/onboarding'] as const)(
    'true for %s',
    path => {
      expect(isAppZonePath(path)).toBe(true);
    }
  );

  it.each(['/apple', '/en/apple', '/fr/app', '/'] as const)(
    'false for %s',
    path => {
      expect(isAppZonePath(path)).toBe(false);
    }
  );
});

describe('stripLocalePrefix / readLocalePrefix', () => {
  it('strips a known locale and keeps the query', () => {
    expect(stripLocalePrefix('/en/app?x')).toBe('/app?x');
  });

  it('reads a non-default locale prefix', () => {
    expect(readLocalePrefix('/de/app')).toBe('de');
  });

  it('returns null when the path is unprefixed', () => {
    expect(readLocalePrefix('/app')).toBeNull();
  });
});
