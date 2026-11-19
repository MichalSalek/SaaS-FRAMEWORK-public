import { LP_ASSETS } from '../../assets/lpAssets';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { BRAND_SOCIAL_PROFILES_PUBLIC } from '../../shared/brandSocial';

export const ORGANIZATION_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SEO_CONFIG.domain}/#organization`,
  name: 'Nailfolio',
  legalName: 'Nailfolio',
  url: SEO_CONFIG.domain,
  logo: {
    '@type': 'ImageObject',
    url: `${SEO_CONFIG.domain}${LP_ASSETS.seo.logo}`,
    width: 512,
    height: 512,
  },
  description:
    'Visual CRM dla stylistek paznokci. Galeria z filtrami koloru, stylu i długości, kod QR w salonie, sesja inspiracji od klientek, zero prowizji od klientek.',
  slogan: 'Portfolio paznokci i historia klientek',
  foundingDate: '2025',
  // DECISION: no `founder` (the owner's name is identifying data) and the address is reduced to
  // the country alone. Crawlers read JSON-LD, so no person identity or location is exposed here;
  // the full registration data of the company is only in the terms (obfuscated by <PiiTextAtom>).
  address: {
    '@type': 'PostalAddress',
    addressCountry: 'PL',
  },
  areaServed: [
    { '@type': 'Country', name: 'Poland' },
    { '@type': 'Country', name: 'Germany' },
    { '@type': 'Country', name: 'Austria' },
    { '@type': 'Country', name: 'United Kingdom' },
  ],
  contactPoint: [
    {
      '@type': 'ContactPoint',
      url: `${BRAND_CONFIG.url}/contact`,
      contactType: 'customer support',
      availableLanguage: ['Polish', 'English', 'German'],
    },
    {
      '@type': 'ContactPoint',
      url: `${BRAND_CONFIG.url}/contact`,
      contactType: 'general inquiry',
      availableLanguage: ['Polish', 'English', 'German'],
    },
    {
      '@type': 'ContactPoint',
      url: `${BRAND_CONFIG.url}/contact`,
      contactType: 'privacy',
      availableLanguage: ['Polish'],
    },
  ],
  // sameAs = entity signal for Google/AI (disambiguates the "nailfolio" brand). Handles come from
  // BRAND_CONFIG (SSOT): further profiles (TikTok/FB) are added through BRAND_CONFIG.social, NOT as
  // literals here. An empty array is never emitted (it confused parsers), so with the switch off
  // the key disappears entirely (see UI/shared/brandSocial.ts).
  ...(BRAND_SOCIAL_PROFILES_PUBLIC
    ? {
        sameAs: [`https://www.instagram.com/${BRAND_CONFIG.social.instagram}/`],
      }
    : {}),
} as const;
