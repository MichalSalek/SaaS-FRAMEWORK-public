import type { IntlMessages } from '../../../types/i18n';
import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';
import { localeAbsoluteUrl } from '../../../application/routing/locale-url';

/**
 * Shared BreadcrumbList JSON-LD builder for public static pages.
 *
 * Single source of truth for schema.org BreadcrumbList emitted across the
 * marketing + legal surface (home, for-stylists, for-studios, for-clients,
 * pricing, compare, about, contact, help-center, get-app, cookies, terms,
 * privacy, content-moderation). Each page declares its crumb chain (label i18n
 * key + locale-neutral path); this builder resolves localized labels and
 * locale-prefixed absolute URLs so the rich result stays consistent with the
 * page's canonical on /en/* and /de/* — not the prior hardcoded-Polish +
 * prefixless URLs that leaked PL labels/links onto EN/DE variants.
 */

export interface BreadcrumbCrumb {
  /** i18n key under the `breadcrumb.*` namespace (e.g. 'home', 'pricing'). */
  readonly labelKey: string;
  /**
   * Locale-neutral path WITHOUT locale prefix and WITHOUT trailing slash
   * (e.g. '/pricing'); '/' denotes the home crumb. The builder adds the
   * current locale prefix and the trailing slash.
   */
  readonly path: string;
}

// DECISION (nie usuwaj tego komentarza):
// URL construction MIRRORS PublicSeoHead.composition.tsx canonical/hreflang:
//  1. localePrefix = pl ? '' : `/${locale}` — the breadcrumb `item` MUST carry
//     the same locale prefix as the page canonical, otherwise the rich result
//     links EN/DE crumbs to bare PL URLs (cross-locale mismatch, the exact
//     defect this builder fixes).
//  2. trailingSlash: true (next.config.mjs) — every `item` ends with '/', home
//     is just `${domain}${prefix}/`. Matching the served URL form avoids
//     Google treating /pricing vs /pricing/ as duplicates.
// The `@id` (graph node identifier, e.g. `.../pricing/#breadcrumb`) stays
// locale-neutral BY DESIGN: WebPage JSON-LD references it by that exact string
// (buildStudioWebPageJsonLd, cookies/terms/privacy/content-moderation), and the
// existing FAQ/#faq nodes are locale-neutral too. It identifies the node, not a
// URL to fetch — so no locale prefix belongs here.

export function buildBreadcrumbJsonLd(
  messages: IntlMessages,
  locale: string,
  crumbs: ReadonlyArray<BreadcrumbCrumb>,
  atId?: string
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    ...(atId !== undefined ? { '@id': atId } : {}),
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: resolveMsgKey(messages, `breadcrumb.${crumb.labelKey}`),
      item: localeAbsoluteUrl(locale, crumb.path),
    })),
  };
}
