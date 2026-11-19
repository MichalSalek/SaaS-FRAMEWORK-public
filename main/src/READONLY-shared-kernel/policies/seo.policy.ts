/**
 * SEO configuration — SSOT for domain and SEO-related constants.
 */

import type { LocaleType } from '../domain/i18n/i18n.config';
import { getLocaleOrDefault } from '../domain/i18n/i18n.config';
import { BRAND_CONFIG } from '../domain/platform/brand.config';

export const SEO_CONFIG = {
  domain: BRAND_CONFIG.url,
} as const;

/**
 * SoftwareApplication.operatingSystem — SSOT for structured-data OS declaration.
 *
 * DECISION: iOS was dropped from the native launch: the native app is Android only (Capacitor) and on
 * iPhone the product runs on the web (mobile Safari). `'Android, Web'` matches what /get-app shows and
 * keeps the web-reachability signal; the earlier hardcoded `'iOS, Android'` claimed a native iOS app
 * that does not exist and contradicted visible content (Google requires markup to match it). One
 * source: import THIS constant in every SoftwareApplication JSON-LD.
 */
export const SOFTWARE_APPLICATION_OS = 'Android, Web';

/**
 * BCP-47 locale codes for JSON-LD `inLanguage` and similar structured-data fields.
 * Maps Next.js i18n locale shorthand (`pl`/`en`/`de`) to canonical BCP-47.
 *
 * Typed as Record<LocaleType, string> so compile-time exhaustiveness check
 * enforces an entry for every supported locale.
 */
export const LOCALE_BCP47: Record<LocaleType, string> = {
  pl: 'pl-PL',
  en: 'en-US',
  de: 'de-DE',
};

/**
 * Open Graph locale codes (underscore form per og:locale spec).
 * Used by PublicSeoHead for og:locale + og:locale:alternate meta tags.
 *
 * Typed as Record<LocaleType, string> so compile-time exhaustiveness check
 * enforces an entry for every supported locale.
 */
export const LOCALE_OG: Record<LocaleType, string> = {
  pl: 'pl_PL',
  en: 'en_US',
  de: 'de_DE',
};

/**
 * Typed lookup helpers — accept a raw `string` locale from Next.js router/params,
 * narrow it internally via `getLocaleOrDefault`, and return the mapped value.
 * Prefer these over direct indexing to avoid unsafe string-keyed access.
 */
export const getLocaleBcp47 = (locale: string): string =>
  LOCALE_BCP47[getLocaleOrDefault(locale)];

export const getLocaleOg = (locale: string): string =>
  LOCALE_OG[getLocaleOrDefault(locale)];
