import { describe, expect, it } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { clientOnboardingHref } from './_client-onboarding.helpers';
import {
  isPairIntentQuery,
  pairIntentLoginHref,
  withPairIntent,
  withoutPairIntent,
} from '../shared/pairing/pair-intent';

describe('pair intent return path', () => {
  it('consumes only the pairing parameter, preserving the existing query and hash', () => {
    expect(withoutPairIntent('/stylist/abc/?from=qr&pair=1#contact')).toBe(
      '/stylist/abc/?from=qr#contact'
    );
    expect(withoutPairIntent('/stylist/abc/?pair=1')).toBe('/stylist/abc/');
  });
  it('adds pair=1 and keeps a trailing slash for login and roleless onboarding', () => {
    expect(withPairIntent('/stylist/abc/')).toBe('/stylist/abc/?pair=1');
    expect(withPairIntent('/stylist/abc/?from=qr')).toBe(
      '/stylist/abc/?from=qr&pair=1'
    );
    expect(pairIntentLoginHref('/stylist/abc/')).toBe(
      `${ROUTES_FRONT.USER_LOG}?from=${encodeURIComponent('/stylist/abc/?pair=1')}`
    );
    expect(clientOnboardingHref('/stylist/abc/?pair=1')).toBe(
      `${ROUTES_FRONT.ONBOARDING}?role=client&from=${encodeURIComponent('/stylist/abc/?pair=1')}`
    );
    expect(isPairIntentQuery('1')).toBe(true);
    expect(isPairIntentQuery(['1'])).toBe(true);
    expect(isPairIntentQuery('0')).toBe(false);
  });
});
