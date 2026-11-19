// domain/notifications/push/push-soft-ask.ts
// The snooze of the push soft ask: one device-wide date after which the cards
// may show again. Pure helpers over the client-storage adapter.

import { TIME } from '@kernel/application/constants.config';
import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';
import {
  getFromClientStorage,
  setToClientStorage,
} from '../../../application/client-device-storage/clientStorage.possibilities.api';

export type PushSoftAskMoment =
  'pairRequest' | 'sessionShared' | 'stylistClients';

/** „Nie teraz” hides every soft ask on this device for this long. */
export const PUSH_SOFT_ASK_SNOOZE_DAYS = 21;

export const resolveSoftAskSnoozed = (
  storedUntil: string | null,
  now: number
): boolean => {
  if (storedUntil === null) {
    return false;
  }
  const until = Number(storedUntil);
  return Number.isFinite(until) && until > now;
};

export const isPushSoftAskSnoozed = (now: number): boolean =>
  resolveSoftAskSnoozed(
    getFromClientStorage({ key: STORAGE_KEYS.PUSH_SOFT_ASK_SNOOZED_UNTIL }),
    now
  );

export const snoozePushSoftAsk = (now: number): void => {
  setToClientStorage({
    key: STORAGE_KEYS.PUSH_SOFT_ASK_SNOOZED_UNTIL,
    value: String(now + PUSH_SOFT_ASK_SNOOZE_DAYS * TIME.MS_PER_DAY),
  });
};
