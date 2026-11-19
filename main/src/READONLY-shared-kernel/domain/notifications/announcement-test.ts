import { I18N_CONFIG, type LocaleType } from '../i18n/i18n.config';

const PREFIX = 'ANNOUNCEMENT_TEST:';

export const announcementTestKey = (id: string, locale: LocaleType): string =>
  `${PREFIX}${id}:${locale}`;

export function announcementTestLocale(
  key: string | undefined
): LocaleType | null {
  if (!key?.startsWith(PREFIX)) {
    return null;
  }
  const language = key.slice(key.lastIndexOf(':') + 1);
  return I18N_CONFIG.locales.find(locale => locale === language) ?? null;
}
