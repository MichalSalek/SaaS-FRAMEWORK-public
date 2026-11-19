// UI/features/notifications/notificationPresentation.ts
// Pure helpers of the notification list: the icon of a type and the relative
// time of a row (minutes, hours, „wczoraj”, then a calendar date).

import type { Icon } from '@phosphor-icons/react';
import {
  ArchiveIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  EnvelopeSimpleOpenIcon,
  HandWavingIcon,
  HourglassMediumIcon,
  LifebuoyIcon,
  MegaphoneIcon,
  QrCodeIcon,
  TrayArrowDownIcon,
  UsersIcon,
} from '@phosphor-icons/react';
import type { NotificationType } from '@kernel/models/notifications/notifications.dto';
import { formatDate } from '../../../application/date/date.utils';

export const NOTIFICATION_ICONS: Record<NotificationType, Icon> = {
  PAIR_REQUEST_RECEIVED: HandWavingIcon,
  PAIR_REQUEST_ACCEPTED: CheckCircleIcon,
  PAIR_CONNECTED_BY_QR: QrCodeIcon,
  SESSION_SHARED: TrayArrowDownIcon,
  SESSION_CLOSED_BY_STYLIST: ArchiveIcon,
  SESSION_EXPIRING_SOON: HourglassMediumIcon,
  MESSAGE_RECEIVED: ChatCircleIcon,
  SALON_INVITATION_RECEIVED: EnvelopeSimpleOpenIcon,
  SALON_INVITATION_ACCEPTED: UsersIcon,
  SUPPORT_REPLY_RECEIVED: LifebuoyIcon,
  SYSTEM_ANNOUNCEMENT: MegaphoneIcon,
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * „teraz” under a minute, minutes under an hour, hours under a day, days
 * under a week (Intl.RelativeTimeFormat with numeric 'auto': „wczoraj”), a
 * calendar date from a week on. The screen asks „how long ago”, never the
 * exact minute; an invalid date renders nothing rather than „Invalid Date”.
 */
export function formatNotificationTime(
  createdAt: string,
  now: Date,
  locale: string
): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) {
    return '';
  }
  const diff = Math.max(0, now.getTime() - created.getTime());
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diff < MINUTE_MS) {
    return rtf.format(0, 'second');
  }
  if (diff < HOUR_MS) {
    return rtf.format(-Math.floor(diff / MINUTE_MS), 'minute');
  }
  if (diff < DAY_MS) {
    return rtf.format(-Math.floor(diff / HOUR_MS), 'hour');
  }
  if (diff < 7 * DAY_MS) {
    return rtf.format(-Math.floor(diff / DAY_MS), 'day');
  }
  return formatDate(created, locale, '');
}
