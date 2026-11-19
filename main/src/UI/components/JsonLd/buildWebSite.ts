import { SEO_CONFIG } from '@kernel/policies/seo.policy';

export const WEBSITE_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SEO_CONFIG.domain}/#website`,
  url: SEO_CONFIG.domain,
  name: 'Nailfolio',
  alternateName: 'Nailfolio: portfolio paznokci online',
  description:
    'Visual CRM dla stylistek paznokci. Galeria z filtrami, kod QR w salonie, sesja inspiracji, zero prowizji od klientek.',
  inLanguage: ['pl-PL', 'en-US', 'de-DE'],
  publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
} as const;
