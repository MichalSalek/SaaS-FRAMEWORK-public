/**
 * Locale dates for email copy. Europe/Warsaw is the product clock: a trial
 * that ends at 00:30 UTC is still the previous evening in Poland, and the
 * sentence names that local day.
 */

import type { LocaleType } from '@kernel/domain/i18n/i18n.config';

const ZONE = 'Europe/Warsaw';

export const formatEmailDate = (date: Date, locale: LocaleType): string =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: ZONE,
  }).format(date);

export const formatEmailDateTime = (date: Date, locale: LocaleType): string =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: ZONE,
  }).format(date);
