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
  TIERS,
  getTierFeatureResults,
  type PricingTier,
} from './PricingPageData';
import { PricingTierCardOrganism } from './PricingTierCard.organism';
import styles from './PricingPage.module.css';

// Per-plan conversion-funnel hrefy (buildPlanLoginHref/buildPlanPayDeepLink)
// wyekstrahowane do współdzielonego pricingFunnelHref (SSOT — te same hrefy
// używają mini-cenniki LP for-stylists/for-studios; S44).

interface PricingTierSectionProps {
  isYearly: boolean;
  /** Przełącznik Miesięcznie/Rocznie — renderowany bezpośrednio nad boxami
   *  planów (głos ownera); stan zostaje w PricingPage. */
  billingToggle?: ReactNode;
  /** Slot POD Scale (owner S81: client-banner „Jesteś klientką?"). */
  afterScale?: ReactNode;
  /** Slot POD kartami/bannerem — porównanie planów w TEJ SAMEJ bandzie
   *  (owner 2026-08-19: porównanie bezpośrednio pod pricing table). */
  afterPlans?: ReactNode;
}

interface TierWithFeatures {
  tier: PricingTier;
  featureResults: ReturnType<typeof getTierFeatureResults>;
}

/**
 * Boxy planów — układ 2+2 (głos ownera 2026-07-11, hybryda PR-B+PR-C z
 * głosowania playground): jasna para Free+Pro (Pro = polecany, mocna rama),
 * pod nią atramentowy band „Pakiety premium" z parą Pro Marka+Studio (negatyw
 * SEKCJI zamiast negatywu karty Pro — ledger: ink-negatyw przeniesiony z karty
 * na band), na dole Scale jako dyskretny wiersz kontaktowy. Wnętrze karty →
 * PricingTierCard.organism (wspólny JSX obu gridów).
 */
export function PricingTierSectionOrganism({
  isYearly,
  billingToggle,
  afterScale,
  afterPlans,
}: PricingTierSectionProps) {
  const t = useTranslations('static.pricing');
  const { data: plans, isPending } = usePricingPlans();

  // Plan-aware CTAs: a logged-in stylist sees her plan marked as current and
  // "Zmień plan" on the others, linking straight to the in-app pay page.
  // Clients/logged-out visitors keep the marketing CTAs (login → pay funnel).
  // useCurrentUserAccount is token-gated, so logged-out LP traffic fires no
  // request. Hydration-safe: the query data is absent on the server AND on the
  // first client render (token-gated), so SSR markup always shows the default
  // login-funnel CTAs; the plan-aware swap happens post-mount once the query
  // resolves (same pattern as HeaderUserMenu's auth swap).
  //
  // DECISION (owner 2026-07-03 — web-login-first parity on desktop):
  // The pricing plan CTA is a PAYMENT funnel (an account route), so it enters
  // the web login → /pay flow on EVERY viewport, desktop included — NOT the
  // /get-app bounce that gates the mobile-only PRODUCT zone. Web checkout works
  // on a laptop (route-access.policy exempts account routes), so funnelling a
  // desktop visitor who clicked a plan to the app store instead of web checkout
  // contradicted web-login-first. Hence no useAppEntryMode gate here.
  const { data: currentUser } = useCurrentUserAccount();
  const { setPricingFunnel } = usePricingFunnelState();

  // Decoy-anchor (głos ownera, restore S44): Studio kotwiczy się przeciw Pro+
  // („tylko X PLN więcej") — bez tego decoy jest samym kosztem, nie popycha ku
  // Studio. Diff billing-aware (grosze; PriceSlot /100 → PLN). Gdy Stripe padł
  // (null) → karta Studio spada na statyczny studioBodyNote (fallback w karcie).
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
  // Pełna enumeracja cech per plan (owner S81) — każda karta niesie własną,
  // kompletną listę z SSOT (`tier.limits`), bez odniesień „Wszystko z X".
  const tiersWithFeatures: TierWithFeatures[] = displayTiers.map(tier => ({
    tier,
    featureResults: getTierFeatureResults(tier),
  }));
  const soloPair = tiersWithFeatures.filter(({ tier }) => !tier.isPremiumBand);
  const premiumPair = tiersWithFeatures.filter(
    ({ tier }) => tier.isPremiumBand
  );
  // Tor feature liczony PER PARA (nie globalnie): pary dzielą tylko własny
  // grid, więc krótsza para nie dziedziczy pustych wierszy dłuższej.
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
          yearlyPrice={plan?.priceYearly ?? null}
          isYearly={isYearly}
          isPending={isPending}
          currentPlan={currentPlan}
          billingPeriod={billingPeriod}
          anchoringDiff={tier.isTarget ? anchoringDiff : null}
          ctaHref={resolveTierCtaHref(tier.planId)}
          onCtaFunnel={() =>
            setPricingFunnel({ planId: tier.planId, billingPeriod })
          }
        />
      );
    });

  return (
    /* Band = Section (tone subtle: bg-subtle + pełna rama hairline);
       className trzyma rytm strony, kotwicę ::before i clip dekoracji,
       innerClassName podnosi dzieci ponad dekorację (z-index). */
    <SectionComposition
      tone='subtle'
      className={styles.tiersSection}
      innerClassName={styles.tiersInner}>
      {/* Tytuł sekcji W sekcji (głos ownera S24); skala 1:1 z
          .comparisonHeadline, wycentrowany nad przełącznikiem okresu. */}
      <h2 className={styles.tiersHeadline}>{t('tiers.headline')}</h2>
      {billingToggle != null && (
        <div className={styles.tiersToggleRow}>{billingToggle}</div>
      )}
      <div className={styles.tiersGrid}>{renderPair(soloPair)}</div>

      {/* Atramentowy band premium (hybryda PR-B+PR-C): Pro Marka + Studio jako
          „najlepsze pakiety" na negatywie sekcji — eyebrow gold + para kart
          on-ink. Floor: solid fill (zero gradientu), rama pełna, tonal steps. */}
      {premiumPair.length > 0 && (
        <div className={styles.premiumBand}>
          <p className={styles.premiumBandLabel}>
            {t('tierSection.premiumBandLabel')}
          </p>
          <div className={styles.tiersGrid}>{renderPair(premiumPair)}</div>
        </div>
      )}

      {/* Scale — enterprise CTA */}
      {scaleTier && (
        <ScaleContactMolecule
          title={t(scaleTier.nameKey)}
          description={t('tierSection.scaleCtaText')}
          action={t(scaleTier.ctaKey)}
        />
      )}

      {/* Client-banner (owner S81): bezpośrednio pod Scale. */}
      {afterScale}

      {/* Porównanie + trust/kotwica w tej samej bandzie (owner 2026-08-19). */}
      {afterPlans}
    </SectionComposition>
  );
}
