import {
  canUsePaidPricing,
  PricingMarketMolecule,
} from './PricingMarket.molecule';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { ScaleContactMolecule } from '../../components/ScaleContact/ScaleContact.molecule';
import { SectionComposition } from '../../components/Section/Section.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import {
  buildPlanLoginHref,
  buildPlanPayDeepLink,
} from '../shared/pricing/pricingFunnelHref';
import {
  resolvePlanFeatures,
  type PlanFeatureLine,
} from '../../../application/pricing/plan-features.catalog';
import { TIERS, type PricingTier } from './PricingPageData';
import { PricingTierCardOrganism } from './PricingTierCard.organism';
import styles from './PricingPage.module.css';

// Per-plan conversion-funnel hrefs (buildPlanLoginHref/buildPlanPayDeepLink)
// extracted to the shared pricingFunnelHref (SSOT: the same hrefs are
// used by the LP mini pricings for-stylists/for-studios).

interface PricingTierSectionProps {
  isYearly: boolean;
  /** The Miesięcznie/Rocznie switch, rendered directly above the plan boxes
   *  (owner); state stays in PricingPage. */
  billingToggle?: ReactNode;
  /** Slot UNDER Scale (owner: the client banner „Jesteś klientką?"). */
  afterScale?: ReactNode;
  /** Slot UNDER the cards/banner: the plan comparison in the SAME band
   *  (owner: the comparison directly under the pricing table). */
  afterPlans?: ReactNode;
}

interface TierWithFeatures {
  tier: PricingTier;
  featureResults: PlanFeatureLine[];
}

/**
 * The plan boxes, a 2+2 layout (owner: hybrid from the playground vote):
 * a light pair Free+Pro (Pro = recommended, strong frame), under it an ink
 * „Pakiety premium" band with the pair Pro Marka+Studio (a SECTION negative
 * instead of a negative on the Pro card: the ink negative moved from the card
 * to the band), at the bottom Scale as a discreet contact row. Card interior →
 * PricingTierCard.organism (shared JSX of both grids).
 */
