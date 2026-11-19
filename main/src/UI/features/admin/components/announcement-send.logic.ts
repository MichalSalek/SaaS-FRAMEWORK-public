// admin/components/announcement-send.logic.ts
// When the bell-and-push action may run. The saved row is the only payload:
// a dirty editor cannot send the previous text, and a sent row cannot send again.

import type { AnnouncementAudience } from '@kernel/domain/admin/announcement-content';
import type { AnnouncementTranslations } from '@kernel/domain/admin/announcement-content';
import { I18N_CONFIG, type LocaleType } from '@kernel/domain/i18n/i18n.config';

export type AnnouncementNotificationSendState =
  'ready' | 'needs-save' | 'anonymous-only' | 'already-sent';

export function announcementNotificationSendState(input: {
  saved: boolean;
  dirty: boolean;
  audience_client: boolean;
  audience_stylist: boolean;
  notification_sent_at: string | null;
}): AnnouncementNotificationSendState {
  if (input.notification_sent_at !== null) {
    return 'already-sent';
  }
  if (!input.saved || input.dirty) {
    return 'needs-save';
  }
  if (!input.audience_client && !input.audience_stylist) {
    return 'anonymous-only';
  }
  return 'ready';
}

export function savedAnnouncementSendState(announcement: {
  audience_client: boolean;
  audience_stylist: boolean;
  notification_sent_at: string | null;
}): AnnouncementNotificationSendState {
  return announcementNotificationSendState({
    saved: true,
    dirty: false,
    audience_client: announcement.audience_client,
    audience_stylist: announcement.audience_stylist,
    notification_sent_at: announcement.notification_sent_at,
  });
}

export function announcementAppRoles(
  audience: Pick<AnnouncementAudience, 'audience_client' | 'audience_stylist'>
): Array<'client' | 'stylist'> {
  const roles: Array<'client' | 'stylist'> = [];
  if (audience.audience_client) {
    roles.push('client');
  }
  if (audience.audience_stylist) {
    roles.push('stylist');
  }
  return roles;
}

export function announcementLanguageCodes(
  translations: AnnouncementTranslations
): LocaleType[] {
  return I18N_CONFIG.locales.filter(
    locale => translations[locale] !== undefined
  );
}

/** Two items join with the conjunction alone. A longer list puts it before the last item. */
export function joinAnnouncementList(
  items: readonly string[],
  conjunction: string
): string {
  if (items.length === 0) {
    return '';
  }
  const first = items[0] ?? '';
  if (items.length === 1) {
    return first;
  }
  const last = items[items.length - 1] ?? '';
  if (items.length === 2) {
    return `${first} ${conjunction} ${last}`;
  }
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${last}`;
}
