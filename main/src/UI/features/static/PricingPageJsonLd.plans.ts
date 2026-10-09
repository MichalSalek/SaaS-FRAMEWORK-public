import { resolveDefaultOgAsset } from '../../assets/brandAssets';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PLAN_TIER_ORDER } from '@kernel/domain/pricing/pricing-policy';
import type { IntlMessages } from '../../../types/i18n';
import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';

/* ─── Shared constants (pricing data SSOT, see PRICING_PACKAGING.md §4) ─── */

const BRAND_REF = { '@type': 'Organization', name: 'Nailfolio' } as const;

// DECISION (nie usuwaj tego komentarza):
// Encje planów bez `offers`/cen — Stripe = JEDYNE SSOT cen (B37, 2026-05-29).
// Ceny pojawiają się wyłącznie runtime z live Stripe (PricingPage). Statyczne ceny w
// schema dawały rich-snippet ryzykujący dryf vs faktyczny billing (Omnibus/UOKiK + kara
// Google za price-mismatch). Encje zostają (opis planów + @id ref z OfferCatalog),
// niosą wartość przez name/description/audience — bez deklaracji ceny.
//
// `@type` = Service, NIE Product (2026-08-25, GSC „Opisy produktów" ERROR na /*/pricing):
// Google waliduje KAŻDĄ encję Product pod rich-result „Product snippets" i wymaga jednej z
// `offers`/`review`/`aggregateRating` — encja price-less z B37 jest tam z definicji nie do
// naprawienia. Obejścia odrzucone: (a) `offers` = złamanie B37; (b) doklejenie site-wide
// `aggregateRating` (PRICING_REVIEWS dotyczy CAŁEJ apki) do 5 osobnych planów = markup
// wprowadzający w błąd → ryzyko manual action za spammy structured data. Plan abonamentowy
// SaaS to semantycznie usługa, więc Service jest POPRAWNIEJSZY, nie jest typem rich-result
// Google (zero walidacji offers) i pozostaje legalnym `Offer.itemOffered` dla OfferCatalog
// — ten sam wzorzec co ForStudiosPageJsonLd.service.ts. NIE zmieniać z powrotem na Product
// bez jednoczesnego cofnięcia B37.

/* ─── Service schemas per plan (5 plans, price-less — Stripe is SSOT) ─── */

// Description/audience per plan zlokalizowane (seo.pricing.jsonLd.*) per locale
// — stałe zamienione na builder wołany w getStaticProps. Nazwy planów
// ('Nailfolio Free' itd.) = nazwy własne z kernelowego PLAN_DISPLAY_NAMES,
// NIE tłumaczone. Lista planów = kernelowy PLAN_TIER_ORDER, a prefiks kluczy
// i18n to Record po unii — nowy plan w kernelu bez wpisu tutaj = błąd
// kompilacji, nie cicho brakujący schemat.
const PLAN_MSG_PREFIX: Record<PricingPlan, string> = {
  FREE: 'free',
  PRO: 'pro',
  PRO_PLUS: 'proPlus',
  STUDIO: 'studio',
  SCALE: 'scale',
};

const PLAN_META = PLAN_TIER_ORDER.map(planId => ({
  idFragment: `plan-${planId.toLowerCase().replace(/_/g, '-')}`,
  name: `Nailfolio ${getPlanDisplayName(planId)}`,
  msgPrefix: PLAN_MSG_PREFIX[planId],
}));

export function buildPricingPlansJsonLd(
  messages: IntlMessages,
  locale: string | undefined = 'pl'
): Array<Record<string, unknown>> {
  return PLAN_META.map(plan => ({
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${SEO_CONFIG.domain}/pricing/#${plan.idFragment}`,
    name: plan.name,
    description: resolveMsgKey(
      messages,
      `seo.pricing.jsonLd.${plan.msgPrefix}Description`
    ),
    image: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
    brand: BRAND_REF,
    provider: { '@id': `${SEO_CONFIG.domain}/#organization` },
    category: 'SaaS Subscription',
    audience: {
      '@type': 'BusinessAudience',
      audienceType: resolveMsgKey(
        messages,
        `seo.pricing.jsonLd.${plan.msgPrefix}Audience`
      ),
    },
  }));
}
