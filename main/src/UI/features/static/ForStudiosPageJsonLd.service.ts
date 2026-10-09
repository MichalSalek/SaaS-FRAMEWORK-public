import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import type { IntlMessages } from '../../../types/i18n';
import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';

// Name/serviceType/description/audience/oferty w JSON-LD są zlokalizowane
// (seo.forStudios.jsonLd.*) per locale — stała zamieniona na builder wołany
// w getStaticProps. Nazwy planów (Pro Marka/Studio/Scale) = nazwy własne,
// NIE tłumaczone (zostają literałami).
export const buildStudioServiceJsonLd = (
  messages: IntlMessages
): Record<string, unknown> => {
  const jsonLdKey = (leaf: string): string =>
    resolveMsgKey(messages, `seo.forStudios.jsonLd.${leaf}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${SEO_CONFIG.domain}/for-studios/#service`,
    name: jsonLdKey('serviceName'),
    serviceType: jsonLdKey('serviceType'),
    provider: { '@id': `${SEO_CONFIG.domain}/#organization` },
    description: jsonLdKey('serviceDescription'),
    areaServed: [
      { '@type': 'Country', name: 'Poland' },
      { '@type': 'Country', name: 'Germany' },
      { '@type': 'Country', name: 'Austria' },
      { '@type': 'Country', name: 'United Kingdom' },
    ],
    audience: {
      '@type': 'BusinessAudience',
      audienceType: jsonLdKey('serviceAudienceType'),
    },
    // DECISION (nie usuwaj tego komentarza):
    // Brak cen w JSON-LD — Stripe = JEDYNE SSOT cen (B37). Usunięto AggregateOffer i ceny
    // z OfferCatalog (dryf vs faktyczny billing). hasOfferCatalog zostaje jako lista planów
    // (nazwy + opis przez itemOffered) — bez deklaracji ceny. Ceny tylko runtime ze Stripe.
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: jsonLdKey('catalogName'),
      itemListElement: [
        {
          '@type': 'Offer',
          name: 'Pro Marka',
          itemOffered: {
            '@type': 'Service',
            name: jsonLdKey('offerProPlus'),
          },
        },
        {
          '@type': 'Offer',
          name: 'Studio',
          itemOffered: {
            '@type': 'Service',
            name: jsonLdKey('offerStudio'),
          },
        },
        {
          '@type': 'Offer',
          name: 'Scale',
          itemOffered: {
            '@type': 'Service',
            name: jsonLdKey('offerScale'),
          },
        },
      ],
    },
  };
};
