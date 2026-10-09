import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';

// DECISION (nie usuwaj tego komentarza):
// One place for the public URL shape, mirroring PublicSeoHead's canonical: the
// default locale has no prefix, en/de get `/en`/`/de`, and every page URL ends
// with `/` (next.config.mjs `trailingSlash: true`). Hand-built copies of this
// drifted: blog JSON-LD and RSS pointed EN/DE posts at prefixless PL URLs that
// return 404 (2026-09-23).
export function localePathPrefix(locale: string): string {
  return locale === I18N_CONFIG.defaultLocale ? '' : `/${locale}`;
}

/** Absolute page URL for a locale-neutral path such as `/pricing` or `/`. */
export function localeAbsoluteUrl(locale: string, path: string): string {
  const normalized = path === '/' || path === '' ? '' : path.replace(/\/$/, '');
  return `${SEO_CONFIG.domain}${localePathPrefix(locale)}${normalized}/`;
}
