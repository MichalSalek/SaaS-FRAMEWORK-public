import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
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
import { groszToPln } from '../shared/pricing/pricingFormat';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  USE_CASES,
  PRICING_TIER_PREVIEW,
  type PricingTierPreview,
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

/* ─── TrustStripSection (between hero and benefits) — proza zaufania
   (głos ownera /ui S52 = wariant C): ikona+bullet pille zastąpione jednym
   editorial zdaniem w roli --font-heading z akcentami w kolorze (kanon TrustProse);
   strona trzyma tylko full-bleed band + centrowanie. ─── */
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
        eyebrow={t('useCases.eyebrow')}
        eyebrowVariant='plain'
        title={t('useCases.headline')}>
        {t('useCases.lede')}
      </SectionHeaderMolecule>
      {/* Karta = <Link> (głos ownera S22: wiersz-CTA „Zacznij od planu
          Pro →" wyglądał na button, ale nie działał — cała karta
          z hover-liftem jest klikalna). Anchor zamiast <article>: layout
          karty zostaje na tym samym elemencie (bez wrappera), a treść
          karty (h3/p) to legalna zawartość <a>.
          DECISION (nie usuwaj tego komentarza):
          Migracja na NavCard DIVERGENT: featured karta (studio) nosi
          SOLID primary color-block + permanentny editorial lift -12px ≥860px +
          custom badge useCaseTag (round-border uppercase chip) jako eyebrow +
          useCaseDetail z border-top hairline. NavCard nie obsługuje featured
          color-block ani tego poziomu liftu. Asymetryczny grid 0.92/1.18/0.92fr
          zostaje page-specific. Zostaje hand-rolled. */}
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
              <span className={styles.useCaseTag}>{t(uc.tagKey)}</span>
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

const STUDIO_FEATURE_ROW_OFFSETS: Partial<
  Record<PricingTierPreview['id'], number>
> = {
  PRO_PLUS: 1,
};

export function ForStudiosPricingTierPreviewSectionOrganism({
  onSecondaryClick,
}: PricingTierPreviewSectionProps) {
  const t = useTranslations('static.forStudios');
  const { data: plans } = usePricingPlans();
  const featureRowCount = Math.max(
    ...PRICING_TIER_PREVIEW.map(
      tier =>
        tier.featureKeys.length + (STUDIO_FEATURE_ROW_OFFSETS[tier.id] ?? 0)
    )
  );

  return (
    <SectionComposition bordered className={styles.pricingSection}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        eyebrow={t('pricingPreview.eyebrow')}
        eyebrowVariant='plain'
        title={t('pricingPreview.headline')}>
        {t('pricingPreview.lede')}
      </SectionHeaderMolecule>

      <div className={styles.pricingTierGrid}>
        {PRICING_TIER_PREVIEW.map(tier => {
          // DECISION (nie usuwaj tego komentarza):
          // Pricing IDs (PRO_PLUS, STUDIO, SCALE) match PricingPlanValue
          // enum exactly. usePricingPlans returns plans keyed by these IDs,
          // so .find(p => p.id === tier.id) safely retrieves the live price.
          const plan = plans?.find(p => p.id === PricingPlanValue[tier.id]);
          // Cena MIESIĘCZNA — parytet z /pricing i for-stylists (owner 2026-09-02).
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
              {/* Trial-framing (antipattern-cena, głos ownera S45): oferta
                  wejścia bohaterem tam, gdzie stała cena; kwota schowana małym
                  drukiem pod spodem. Kontakt (Scale) trzyma swoją etykietę
                  w tym samym slocie, żeby rzędy kart się wyrównywały. */}
              <div className={styles.pricingTierTrialBlock}>
                {tier.isContact ? (
                  <p className={styles.pricingTierTrialLede}>
                    {t('pricingPreview.tier3PriceLabel')}
                  </p>
                ) : (
                  /* Trial-framing przez współdzieloną molekułę — parytet
                     z głównym /pricing gwarantowany strukturalnie. Studios nie
                     ma tieru Free, więc lede zawsze = trialLede. */
                  <PlanTrialFramingMolecule
                    ledeText={t('pricingPreview.trialLede')}
                    renderAfter={
                      price !== null && price > 0
                        ? amount =>
                            t.rich('pricingPreview.trialPriceAfter', {
                              price: groszToPln(price),
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
                rowCount={featureRowCount}
                leadingSpacerRows={STUDIO_FEATURE_ROW_OFFSETS[tier.id] ?? 0}
                items={tier.featureKeys.map(f => ({
                  id: f.key,
                  content: t(
                    f.key,
                    f.count != null ? { count: f.count } : undefined
                  ),
                }))}
              />
              {/* Per-plan CTA (głos ownera S44): mini-cennik domyka konwersję OD
                  RAZU. Paid → primary login→pay funnel (ten sam co /pricing,
                  billingPeriod='year'); Scale/kontakt → /contact (outlined,
                  jakościowo inna, niższo-intencyjna akcja „porozmawiajmy"). */}
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
