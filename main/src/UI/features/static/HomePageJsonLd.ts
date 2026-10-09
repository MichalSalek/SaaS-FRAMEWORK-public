import { resolveDefaultOgAsset } from '../../assets/brandAssets';
import {
  SEO_CONFIG,
  SOFTWARE_APPLICATION_OS,
} from '@kernel/policies/seo.policy';
import { BRAND_ACCENT_PALETTE } from '@kernel/domain/user-and-account/branding.config';
import type { IntlMessages } from '../../../types/i18n';
import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';
import { FREE_PLAN_OFFER_JSONLD } from '../../components/JsonLd/freePlanOffer';
import { buildBreadcrumbJsonLd } from './breadcrumb.jsonld';

/**
 * Home (`/`) JSON-LD builders + static schema constants.
 *
 * Extracted from `pages/index.tsx` to match the project convention
 * (`ForStylistsPageJsonLd.ts`, `ForStudiosPageJsonLd.service.ts`): page shells
 * stay thin, structured-data lives in a dedicated module. Behaviour is identical
 * to the prior inline schema — only the location changed (FDX W4.4 extraction).
 */

// Description/featureList/audience w JSON-LD są zlokalizowane
// (seo.home.jsonLd.*) per locale — stała zamieniona na builder wołany
// w getStaticProps.
export const buildHomeSoftwareAppJsonLd = (
  messages: IntlMessages,
  locale: string | undefined = 'pl'
): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${SEO_CONFIG.domain}/#software`,
  name: 'Nailfolio',
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: 'Visual CRM / Portfolio Management',
  operatingSystem: SOFTWARE_APPLICATION_OS,
  url: SEO_CONFIG.domain,
  description: resolveMsgKey(messages, 'seo.home.jsonLd.appDescription'),
  image: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
  // DECISION (nie usuwaj): liczba akcentów personalizacji (feature7) derywowana
  // z SSOT (BRAND_ACCENT_PALETTE) — nie hardcoded, żeby JSON-LD nie dryfował od
  // faktów; i18n string niesie placeholder {count} podmieniany build-time.
  featureList: [1, 2, 3, 4, 5, 6, 7, 8].map(n =>
    resolveMsgKey(messages, `seo.home.jsonLd.feature${n}`).replace(
      '{count}',
      String(BRAND_ACCENT_PALETTE.length)
    )
  ),
  audience: {
    '@type': 'BusinessAudience',
    audienceType: resolveMsgKey(messages, 'seo.home.jsonLd.audienceType'),
  },
  inLanguage: ['pl-PL', 'en-US', 'de-DE'],
  // DECISION (nie usuwaj): no PAID prices in JSON-LD, Stripe is their SSOT (B37).
  // The Free-plan offer (price 0) is the one exception, see FREE_PLAN_OFFER_JSONLD.
  offers: FREE_PLAN_OFFER_JSONLD,
  author: { '@id': `${SEO_CONFIG.domain}/#organization` },
  publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
});

// DECISION (nie usuwaj tego komentarza):
// Home breadcrumb = single crumb (the home node itself), no `@id` — preserves
// the prior structure. Label now i18n (`breadcrumb.home`) and the `item` URL is
// locale-prefixed, so /en/ and /de/ point to `/en/` and `/de/` respectively
// instead of the bare PL origin.
export function buildHomeBreadcrumbJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return buildBreadcrumbJsonLd(messages, locale, [
    { labelKey: 'home', path: '/' },
  ]);
}
