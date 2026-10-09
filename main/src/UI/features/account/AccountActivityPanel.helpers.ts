// UI/features/account/AccountActivityPanel.helpers.ts
// Pure helpers of the account activity panel (split out to keep the panel
// under its line cap): timestamp coercion, "last login" lookup and the
// i18n-dumb TimelineTx bag.

import type { useTranslations } from 'next-intl';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { UserActivityLogRecord } from '@kernel/models/event-log/event_log.dto';
import { formatDateTime } from '../../../application/date/date.utils';
import type { TimelineTx } from './UserActivityPage.events';

export const toTime = (value: Date | string): number =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

export function lastLoginFrom(
  entries: readonly UserActivityLogRecord[],
  locale: string
): string | null {
  // entries are newest-first; first login-success event = last login.
  const targets: ReadonlySet<string> = new Set([
    APP_EVENTS.INFO.USER.USER_LOGGED_IN,
    APP_EVENTS.INFO.USER.DEV_LOGIN_SUCCESS,
  ]);
  for (const e of entries) {
    if (targets.has(e.event)) {
      return formatDateTime(e.created_at, locale);
    }
  }
  return null;
}

export function buildTimelineTx(
  t: ReturnType<typeof useTranslations>
): TimelineTx {
  return {
    humanLoggedIn: t('humanLoggedIn'),
    humanLoggedOut: t('humanLoggedOut'),
    humanCannotLogin: t('humanCannotLogin'),
    humanSessionExpired: t('humanSessionExpired'),
    humanSessionDeleted: t('humanSessionDeleted'),
    humanAllSessionsDeleted: t('humanAllSessionsDeleted'),
    humanUserCreated: t('humanUserCreated'),
    humanUserRegistered: t('humanUserRegistered'),
    humanAccountCreated: t('humanAccountCreated'),
    humanUserDeletedSelf: t('humanUserDeletedSelf'),
    humanUserNameChanged: t('humanUserNameChanged'),
    humanEmailChangeRequested: t('humanEmailChangeRequested'),
    humanUserEmailChanged: t('humanUserEmailChanged'),
    humanDisplayNameChanged: t('humanDisplayNameChanged'),
    humanPricingPlanChanged: t('humanPricingPlanChanged'),
    humanPaymentDone: t('humanPaymentDone'),
    humanDataExported: t('humanDataExported'),
    humanGalleryCreated: t('humanGalleryCreated'),
    humanGalleryUpdated: t('humanGalleryUpdated'),
    humanGalleryDeleted: t('humanGalleryDeleted'),
    humanGalleryPinned: t('humanGalleryPinned'),
    humanGalleryUnpinned: t('humanGalleryUnpinned'),
    humanAssetUploaded: t('humanAssetUploaded'),
    humanLocationSet: t('humanLocationSet'),
    humanVanityUrlSet: t('humanVanityUrlSet'),
    humanFallback: t('humanFallback'),
  };
}
