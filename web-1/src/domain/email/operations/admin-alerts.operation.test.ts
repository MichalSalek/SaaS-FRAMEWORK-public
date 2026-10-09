import { describe, expect, it } from 'vitest';
import {
  signupDigestLines,
  signupOnboardingState,
} from './admin-alerts.operation';

describe('signupOnboardingState', () => {
  it('names the finished role', () => {
    expect(
      signupOnboardingState({ stylist_account: {}, client_account: null })
    ).toBe('stylist');
    expect(
      signupOnboardingState({ stylist_account: null, client_account: {} })
    ).toBe('client');
    expect(
      signupOnboardingState({ stylist_account: {}, client_account: {} })
    ).toBe('stylist + client');
  });

  it('flags a person who never picked a role', () => {
    expect(
      signupOnboardingState({ stylist_account: null, client_account: null })
    ).toBe('not finished');
  });

  it('reports a missing user row as unknown', () => {
    expect(signupOnboardingState(undefined)).toBe('unknown');
  });
});

describe('signupDigestLines', () => {
  it('lists people without a finished onboarding first, in Polish', () => {
    const lines = signupDigestLines([
      {
        email: 'stylistka@example.test',
        createdAt: '2026-09-23T08:00:00Z',
        onboarding: 'stylist',
      },
      {
        email: 'emilia@example.test',
        createdAt: '2026-09-23T11:04:00Z',
        onboarding: 'not finished',
      },
    ]);
    expect(lines).toEqual([
      'emilia@example.test (onboarding nieukończony), 23.09, 13:04',
      'stylistka@example.test (stylistka), 23.09, 10:00',
    ]);
  });
});
