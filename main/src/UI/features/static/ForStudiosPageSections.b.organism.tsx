import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@kernel/domain/pricing/money.format';
import {
  canUsePaidPricing,
  PricingMarketErrorMolecule,
} from './PricingMarket.molecule';
import clsx from 'clsx';
import {
  UserFocusIcon,
  BuildingsIcon,
  TreeStructureIcon,
} from '@phosphor-icons/react';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { AlignedPricingFeatureListMolecule } from '../shared/pricing/AlignedPricingFeatureList.molecule';
import { PlanFunnelCtaMolecule } from '../shared/pricing/PlanFunnelCta.molecule';
import { PlanTrialFramingMolecule } from '../shared/pricing/PlanTrialFraming.molecule';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  PLAN_FEATURE_NAMESPACE,
  planFeatureHighlights,
} from '../../../application/pricing/plan-features.catalog';
import {
  USE_CASES,
  PRICING_TIER_PREVIEW,
  STUDIO_PREVIEW_FEATURE_COUNT,
} from './ForStudiosPageData';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { SectionComposition } from '../../components/Section/Section.composition';
import { TrustProseMolecule } from '../../components/TrustProse/TrustProse.molecule';
import styles from './ForStudiosPage.module.css';

/* ─── Use case icon map ─── */
const USE_CASE_ICONS: Record<string, React.ReactNode> = {
  UserFocus: <UserFocusIcon size={22} weight='regular' />,
  Buildings: <BuildingsIcon size={22} weight='regular' />,
  TreeStructure: <TreeStructureIcon size={22} weight='regular' />,
};

/* Trust strip between the hero and the benefits. Owner choice: one editorial
   sentence in --font-heading with color accents (TrustProse), instead of
   icon bullets. The page keeps only the full-bleed band and centering. (owner) */
export function ForStudiosTrustStripSectionOrganism() {
  const t = useTranslations('static.forStudios');

  return (
    <SectionComposition
      bordered
      className={styles.trustStripSection}
      aria-label={t('trustStrip.item1')}>
      <TrustProseMolecule
        sentence={t.rich('trustStrip.trustProse', {
          em: chunks => <em>{chunks}</em>,
        })}
      />
    </SectionComposition>
  );
}

/* ─── UseCasesSection (Notion stories — Solo→Studio→Network) ─── */
export function ForStudiosUseCasesSectionOrganism() {
  const t = useTranslations('static.forStudios');

  return (
    <SectionComposition tone='subtle' className={styles.scenariosSection}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        title={t('useCases.headline')}>
        {t('useCases.lede')}
      </SectionHeaderMolecule>
      {/* The card is a link (owner: the CTA row „Zacznij od planu Pro →"
          looked like a button and did nothing). The whole card, including
          the hover lift, is clickable. An anchor replaces <article> so the
          card layout stays on one element, and h3/p are legal inside <a>.
          DECISION: the use-case cards stay page-local instead of NavCard:
          the featured card has a solid primary block and permanent lift and
          every card a useCaseDetail divider, which NavCard does not support. */}
      <div className={styles.scenariosGrid}>
        {USE_CASES.map(uc => (
          <Link
            key={uc.id}
            href={uc.href}
            className={styles.useCase}
            data-featured={uc.featured ? 'true' : undefined}
            data-scroll-reveal>
            <div className={styles.useCaseTopline}>
              <span className={styles.useCaseIcon} aria-hidden='true'>
                {USE_CASE_ICONS[uc.iconName]}
              </span>
            </div>
            <h3 className={styles.useCaseTitle}>{t(uc.titleKey)}</h3>
            <p className={styles.useCaseBody}>{t(uc.bodyKey)}</p>
            <span className={styles.useCaseDetail}>{t(uc.detailKey)}</span>
          </Link>
        ))}
      </div>
    </SectionComposition>
  );
}

/* ─── PricingTierPreviewSection (Vercel pattern — 3 cards, Studio featured) ─── */
interface PricingTierPreviewSectionProps {
  onSecondaryClick: () => void;
}

