// UI/features/static/PricingTierCard.organism.tsx
//
// A single plan card of the LP pricing, extracted from PricingTierSection
// (max-lines + the 2+2 layout, owner: the card renders in TWO grids, the light
// pair Free+Pro and the ink premium band Pro Marka+Studio, so the card JSX must
// live once). All section logic (pair split, anchors, funnel hrefs) stays in the
// organism; the card receives ready values.

import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { useLocale, useTranslations } from 'next-intl';
import { trackPricingPlanClicked } from '../../../application/analytics/cta-events';
import { PushPinIcon } from '@phosphor-icons/react';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { AlignedPricingFeatureListMolecule } from '../shared/pricing/AlignedPricingFeatureList.molecule';
import { formatMoney } from '@kernel/domain/pricing/money.format';
import type {
  BillingCurrency,
  CountryCode,
} from '@kernel/domain/localization/country.config';
import { PlanTrialFramingMolecule } from '../shared/pricing/PlanTrialFraming.molecule';
import {
  PLAN_FEATURE_NAMESPACE,
  planFeatureValue,
  pricingCardCopyParams,
  type PlanFeatureLine,
} from '../../../application/pricing/plan-features.catalog';
import type { PricingTier } from './PricingPageData';
import styles from './PricingPage.module.css';

export interface PricingTierCardProps {
  tier: PricingTier;
  featureResults: PlanFeatureLine[];
  /** Shared number of feature rows IN THE PAIR (subgrid track, spacers). */
  maxFeatureRows: number;
  /** Price of the current period (minor units); null when Stripe falls back. */
  price: number | null;
  monthlyPrice: number | null;
  yearlyTotal: number | null;
  currency: BillingCurrency | null;
  billingCountry?: CountryCode | null;
  paidDisabled: boolean;
  isYearly: boolean;
  currentPlan: PricingPlan | null;
  billingPeriod: BillingPeriod;
  /** Studio vs Pro+ decoy anchor (minor units); the target card only. */
  anchoringDiff: number | null;
  ctaHref: string;
  onCtaFunnel: () => void;
}

/**
 * The card = a per-element subgrid (owner): EVERY row (badge / name /
 * tagline / offer / price-after / micro / pinned / features / note / CTA /
 * footer) shares a track between the plans IN ITS grid, so horizontal lines
 * align despite different content lengths. Empty slots render a space.
 */
