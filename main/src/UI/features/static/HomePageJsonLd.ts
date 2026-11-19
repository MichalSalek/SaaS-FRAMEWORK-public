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
 * stay thin, structured-data lives in a dedicated module.
 */

// Description/featureList/audience in the JSON-LD are localized
// (seo.home.jsonLd.*) per locale: a builder called in getStaticProps.
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
  // The accent count ({count} in feature7) comes from BRAND_ACCENT_PALETTE so it never drifts.
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
  // DECISION: see main/src/UI/components/JsonLd/freePlanOffer.ts (no paid prices in JSON-LD).
  offers: FREE_PLAN_OFFER_JSONLD,
  author: { '@id': `${SEO_CONFIG.domain}/#organization` },
  publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
});

// Home breadcrumb is a single crumb with a locale-prefixed `item` URL (/en/, /de/).
export function buildHomeBreadcrumbJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return buildBreadcrumbJsonLd(messages, locale, [
    { labelKey: 'home', path: '/' },
  ]);
}