export function PricingTierSectionOrganism({
  isYearly,
  billingToggle,
  afterScale,
  afterPlans,
}: PricingTierSectionProps) {
  const t = useTranslations('static.pricing');
  const {
    data: plans,
    currency,
    country,
    internationalBillingEnabled,
    isCurrencyLocked,
  } = usePricingPlans();

  // Plan-aware CTAs: a logged-in stylist sees her plan marked as current and
  // "Zmień plan" on the others, linking straight to the in-app pay page.
  // Clients/logged-out visitors keep the marketing CTAs (login → pay funnel).
  // useCurrentUserAccount is token-gated, so logged-out LP traffic fires no
  // request. Hydration-safe: the query data is absent on the server AND on the
  // first client render (token-gated), so SSR markup always shows the default
  // login-funnel CTAs; the plan-aware swap happens post-mount once the query
  // resolves (same pattern as HeaderUserMenu's auth swap).
  //
  // DECISION: the plan CTA is a payment funnel (an account route), so it enters web
  // login then /pay on every viewport, desktop included, never the /get-app bounce of
  // the mobile-only product zone; route-access.policy allows account routes on desktop.
  // Hence no useAppEntryMode gate here. (owner)
  const { data: currentUser } = useCurrentUserAccount();
  const { setPricingFunnel } = usePricingFunnelState();

  // Decoy anchor (owner): Studio is anchored against Pro+
  // („tylko X PLN więcej"); without it the decoy is only a cost and does not push
  // towards Studio. A billing-aware diff (grosze; PriceSlot /100 gives PLN). When Stripe is down
  // (null) the Studio card falls back to the static studioBodyNote (fallback in the card).
  const findTierPrice = (planId: PricingPlan): number | null => {
    const plan = plans?.find(p => p.id === planId);
    if (plan == null) {
      return null;
    }
    return isYearly ? plan.priceYearly : plan.priceMonthly;
  };
  const studioPrice = findTierPrice(PricingPlanValue.STUDIO);
  const proPlusPrice = findTierPrice(PricingPlanValue.PRO_PLUS);
  const anchoringDiff =
    studioPrice !== null && proPlusPrice !== null
      ? studioPrice - proPlusPrice
      : null;
  const currentPlan: PricingPlan | null =
    currentUser?.stylist_account?.pricing_plan ?? null;
  // Map the LP toggle ('yearly' boolean) to the kernel BillingPeriod the
  // checkout endpoint expects ('month' | 'year').
  const billingPeriod: BillingPeriod = isYearly ? 'year' : 'month';

  // Per-tier CTA target: logged-in stylist → in-app pay page (deep-link);
  // everyone else → login deep-link carrying THIS tier's plan + period (so each
  // plan button is a distinct funnel entry that survives the auth gate).
  const resolveTierCtaHref = (planId: PricingPlan): string =>
    currentPlan !== null
      ? buildPlanPayDeepLink(planId, billingPeriod)
      : buildPlanLoginHref(planId, billingPeriod);

  const displayTiers = TIERS.filter(tier => !tier.isContact);
  const scaleTier = TIERS.find(tier => !displayTiers.includes(tier));
  // The full feature enumeration per plan (owner): each card carries its own
  // complete list from the feature catalog, with no „Everything in X" references. Pinned
  // designs are DELIBERATELY outside the list: they have their own line under the price.
  const tiersWithFeatures: TierWithFeatures[] = displayTiers.map(tier => ({
    tier,
    featureResults: resolvePlanFeatures(tier.planId, { exclude: ['pinned'] }),
  }));
  const soloPair = tiersWithFeatures.filter(({ tier }) => !tier.isPremiumBand);
  const premiumPair = tiersWithFeatures.filter(
    ({ tier }) => tier.isPremiumBand
  );
  // The feature track is computed PER PAIR (not globally): pairs share only their own
  // grid, so a shorter pair does not inherit the empty rows of a longer one.
  const featureRowsFor = (pair: TierWithFeatures[]): number =>
    Math.max(...pair.map(({ featureResults }) => featureResults.length));

  const renderPair = (pair: TierWithFeatures[]): ReactNode =>
    pair.map(({ tier, featureResults }) => {
      const plan = plans?.find(p => p.id === tier.planId);
      return (
        <PricingTierCardOrganism
          key={tier.id}
          tier={tier}
          featureResults={featureResults}
          maxFeatureRows={featureRowsFor(pair)}
          price={
            plan ? (isYearly ? plan.priceYearly : plan.priceMonthly) : null
          }
          monthlyPrice={plan?.priceMonthly ?? null}
          yearlyTotal={plan?.priceYearlyTotal ?? null}
          currency={currency}
          billingCountry={country}
          paidDisabled={
            !canUsePaidPricing(
              country,
              internationalBillingEnabled,
              isCurrencyLocked
            ) ||
            currency === null ||
            (isYearly
              ? plan?.priceYearlyTotal == null || plan.priceYearly == null
              : plan?.priceMonthly == null)
          }
          isYearly={isYearly}
          currentPlan={currentPlan}
          billingPeriod={billingPeriod}
          anchoringDiff={tier.isTarget ? anchoringDiff : null}
          ctaHref={resolveTierCtaHref(tier.planId)}
          onCtaFunnel={() =>
            setPricingFunnel({
              planId: tier.planId,
              billingPeriod,
              ...(country && { billingCountry: country }),
              ...(currency && { currency }),
            })
          }
        />
      );
    });

  return (
    /* Band = Section (tone subtle: bg-subtle + a full hairline frame);
       className keeps the page rhythm, the ::before anchor and the decoration clip,
       innerClassName lifts children above the decoration (z-index). */
    <SectionComposition
      tone='subtle'
      className={styles.tiersSection}
      innerClassName={styles.tiersInner}>
      {/* The section title INSIDE the section (owner); scale 1:1 with
          .comparisonHeadline, centred above the billing-period switch. */}
      <h2 className={styles.tiersHeadline}>{t('tiers.headline')}</h2>
      <PricingMarketMolecule />
      {billingToggle != null && (
        <div className={styles.tiersToggleRow}>{billingToggle}</div>
      )}
      <div className={styles.tiersGrid}>{renderPair(soloPair)}</div>

      {}
      {premiumPair.length > 0 && (
        <div className={styles.premiumBand}>
          <div className={styles.tiersGrid}>{renderPair(premiumPair)}</div>
        </div>
      )}

      {/* Scale: enterprise CTA */}
      {scaleTier && (
        <ScaleContactMolecule
          title={t(scaleTier.nameKey)}
          description={t('tierSection.scaleCtaText')}
          action={t(scaleTier.ctaKey)}
        />
      )}

      {/* Client banner (owner): directly under Scale. */}
      {afterScale}

      {/* Comparison + trust/anchor in the same band (owner). */}
      {afterPlans}
    </SectionComposition>
  );
}
