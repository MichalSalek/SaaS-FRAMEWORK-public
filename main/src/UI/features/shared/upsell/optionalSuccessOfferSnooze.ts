import { TIME } from '@kernel/application/constants.config';

export const OPTIONAL_SUCCESS_OFFER_SNOOZE_MS = 7 * TIME.MS_PER_DAY;

export interface SnoozeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY_PREFIX = 'nailfolio:optional-success-offers:snoozed-until:';

export function optionalSuccessOfferSnoozeKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

export function isOptionalSuccessOfferSnoozed(
  storage: Pick<SnoozeStorage, 'getItem'>,
  userId: string,
  now: number
): boolean {
  const stored = storage.getItem(optionalSuccessOfferSnoozeKey(userId));
  if (stored === null) {
    return false;
  }
  const snoozedUntil = Number(stored);
  return Number.isFinite(snoozedUntil) && snoozedUntil > now;
}

export function snoozeOptionalSuccessOffers(
  storage: Pick<SnoozeStorage, 'setItem'>,
  userId: string,
  now: number
): number {
  const snoozedUntil = now + OPTIONAL_SUCCESS_OFFER_SNOOZE_MS;
  storage.setItem(optionalSuccessOfferSnoozeKey(userId), String(snoozedUntil));
  return snoozedUntil;
}
