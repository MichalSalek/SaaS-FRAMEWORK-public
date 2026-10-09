import { describe, it, expect } from 'vitest';
import {
  resolveLocalizedReturnPath,
  resolveReturnLocale,
} from './post-login-return';

// D6: 3 locales × {web, native} × funnel params. The "native" shape is the same
// relative path — native-oauth-start appends `nativeAuth=1` server-side and the
// bridge maps `/en/app…` → `nailfolio://en/app…` unchanged, so the resolver has a
// single contract for both channels; the cases below pin that the query string
// (funnel params) and the prefix survive together.

const CHANNEL_TARGETS = [
  { label: 'web dashboard', path: '/app' },
  { label: 'web onboarding + role', path: '/app/onboarding?role=stylist' },
  {
    label: 'web deep link + funnel',
    path: '/app/user/account/pay?planId=PRO&billingPeriod=monthly',
  },
  { label: 'native marker survives', path: '/app?nativeAuth=1' },
  {
    label: 'native onboarding + role + marker',
    path: '/app/onboarding?role=client&nativeAuth=1',
  },
] as const;

describe('resolveLocalizedReturnPath — locale prefix per channel', () => {
  it.each(CHANNEL_TARGETS)(
    'pl (default) stays unprefixed: $label',
    ({ path }) => {
      expect(
        resolveLocalizedReturnPath({ path, locale: 'pl', defaultLocale: 'pl' })
      ).toBe(path);
    }
  );

  it.each(CHANNEL_TARGETS)('en gets /en prefix: $label', ({ path }) => {
    expect(
      resolveLocalizedReturnPath({ path, locale: 'en', defaultLocale: 'pl' })
    ).toBe(`/en${path}`);
  });

  it.each(CHANNEL_TARGETS)('de gets /de prefix: $label', ({ path }) => {
    expect(
      resolveLocalizedReturnPath({ path, locale: 'de', defaultLocale: 'pl' })
    ).toBe(`/de${path}`);
  });

  it('login-page locale WINS over a prefix already carried by ?from', () => {
    expect(
      resolveLocalizedReturnPath({
        path: '/en/app/gallery?x=1',
        locale: 'de',
        defaultLocale: 'pl',
      })
    ).toBe('/de/app/gallery?x=1');
    expect(
      resolveLocalizedReturnPath({
        path: '/en/app',
        locale: 'pl',
        defaultLocale: 'pl',
      })
    ).toBe('/app');
  });

  it('never double-prefixes an already-localized path in the same locale', () => {
    expect(resolveLocalizedReturnPath({ path: '/en/app', locale: 'en' })).toBe(
      '/en/app'
    );
  });

  it('unknown / missing locale falls back to the default (unprefixed)', () => {
    expect(
      resolveLocalizedReturnPath({ path: '/app', locale: undefined })
    ).toBe('/app');
    expect(resolveLocalizedReturnPath({ path: '/app', locale: 'xx' })).toBe(
      '/app'
    );
  });

  it('rejects non-relative / protocol-relative targets (open-redirect guard)', () => {
    for (const path of ['//evil.com/app', 'https://evil.com/app', 'app', '']) {
      expect(
        resolveLocalizedReturnPath({ path, locale: 'en', defaultLocale: 'pl' })
      ).toBe('/en/app');
    }
  });

  it('does not treat /apple or /english as locale segments', () => {
    expect(
      resolveLocalizedReturnPath({ path: '/english/app', locale: 'en' })
    ).toBe('/en/english/app');
  });

  it('honours a non-pl Next defaultLocale without a kernel change', () => {
    // If Next were ever built with defaultLocale 'en', /app must stay unprefixed
    // for en and /pl/app must appear for pl.
    expect(
      resolveLocalizedReturnPath({
        path: '/app',
        locale: 'en',
        defaultLocale: 'en',
      })
    ).toBe('/app');
    expect(
      resolveLocalizedReturnPath({
        path: '/app',
        locale: 'pl',
        defaultLocale: 'en',
      })
    ).toBe('/pl/app');
  });
});

describe('resolveReturnLocale', () => {
  it('returns null for the default locale and for invalid input', () => {
    expect(
      resolveReturnLocale({ locale: 'pl', defaultLocale: 'pl' })
    ).toBeNull();
    expect(resolveReturnLocale({ locale: undefined })).toBeNull();
    expect(resolveReturnLocale({ locale: 'fr' })).toBeNull();
  });
  it('returns the locale for a non-default known locale', () => {
    expect(resolveReturnLocale({ locale: 'de', defaultLocale: 'pl' })).toBe(
      'de'
    );
  });
});
