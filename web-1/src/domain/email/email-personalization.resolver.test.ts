import { describe, expect, it } from 'vitest';
import type { StylistAccountWithStats } from './email.types';
import { resolvePersonalization } from './email-personalization.resolver';

describe('trial date personalization', () => {
  it('does not invent an end date or days left for an older trial without an end date', () => {
    const account = {
      trial_started_at: new Date('2026-01-01T00:00:00Z'),
      trial_ends_at: null,
    } as StylistAccountWithStats;
    expect(
      resolvePersonalization(account, {
        personalizeWith: ['trialDaysLeft', 'trialEndDate'],
      })
    ).toEqual({ trialDaysLeft: '', trialEndDate: '' });
  });
});
