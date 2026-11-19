import { describe, expect, it } from 'vitest';
import {
  isOptionalSuccessOfferSnoozed,
  optionalSuccessOfferSnoozeKey,
  OPTIONAL_SUCCESS_OFFER_SNOOZE_MS,
  snoozeOptionalSuccessOffers,
  type SnoozeStorage,
} from './optionalSuccessOfferSnooze';

function createStorage(): SnoozeStorage {
  const items = new Map<string, string>();
  return {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
  };
}

describe('optional success offer snooze', () => {
  it('uses one account-scoped key for all optional success offers', () => {
    expect(optionalSuccessOfferSnoozeKey('user/one')).toBe(
      'nailfolio:optional-success-offers:snoozed-until:user%2Fone'
    );
    expect(optionalSuccessOfferSnoozeKey('user/one')).not.toBe(
      optionalSuccessOfferSnoozeKey('user/two')
    );
  });

  it('snoozes for seven days and expires at the exact boundary', () => {
    const storage = createStorage();
    const now = 1_900_000_000_000;
    const snoozedUntil = snoozeOptionalSuccessOffers(storage, 'owner-a', now);

    expect(snoozedUntil).toBe(now + 7 * 24 * 60 * 60 * 1000);
    expect(snoozedUntil - now).toBe(OPTIONAL_SUCCESS_OFFER_SNOOZE_MS);
    expect(
      isOptionalSuccessOfferSnoozed(storage, 'owner-a', snoozedUntil - 1)
    ).toBe(true);
    expect(
      isOptionalSuccessOfferSnoozed(storage, 'owner-a', snoozedUntil)
    ).toBe(false);
    expect(isOptionalSuccessOfferSnoozed(storage, 'owner-b', now)).toBe(false);
  });

  it('treats missing, expired, and invalid values as not snoozed', () => {
    const storage = createStorage();
    const key = optionalSuccessOfferSnoozeKey('owner-a');
    storage.setItem(key, 'not-a-timestamp');

    expect(
      isOptionalSuccessOfferSnoozed(storage, 'owner-a', 1_900_000_000_000)
    ).toBe(false);
    storage.setItem(key, '100');
    expect(isOptionalSuccessOfferSnoozed(storage, 'owner-a', 101)).toBe(false);
  });
});
