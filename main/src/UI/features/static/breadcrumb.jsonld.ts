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

// DECISION: `item` URLs mirror PublicSeoHead.composition.tsx canonicals: the same locale
// prefix (none for pl), else EN/DE crumbs link to PL URLs, and a trailing slash
// (trailingSlash: true), else /pricing and /pricing/ read as duplicates. The `@id`
// (e.g. `.../pricing/#breadcrumb`) stays locale-neutral on purpose: WebPage JSON-LD
// references it by that exact string; it names a node, not a URL to fetch.

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
