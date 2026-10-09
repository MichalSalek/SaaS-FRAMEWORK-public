import { SEO_CONFIG } from '@kernel/policies/seo.policy';

// DECISION (nie usuwaj tego komentarza):
// The only offer allowed in JSON-LD is the Free plan at price 0. B37 keeps PAID
// prices out of structured data (Stripe is their single source and a static copy
// would drift); a zero price for the Free plan cannot drift. Google treats
// `offers.price` as required for a SoftwareApplication rich result, so an entity
// that carries aggregateRating without it is ineligible, and AI answer engines
// read the same field as "free to start". Attach it only to entities whose page
// offers the Free plan: for-studios sells paid tiers only and stays offer-less.
export const FREE_PLAN_OFFER_JSONLD = {
  '@type': 'Offer',
  name: 'Free',
  price: '0',
  priceCurrency: 'PLN',
  availability: 'https://schema.org/InStock',
  url: `${SEO_CONFIG.domain}/pricing/`,
} as const;
