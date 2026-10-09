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
  // DECISION (nie usuwaj): brak `founder` (imię właściciela = dana
  // identyfikująca) oraz adres zredukowany do samego kraju. JSON-LD czytają
  // crawlery, więc nie wystawiamy tu tożsamości osoby ani lokalizacji. Pełne
  // dane rejestrowe firmy są tylko w regulaminie (obfuskowane przez <PiiTextAtom>).
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
      email: BRAND_CONFIG.email.support,
      contactType: 'customer support',
      availableLanguage: ['Polish', 'English', 'German'],
    },
    {
      '@type': 'ContactPoint',
      email: BRAND_CONFIG.email.contact,
      contactType: 'general inquiry',
      availableLanguage: ['Polish', 'English', 'German'],
    },
    {
      '@type': 'ContactPoint',
      email: BRAND_CONFIG.email.privacy,
      contactType: 'privacy',
      availableLanguage: ['Polish'],
    },
  ],
  // sameAs = sygnal encji dla Google/AI (disambiguacja marki "nailfolio").
  // Handle z BRAND_CONFIG (SSOT) — kolejne profile (TikTok/FB) dopisuja sie
  // przez BRAND_CONFIG.social, NIE literalami tutaj. Instagram zalozony przez
  // ownera 2026-07-16. Pustej tablicy nie emitujemy nigdy (mylila parsery),
  // dlatego przy wylaczonym przelaczniku klucz znika w calosci (DECISION w
  // UI/shared/brandSocial.ts).
  ...(BRAND_SOCIAL_PROFILES_PUBLIC
    ? {
        sameAs: [`https://www.instagram.com/${BRAND_CONFIG.social.instagram}/`],
      }
    : {}),
} as const;
