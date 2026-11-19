// announcements/announcement-display.ts
// Which announcement a surface may show, and how a notification row opens.
// The banner never borrows another language. The notification row does, so a
// later language switch does not leave an empty bell entry.

import {
  announcementTranslation,
  announcementVisibleTo,
  type AnnouncementAudience,
  type AnnouncementTranslations,
} from '@kernel/domain/admin/announcement-content';
import { parseAnnouncementLinks } from '@kernel/domain/admin/announcement-links';
import { I18N_CONFIG, type LocaleType } from '@kernel/domain/i18n/i18n.config';

export type AnnouncementSurface = 'public' | 'app';
export type AnnouncementViewer = 'CLIENT' | 'STYLIST' | null;

export function bannerAnnouncementCopy(
  announcement: AnnouncementAudience & {
    translations: AnnouncementTranslations;
  },
  locale: LocaleType,
  viewer: AnnouncementViewer,
  surface: AnnouncementSurface
): { title: string; message: string } | undefined {
  if (!announcementVisibleTo(announcement, viewer, surface)) {
    return undefined;
  }
  return announcementTranslation(announcement.translations, locale, false);
}

export interface AnnouncementNotificationView {
  locale: LocaleType;
  title: string;
  message: string;
  /** Set only when the body itself has no link, so the row is one anchor. */
  rowHref: string | null;
  external: boolean;
}

export function notificationAnnouncementView(
  announcement:
    | {
        translations: AnnouncementTranslations;
        primary_href: string | null;
        test_locale?: LocaleType | null;
      }
    | null
    | undefined,
  locale: LocaleType
): AnnouncementNotificationView | null {
  if (announcement == null) {
    return null;
  }
  const requestedLocale = announcement.test_locale ?? locale;
  const primaryLocale = I18N_CONFIG.locales.find(
    language => announcement.translations[language] !== undefined
  );
  const copyLocale =
    announcement.translations[requestedLocale] === undefined
      ? primaryLocale
      : requestedLocale;
  if (copyLocale === undefined) {
    return null;
  }
  const copy = announcementTranslation(announcement.translations, copyLocale);
  if (copy === undefined) {
    return null;
  }
  const linked = parseAnnouncementLinks(copy.message).some(
    part => part.href !== undefined
  );
  // The server's legacy href belongs to the primary translation, never another language's copy.
  const rowHref =
    linked || copyLocale !== primaryLocale ? null : announcement.primary_href;
  return {
    locale: copyLocale,
    title: copy.title,
    message: copy.message,
    rowHref,
    external: rowHref !== null && !rowHref.startsWith('/'),
  };
}
