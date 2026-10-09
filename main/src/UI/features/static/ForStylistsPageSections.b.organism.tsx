import type { MouseEventHandler } from 'react';
import { ScaleContactMolecule } from '../../components/ScaleContact/ScaleContact.molecule';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { SectionComposition } from '../../components/Section/Section.composition';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { AlignedPricingFeatureListMolecule } from '../shared/pricing/AlignedPricingFeatureList.molecule';
import { PlanFunnelCtaMolecule } from '../shared/pricing/PlanFunnelCta.molecule';
import { PlanTrialFramingMolecule } from '../shared/pricing/PlanTrialFraming.molecule';
import { groszToPln } from '../shared/pricing/pricingFormat';
import { PRICING_PREVIEW } from './ForStylistsPageData';
import styles from './ForStylistsPage.module.css';

/* ─── PricingPreviewSection (mini-cennik LP — per-plan CTA wpięte w funnel) ─── */
interface PricingPreviewSectionProps {
  onPricingClick: MouseEventHandler<HTMLButtonElement>;
}

const STYLIST_FEATURE_ROW_OFFSETS: Partial<Record<PricingPlan, number>> = {
  [PricingPlanValue.PRO]: 1,
  [PricingPlanValue.PRO_PLUS]: 1,
};

export function ForStylistsPricingPreviewSectionOrganism({
  onPricingClick,
}: PricingPreviewSectionProps) {
  const { data: plans } = usePricingPlans();
  const t = useTranslations('static.forStylists');
  const gridTiers = PRICING_PREVIEW.filter(tier => !tier.isContact);
  const contactTier = PRICING_PREVIEW.find(tier => tier.isContact);
  const featureRowCount = Math.max(
    ...gridTiers.map(
      tier =>
        tier.featureKeys.length + (STYLIST_FEATURE_ROW_OFFSETS[tier.id] ?? 0)
    )
  );

  return (
    <SectionComposition className={styles.pricingSection}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        eyebrow={t('pricing.eyebrow')}
        eyebrowVariant='chip'
        title={t('pricing.headline')}>
        {t('pricing.lede')}
      </SectionHeaderMolecule>
      <p className={styles.pricingTrustline}>{t('pricing.trustline')}</p>
      <div className={styles.pricingList}>
        {gridTiers.map(tier => {
          const plan = plans?.find(p => p.id === tier.id);
          // Cena MIESIĘCZNA, ta sama co na /pricing (dyrektywa ownera 2026-09-02).
          // Mini-cenniki pokazywały wcześniej ratę planu rocznego, więc klientka
          // idąca z landingu do cennika widziała wzrost 63 → 79 zł i wyglądało to
          // jak podwyżka między dwoma ekranami. Jedna kwota na wszystkich
          // powierzchniach; okres roczny wybiera się dopiero w cenniku.
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
                  <h3 className={styles.pricingName}>{tier.name}</h3>
                  {/* Trial-framing przez współdzieloną molekułę — parytet
                      z głównym /pricing (tierSection) gwarantowany strukturalnie
                      (dawniej ręcznie). Oferta wejścia bohaterem, kwota małym
                      drukiem pod spodem. */}
                  <div className={styles.pricingTrialBlock}>
                    <PlanTrialFramingMolecule
                      ledeText={
                        isFree ? t('pricing.freeLede') : t('pricing.trialLede')
                      }
                      renderAfter={
                        !isFree && price !== null && price > 0
                          ? amount =>
                              t.rich('pricing.trialPriceAfter', {
                                price: groszToPln(price),
                                amount,
                              })
                          : null
                      }
                      ledeClassName={styles.pricingTrialLede}
                      afterClassName={styles.pricingTrialAfter}
                    />
                  </div>
                </div>
                {/* Hairline-wiersze bez ikon — język 5A (głos ownera). */}
                <AlignedPricingFeatureListMolecule
                  className={styles.pricingFeatures}
                  itemClassName={styles.pricingFeatureItem}
                  rowCount={featureRowCount}
                  leadingSpacerRows={STYLIST_FEATURE_ROW_OFFSETS[tier.id] ?? 0}
                  items={tier.featureKeys.map(f => ({
                    id: f.key,
                    content: t(
                      f.key,
                      f.count != null ? { count: f.count } : undefined
                    ),
                  }))}
                />
              </div>
              {/* Per-plan CTA (głos ownera S44) — współdzielona molekuła
                  wpina w login→pay funnel (billingPeriod='year' bo karta
                  pokazuje cenę roczną). */}
              <PlanFunnelCtaMolecule
                planId={tier.id}
                label={t('pricing.tierCtaLabel')}
                className={styles.pricingTierCta}
                buttonClassName={styles.pricingTierCtaButton}
                ctaLocation='stylists-pricing-preview'
              />
            </article>
          );
        })}
      </div>
      {/* Scale (kontakt) — cichy pełnoszerokościowy wiersz pod siatką 4 kart
          (wzorzec .scaleCta z /pricing): bez sieroty w 2. rzędzie. */}
      {contactTier && (
        <ScaleContactMolecule
          title={contactTier.name}
          description={contactTier.featureKeys.map(f => t(f.key)).join(', ')}
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
