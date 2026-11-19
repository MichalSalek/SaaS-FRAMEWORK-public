import { z } from 'zod';
import { VALIDATION_LENGTHS } from '../../policies/validation.config';
import { VALIDATION_MESSAGES as V } from '../i18n/validation.i18n';
import { I18N_CONFIG, type LocaleType } from '../i18n/i18n.config';

const translation = z.object({
  title: z
    .string()
    .trim()
    .min(1, V.announcement.titleInvalid)
    .max(
      VALIDATION_LENGTHS.ANNOUNCEMENT_TITLE_MAX,
      V.announcement.titleInvalid
    ),
  message: z
    .string()
    .trim()
    .min(1, V.announcement.messageInvalid)
    .max(
      VALIDATION_LENGTHS.ANNOUNCEMENT_MESSAGE_MAX,
      V.announcement.messageInvalid
    ),
});

export const announcementTranslationsSchema = z
  .object({
    pl: translation.optional(),
    en: translation.optional(),
    de: translation.optional(),
  })
  .strict()
  .refine(
    value => I18N_CONFIG.locales.some(locale => value[locale] !== undefined),
    {
      message: V.announcement.messageInvalid,
    }
  );

export type AnnouncementTranslations = Partial<
  Record<LocaleType, { title: string; message: string }>
>;
export type AnnouncementAudience = {
  audience_anonymous: boolean;
  audience_client: boolean;
  audience_stylist: boolean;
};

export const hasAnnouncementAudience = (
  audience: AnnouncementAudience
): boolean =>
  audience.audience_anonymous ||
  audience.audience_client ||
  audience.audience_stylist;

export function readAnnouncementTranslations(
  value: unknown,
  legacy?: { title: string; message: string }
): AnnouncementTranslations {
  const parsed = announcementTranslationsSchema.safeParse(value);
  const translations: AnnouncementTranslations = {};
  if (parsed.success) {
    for (const locale of I18N_CONFIG.locales) {
      const text = parsed.data[locale];
      if (text !== undefined) {
        translations[locale] = text;
      }
    }
  }
  if (!parsed.success && legacy !== undefined) {
    const text = translation.safeParse(legacy);
    if (text.success) {
      translations.pl = text.data;
    }
  }
  return translations;
}

export function announcementTranslation(
  translations: AnnouncementTranslations,
  locale: LocaleType,
  fallback = false
): { title: string; message: string } | undefined {
  return (
    translations[locale] ??
    (fallback
      ? I18N_CONFIG.locales
          .map(key => translations[key])
          .find(value => value !== undefined)
      : undefined)
  );
}

/** Public pages require the anonymous switch as well as the signed-in viewer's role. */
export function announcementVisibleTo(
  audience: AnnouncementAudience,
  viewer: 'CLIENT' | 'STYLIST' | null,
  surface: 'public' | 'app'
): boolean {
  if (surface === 'public' && !audience.audience_anonymous) {
    return false;
  }
  if (viewer === null) {
    return surface === 'public' && audience.audience_anonymous;
  }
  return viewer === 'CLIENT'
    ? audience.audience_client
    : audience.audience_stylist;
}