export function PricingTierCardOrganism({
  tier,
  featureResults,
  maxFeatureRows,
  price,
  monthlyPrice,
  yearlyTotal,
  currency,
  billingCountry,
  paidDisabled,
  isYearly,
  currentPlan,
  billingPeriod,
  anchoringDiff,
  ctaHref,
  onCtaFunnel,
}: PricingTierCardProps) {
  const t = useTranslations('static.pricing');
  const tFeature = useTranslations(PLAN_FEATURE_NAMESPACE);
  const locale = useLocale();
  const pinned = planFeatureValue('pinned', tier.planId);
  // Numbers in the card sentences (tagline, Studio note, Free footer) come from the kernel.
  const cardParams = pricingCardCopyParams();

  // Yearly saving compares twelve monthly charges against the actual annual charge.
  // The comparison names the current monthly tariff; it does not claim a historical
  // lowest price. Both appear only on paid+yearly.
  const yearlySaving =
    monthlyPrice !== null && yearlyTotal !== null
      ? monthlyPrice * 12 - yearlyTotal
      : null;
  // DECISION: the recommendation reads `tier.isRecommended`, never `tier.id === 'pro'`:
  // PricingPageData is the one source, shared with PricingComparisonTable, so moving the
  // recommendation to another plan moves the table and the ink card together.
  const isRecommended = tier.isRecommended === true;
  const isCurrent = currentPlan === tier.planId;
  // Her current plan is never advertised as recommended (parity with onboarding
  // `isRec && !isSel` and the account plan list `isRecommended && !isCurrent`).
  // The premium band is a section composition choice, not a recommendation, so
  // it stays on ink whichever plan she has.
  const showsRecommendation = isRecommended && !isCurrent;
  const isFree = tier.planId === PricingPlanValue.FREE;

  return (
    <article
      className={styles.tierCard}
      data-target={tier.isTarget || undefined}
      data-pro={showsRecommendation || undefined}
      data-onink={tier.isPremiumBand || undefined}
      /* „Recommended" speaks ONE language: a full negative (owner vote).
         data-negative collects EVERY card on ink (Pro from the light pair
         + both premium band cards), so the content-colour overrides have
         one selector instead of two diverging lists. */
      data-negative={showsRecommendation || tier.isPremiumBand || undefined}
      data-scroll-reveal>
      <div className={styles.tierKickerRow}>
        {showsRecommendation && (
          <EyebrowAtom as='p' variant='plain' className={styles.tierKickerPro}>
            {t('tierSection.recommendedNote')}
          </EyebrowAtom>
        )}
        {tier.badgeKey && (
          <EyebrowAtom as='p' variant='plain' className={styles.tierBadge}>
            {t(tier.badgeKey)}
          </EyebrowAtom>
        )}
      </div>
      {/* Plan name = <h3> under the H2 of the „Plany i ceny" section (heading hierarchy
          + heading weight for the phrases „Pro Marka"/„Studio"). An h2 here made
          4 equal h2 in the section, flattening the structure. */}
      <h3 className={styles.tierName}>{t(tier.nameKey)}</h3>
      <p className={styles.tierTagline}>{t(tier.taglineKey, cardParams)}</p>
      {/* Trial framing (shared molecule, parity with the LP mini pricings
          guaranteed structurally): the entry OFFER is the hero where the price
          usually stands; the complete post-trial amount follows below. */}
      <PlanTrialFramingMolecule
        ledeText={
          currency
            ? t(isFree ? 'tierSection.freeLede' : 'tierSection.trialLede', {
                price: formatMoney(0, currency, locale),
              })
            : t(
                isFree
                  ? 'tierSection.freeLedeNoPrice'
                  : 'tierSection.trialLedeNoPrice'
              )
        }
        renderAfter={
          !isFree &&
          currency !== null &&
          price !== null &&
          price > 0 &&
          (!isYearly || yearlyTotal !== null)
            ? amount =>
                t.rich(
                  isYearly
                    ? 'tierSection.trialPriceAfterYearly'
                    : 'tierSection.trialPriceAfter',
                  {
                    price: formatMoney(price, currency, locale),
                    total:
                      yearlyTotal === null
                        ? ''
                        : formatMoney(yearlyTotal, currency, locale),
                    amount,
                  }
                )
            : null
        }
        ledeClassName={styles.tierTrialLede}
        afterClassName={styles.tierTrialAfter}
      />
      {/* Yearly-meta: the annual saving + the current monthly tariff
          price. The wrapper is ALWAYS rendered (constant child count = the subgrid
          keeps its rows); empty on monthly/Free, so the track auto-collapses. */}
      <div className={styles.tierYearlyMeta}>
        {isYearly &&
          !isFree &&
          currency !== null &&
          yearlySaving !== null &&
          yearlySaving > 0 && (
            <p className={styles.tierSaving}>
              {t('tierSection.savingText', {
                saving: currency
                  ? formatMoney(yearlySaving, currency, locale)
                  : '',
              })}
            </p>
          )}
        {isYearly && !isFree && monthlyPrice !== null && monthlyPrice > 0 && (
          <p className={styles.tierReferencePrice}>
            {t.rich('tierSection.referencePrice', {
              price: () =>
                currency ? formatMoney(monthlyPrice, currency, locale) : null,
            })}
          </p>
        )}
      </div>
      <p className={styles.tierMicroPrice}>
        {/* Micro anchor „za grosze dziennie" ONLY on monthly: yearly already carries
            the saving + the monthly comparison, and a fourth number blurred the anchor. */}
        {!isFree &&
        !isYearly &&
        currency !== null &&
        price !== null &&
        price > 0
          ? t('tierSection.microPrice', {
              value: formatMoney(Math.round(price / 30), currency, locale),
            })
          : ' '}
      </p>
      {/* The only place for the number of pinned designs. */}
      <p className={styles.tierPinnedInfo}>
        <PushPinIcon size={14} weight='regular' />
        <span>
          {pinned.kind === 'limited'
            ? tFeature('catalog.pinned.limited', { count: pinned.count })
            : ' '}
        </span>
      </p>
      {/* Aesop restraint: features as hairline ROWS (typography + line,
          no icons). Functional checkmarks in the table. */}
      <AlignedPricingFeatureListMolecule
        className={styles.tierFeatureRows}
        rowCount={maxFeatureRows}
        items={featureResults.map(fr => ({
          id: fr.key,
          content: tFeature(fr.key, fr.params),
        }))}
      />
      {/* Body note (owner): Studio carries a DYNAMIC decoy anchor
          „tylko X PLN więcej niż Pro+"; Pro+ a static decoy note;
          the rest ' '. Fallback: no Stripe prices means a static studioBodyNote. */}
      <p className={styles.tierBodyNote}>
        {tier.isTarget && anchoringDiff !== null && anchoringDiff > 0
          ? t.rich('tierSection.anchoringNote', {
              ...cardParams,
              diff: () =>
                currency ? formatMoney(anchoringDiff, currency, locale) : null,
            })
          : tier.bodyNoteKey
            ? t(tier.bodyNoteKey)
            : ' '}
      </p>
      {/* Plan-aware CTA (primary): current plan → disabled marker; others →
          deep-link login→/pay with the funnel intent on EVERY viewport (no get-app
          gate on desktop; see the DECISION in PricingTierSection.organism.tsx). */}
      {isCurrent || (!isFree && paidDisabled) ? (
        <span className={styles.tierCtaSlot}>
          <ButtonAtom
            variant='outlined'
            size='lg'
            className={styles.tierCtaButton}
            disabled>
            {isCurrent ? t('tierSection.currentPlanCta') : t(tier.ctaKey)}
          </ButtonAtom>
        </span>
      ) : (
        <span className={styles.tierCtaSlot}>
          {/* One interactive element (LinkButtonAtom = an <a> styled as a button);
              <Link><ButtonAtom/></Link> was <a><button>: invalid
              nesting and a double tab stop. */}
          {}
          <LinkButtonAtom
            href={ctaHref}
            variant={isFree ? 'outlined' : 'primary'}
            size='lg'
            className={styles.tierCtaButton}
            onClick={() => {
              // A semantic funnel event ALONGSIDE the navigation. Through cta-events, so
              // it goes to both PostHog and GA4 (`select_item`); plan choice used to
              // be visible only in PostHog.
              trackPricingPlanClicked(
                tier.planId,
                billingPeriod,
                'pricing-tier',
                { billingCountry, currency }
              );
              onCtaFunnel();
            }}>
            {currentPlan !== null
              ? t('tierSection.switchPlanCta')
              : t(tier.ctaKey)}
          </LinkButtonAtom>
        </span>
      )}
      {/* Slimmed footer (owner). One trust line. */}
      <p className={styles.tierFooterNote}>
        {isFree
          ? t('tierSection.footerNoteFree', cardParams)
          : t('tierSection.footerNotePaid')}
      </p>
    </article>
  );
}