export function ForStudiosPricingTierPreviewSectionOrganism({
  onSecondaryClick,
}: PricingTierPreviewSectionProps) {
  const t = useTranslations('static.forStudios');
  const tFeature = useTranslations(PLAN_FEATURE_NAMESPACE);
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

  return (
    <SectionComposition bordered className={styles.pricingSection}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        title={t('pricingPreview.headline')}>
        {t('pricingPreview.lede')}
      </SectionHeaderMolecule>

      {isMarketError ? (
        <PricingMarketErrorMolecule onRetry={refetchMarket} />
      ) : (
        country !== null &&
        !marketAvailable && <p role='status'>{tMarket('marketUnavailable')}</p>
      )}
      <div className={styles.pricingTierGrid}>
        {PRICING_TIER_PREVIEW.map(tier => {
          // Tier ids are PricingPlanValue keys, so they index the live plans directly.
          const plan = plans?.find(p => p.id === PricingPlanValue[tier.id]);
          // Cena MIESIĘCZNA — parytet z /pricing i for-stylists (owner).
          const price = plan?.priceMonthly ?? null;

          return (
            <article
              key={tier.id}
              className={styles.pricingTierCard}
              data-highlight={tier.highlighted ? 'true' : undefined}
              data-scroll-reveal>
              {tier.badgeKey && (
                <span className={styles.pricingTierBadge}>
                  {t(tier.badgeKey)}
                </span>
              )}
              <h3 className={styles.pricingTierName}>{t(tier.nameKey)}</h3>
              {/* Trial framing (owner): the offer leads where the price stood,
                  and the amount sits in small print under it. Contact (Scale)
                  keeps its label in the same slot so the card rows align. (owner) */}
              <div className={styles.pricingTierTrialBlock}>
                {tier.isContact ? (
                  <p className={styles.pricingTierTrialLede}>
                    {t('pricingPreview.tier3PriceLabel')}
                  </p>
                ) : (
                  /* Shared molecule, so parity with /pricing is structural.
                     Studios has no Free tier, so the lede is always trialLede. */
                  <PlanTrialFramingMolecule
                    ledeText={
                      currency
                        ? t('pricingPreview.trialLede', {
                            price: formatMoney(0, currency, locale),
                          })
                        : t('pricingPreview.trialLedeNoPrice')
                    }
                    renderAfter={
                      currency !== null && price !== null && price > 0
                        ? amount =>
                            t.rich('pricingPreview.trialPriceAfter', {
                              price: formatMoney(price, currency, locale),
                              amount,
                            })
                        : null
                    }
                    ledeClassName={styles.pricingTierTrialLede}
                    afterClassName={styles.pricingTierTrialAfter}
                  />
                )}
              </div>
              {/* Hairline-wiersze bez ikon — język 5A (głos ownera). */}
              <AlignedPricingFeatureListMolecule
                className={styles.pricingTierFeatures}
                itemClassName={styles.pricingTierFeatureItem}
                rowCount={STUDIO_PREVIEW_FEATURE_COUNT}
                items={planFeatureHighlights(
                  PricingPlanValue[tier.id],
                  STUDIO_PREVIEW_FEATURE_COUNT
                ).map(line => ({
                  id: line.id,
                  content: tFeature(line.key, line.params),
                }))}
              />
              {/* Per-plan CTA (owner): the mini price list closes conversion
                  immediately. Paid plans use the primary login-to-pay funnel
                  (the same as /pricing). Scale and contact go to /contact,
                  an outlined, lower-intent action. (owner) */}
              {tier.isContact ? (
                <span className={styles.pricingTierCta}>
                  <LinkButtonAtom
                    href={ROUTES_FRONT.CONTACT}
                    variant='outlined'
                    size='md'
                    className={styles.pricingTierCtaButton}>
                    {t('pricingPreview.contactCta')}
                  </LinkButtonAtom>
                </span>
              ) : (
                <PlanFunnelCtaMolecule
                  planId={PricingPlanValue[tier.id]}
                  disabled={!marketAvailable || price === null}
                  label={t('pricingPreview.tierCtaLabel')}
                  className={styles.pricingTierCta}
                  buttonClassName={styles.pricingTierCtaButton}
                  ctaLocation='studios-pricing-preview'
                />
              )}
            </article>
          );
        })}
      </div>

      <div className={styles.pricingActionRow}>
        <AppParagraphLinkAtom
          href={ROUTES_FRONT.PRICING}
          onClick={e => {
            e.preventDefault();
            onSecondaryClick();
          }}
          className={styles.pricingSecondaryLink}>
          {t('pricingPreview.ctaSecondary')}
        </AppParagraphLinkAtom>
      </div>
    </SectionComposition>
  );
}
