// i18n configuration - SSOT for all locale settings

export const I18N_CONFIG = Object.freeze({
  locales: ['pl', 'en', 'de'] as const,
  defaultLocale: (process.env.NEXT_PUBLIC_DEFAULT_LOCALE ||
    process.env.DEFAULT_LOCALE ||
    'pl') as 'pl' | 'en' | 'de',
  timezone:
    process.env.NEXT_PUBLIC_TIMEZONE || process.env.TIMEZONE || 'Europe/Warsaw',
});

export type LocaleType = (typeof I18N_CONFIG.locales)[number];

/**
 * Krótkie labelki (ISO codes uppercase)
 */
export const LOCALE_SHORT_LABELS: Record<LocaleType, string> = {
  pl: 'PL',
  en: 'EN',
  de: 'DE',
} as const;

export const isValidLocale = (locale: unknown): locale is LocaleType =>
  typeof locale === 'string' &&
  (I18N_CONFIG.locales as readonly string[]).includes(locale);

export const getLocaleOrDefault = (locale: string | undefined): LocaleType =>
  isValidLocale(locale) ? locale : I18N_CONFIG.defaultLocale;

/**
 * Pobiera następny locale w cyklu (dla prostego toggle)
 */
export const getNextLocale = (currentLocale: LocaleType): LocaleType => {
  const locales = I18N_CONFIG.locales;
  const currentIndex = locales.indexOf(currentLocale);
  const nextIndex = (currentIndex + 1) % locales.length;
  // locales is a non-empty readonly tuple, so nextIndex is always in range;
  // fall back to defaultLocale to keep noUncheckedIndexedAccess happy without a cast.
  return locales[nextIndex] ?? I18N_CONFIG.defaultLocale;
};
