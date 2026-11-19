import type { MouseEventHandler } from 'react';
import { ScaleContactMolecule } from '../../components/ScaleContact/ScaleContact.molecule';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@kernel/domain/pricing/money.format';
import {
  canUsePaidPricing,
  PricingMarketErrorMolecule,
} from './PricingMarket.molecule';
import clsx from 'clsx';
import {
  PricingPlanValue,
  getPlanDisplayName,
} from '@kernel/domain/pricing/pricing.config';
import {
  PLAN_FEATURE_NAMESPACE,
  planFeatureHighlights,
} from '../../../application/pricing/plan-features.catalog';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { SectionComposition } from '../../components/Section/Section.composition';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { AlignedPricingFeatureListMolecule } from '../shared/pricing/AlignedPricingFeatureList.molecule';
import { PlanFunnelCtaMolecule } from '../shared/pricing/PlanFunnelCta.molecule';
import { PlanTrialFramingMolecule } from '../shared/pricing/PlanTrialFraming.molecule';
import {
  PRICING_PREVIEW,
  STYLIST_PREVIEW_FEATURE_COUNT,
} from './ForStylistsPageData';
import styles from './ForStylistsPage.module.css';

/* ─── PricingPreviewSection (mini pricing of the LP, per-plan CTA wired into the funnel) ─── */
interface PricingPreviewSectionProps {
  onPricingClick: MouseEventHandler<HTMLButtonElement>;
}

export function ForStylistsPricingPreviewSectionOrganism({
  onPricingClick,
}: PricingPreviewSectionProps) {
  const {
    data: plans,
    currency,
    country,
    internationalBillingEnabled,
    isCurrencyLocked,
    isMarketError,
    refetchMarket,
  } = usePricingPlans();
  const locale = useLocale();
  const tMarket = useTranslations('static.pricing');
  const marketAvailable =
    currency !== null &&
    canUsePaidPricing(country, internationalBillingEnabled, isCurrencyLocked);
  const t = useTranslations('static.forStylists');
  const tFeature = useTranslations(PLAN_FEATURE_NAMESPACE);
  const gridTiers = PRICING_PREVIEW.filter(tier => !tier.isContact);
  const contactTier = PRICING_PREVIEW.find(tier => tier.isContact);
  // Card lines = projection of the feature catalog (what a plan adds over the cheaper one).
  const featuresOf = (tier: (typeof PRICING_PREVIEW)[number]) =>
    planFeatureHighlights(tier.id, STYLIST_PREVIEW_FEATURE_COUNT).map(line => ({
      id: line.id,
      content: tFeature(line.key, line.params),
    }));

  return (
    <SectionComposition className={styles.pricingSection}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        title={t('pricing.headline')}>
        {t('pricing.lede')}
      </SectionHeaderMolecule>
      {isMarketError ? (
        <PricingMarketErrorMolecule onRetry={refetchMarket} />
      ) : (
        country !== null &&
        !marketAvailable && <p role='status'>{tMarket('marketUnavailable')}</p>
      )}
      <p className={styles.pricingTrustline}>{t('pricing.trustline')}</p>
      <div className={styles.pricingList}>
        {gridTiers.map(tier => {
          const plan = plans?.find(p => p.id === tier.id);
          // MONTHLY price, the same as on /pricing. A mini pricing that showed the
          // annual-plan rate made a visitor going from the landing page to pricing
          // see a rise (63 to 79 zl) that looked like a price hike between two
          // screens. One amount on every surface; the annual period is chosen only on pricing.
          const price = plan?.priceMonthly ?? null;
          const isFree = tier.id === PricingPlanValue.FREE;

          return (
            <article
              key={tier.id}
              className={styles.pricingTier}
              data-highlight={tier.highlighted || undefined}
              data-scroll-reveal>
              <div className={styles.pricingContent}>
                <div className={styles.pricingHeader}>
                  <h3 className={styles.pricingName}>
                    {getPlanDisplayName(tier.id)}
                  </h3>
                  {/* Trial framing through the shared molecule: parity with the main
                      /pricing (tierSection) is structural, not hand-kept. The entry
                      offer is the hero; the post-trial amount follows below. */}
                  <div className={styles.pricingTrialBlock}>
                    <PlanTrialFramingMolecule
                      ledeText={
                        currency
                          ? t(
                              isFree ? 'pricing.freeLede' : 'pricing.trialLede',
                              { price: formatMoney(0, currency, locale) }
                            )
                          : t(
                              isFree
                                ? 'pricing.freeLedeNoPrice'
                                : 'pricing.trialLedeNoPrice'
                            )
                      }
                      renderAfter={
                        !isFree &&
                        currency !== null &&
                        price !== null &&
                        price > 0
                          ? amount =>
                              t.rich('pricing.trialPriceAfter', {
                                price: formatMoney(price, currency, locale),
                                amount,
                              })
                          : null
                      }
                      ledeClassName={styles.pricingTrialLede}
                      afterClassName={styles.pricingTrialAfter}
                    />
                  </div>
                </div>
                {/* Hairline rows without icons: language 5A (owner). */}
                <AlignedPricingFeatureListMolecule
                  className={styles.pricingFeatures}
                  itemClassName={styles.pricingFeatureItem}
                  rowCount={STYLIST_PREVIEW_FEATURE_COUNT}
                  items={featuresOf(tier)}
                />
              </div>
              {/* Per-plan CTA (owner): the shared molecule wires into the
                  login-to-pay funnel with the monthly period displayed above. */}
              <PlanFunnelCtaMolecule
                planId={tier.id}
                disabled={!isFree && (!marketAvailable || price === null)}
                label={t('pricing.tierCtaLabel')}
                className={styles.pricingTierCta}
                buttonClassName={styles.pricingTierCtaButton}
                ctaLocation='stylists-pricing-preview'
              />
            </article>
          );
        })}
      </div>
      {/* Scale (contact): a quiet full-width row under the grid of 4 cards
          (the .scaleCta pattern from /pricing): no orphan in the 2nd row. */}
      {contactTier && (
        <ScaleContactMolecule
          title={getPlanDisplayName(contactTier.id)}
          description={featuresOf(contactTier)
            .map(line => line.content)
            .join(', ')}
          action={t('pricing.contactLabel')}
        />
      )}
      <div className={styles.pricingCta}>
        <ButtonAtom
          direction='forward'
          variant='outlined'
          size='md'
          className={styles.pricingCtaButton}
          onClick={onPricingClick}>
          {t('pricing.ctaButton')}
        </ButtonAtom>
      </div>
    </SectionComposition>
  );
}
