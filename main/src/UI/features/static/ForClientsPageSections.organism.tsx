import { SectionOrnamentMolecule } from '../../components/SectionOrnament/SectionOrnament.molecule';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import {
  CheckCircleIcon,
  CreditCardIcon,
  ArrowCounterClockwiseIcon,
  ShieldCheckIcon,
  ImagesIcon,
  EyeSlashIcon,
  type Icon,
} from '@phosphor-icons/react';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { TrustSignalsMolecule } from '../../components/TrustSignals/TrustSignals.molecule';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { SectionComposition } from '../../components/Section/Section.composition';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import {
  BENEFITS,
  VISIT_MOMENTS,
  CLIENT_FAQ,
  PRIVACY_ITEMS,
  DISCOVERY_TILES,
} from './ForClientsPageData';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { LP_ASSETS } from '../../assets/lpAssets';
import styles from './ForClientsPage.module.css';

/* ─── 1b. DISCOVERY — real inspiration samples ─── */
export function ForClientsDiscoverySectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    <SectionComposition
      className={styles.discoverySection}
      innerClassName={styles.discoveryInner}>
      <header className={styles.discoveryHeader}>
        <SectionOrnamentMolecule src={LP_ASSETS.decor.nailOutline}>
          <h2 className={styles.discoveryHeadline}>
            {t('discovery.headline')}
          </h2>
          <p className={styles.discoveryLede}>{t('discovery.lede')}</p>
        </SectionOrnamentMolecule>
      </header>
      <div className={styles.discoveryGrid} aria-hidden='true'>
        {DISCOVERY_TILES.map((tile, index) => (
          <figure
            key={tile.src}
            className={styles.discoveryTile}
            data-featured={index === 0 ? 'true' : undefined}>
            <Image
              quality={95}
              className={styles.discoveryTileImage}
              src={tile.src}
              alt=''
              fill
              sizes='(max-width: 767px) 50vw, 24vw'
            />
            <figcaption className={styles.discoveryTileLabel}>
              {t(tile.labelKey)}
            </figcaption>
          </figure>
        ))}
      </div>
    </SectionComposition>
  );
}

export function ForClientsVisitMomentsSectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    <SectionComposition
      id='visitMoments'
      className={styles.visitMomentsSection}
      bordered>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        title={t('visitMoments.headline')}>
        {t('visitMoments.lede')}
      </SectionHeaderMolecule>
      <ProcessIllustrationMolecule
        src={LP_ASSETS.process.clientBeforeVisit}
        alt={t('visitMoments.processAlt')}
        className={styles.processIllustration}
      />
      <div className={styles.visitMomentsLayout}>
        <div className={styles.visitMomentsGrid}>
          {VISIT_MOMENTS.map((moment, index) => (
            <article
              key={moment.id}
              className={styles.visitMoment}
              data-featured={index === 1 ? 'true' : undefined}>
              <span
                className={styles.visitMomentNumeral}
                data-num={String(index + 1).padStart(2, '0')}
                aria-hidden='true'
              />
              <div className={styles.visitMomentContent}>
                <h3 className={styles.visitMomentTitle}>
                  {t(moment.titleKey)}
                </h3>
                <p className={styles.visitMomentBody}>{t(moment.bodyKey)}</p>
              </div>
            </article>
          ))}
        </div>
        <figure className={styles.visitMomentPhoto}>
          <Image
            quality={95}
            className={styles.visitMomentPhotoImage}
            src={LP_ASSETS.editorial.staticClientPhoneCafe06}
            alt={t('visitMoments.photoAlt')}
            width={1024}
            height={1536}
            sizes='(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) 512px, 480px'
          />
        </figure>
      </div>
      <p className={styles.visitMomentsFootnote}>{t('how.footnote')}</p>
    </SectionComposition>
  );
}

/* ─── 3. BENEFITS: split 7/5, benefit list on the left, a large sticky PhoneMockup on the
 * right (proof beside the promise; owner vote).
 *
 * DECISION: benefit items do NOT migrate to FeatureCardMolecule/FeatureCardGridMolecule.
 * This is a bordered document list with row separators, not a card grid; the highlighted
 * colour-block row and the boxed `.benefitDetail` have no FeatureCard equivalent, and
 * FeatureCardGrid would replace the 7/5 split with the sticky phone. ─── */
export function ForClientsBenefitsSectionOrganism() {
  const t = useTranslations('static.forClients');
  const appScreen = useAppScreenshots();

  return (
    /* Band = Section. constrained={false}: dzieci same trzymają szerokości
       (header/grid z lp-override, footnote na gutter-edge — stan 1:1). */
    <SectionComposition
      bordered
      className={styles.benefitsSection}
      constrained={false}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        title={t('benefits.headline')}>
        {t('benefits.lede')}
      </SectionHeaderMolecule>

      <div className={styles.benefitsGrid}>
        {/* Benefits are parallel features, not a sequence, so no numerals.
            Numerals stay on real sequences such as visit moments. */}
        <div className={styles.benefitsList}>
          {BENEFITS.map(b => (
            <article
              key={b.n}
              className={styles.benefit}
              data-highlight={b.highlight || undefined}
              data-scroll-reveal>
              <div className={styles.benefitContent}>
                <h3 className={styles.benefitTitle}>{t(b.titleKey)}</h3>
                <p className={styles.benefitText}>{t(b.bodyKey)}</p>
                {b.detailKey && (
                  <p className={styles.benefitDetail}>{t(b.detailKey)}</p>
                )}
              </div>
            </article>
          ))}
        </div>

        {/* PhoneMockup — real stylist-gallery screen ("po sparowaniu widzisz
            galerię swojej stylistki"); caption lives in aria only (kanon). */}
        <div className={styles.benefitsPhoneCol}>
          <PhoneMockupMolecule
            label={t('benefits.mockup1Label')}
            route='/stylist/ola-nails'
            size='lg'
            screenshot={appScreen('appPublicProfile')}
          />
        </div>
      </div>

      <p className={styles.benefitsFootnote}>{t('benefits.footnote')}</p>
    </SectionComposition>
  );
}

/* Portfolio strip lives in ForClientsPortfolioStrip.tsx (max-lines 300). */

/* ─── 4. MID-FUNNEL CTA — closed ink rectangle (InkPanel, taste-14 kanon):
 * pull-quote left + CTA cluster right, same content as the former
 * full-bleed split band. ─── */
/* Trust uses TrustSignals variant='chips'. Bordered pills live in the
 * molecule. The per-page .trustList copy was removed. */
const TRUST_ITEMS = [
  { ChipIcon: CheckCircleIcon, textKey: 'trust.item1' },
  { ChipIcon: CreditCardIcon, textKey: 'trust.item2' },
  { ChipIcon: ArrowCounterClockwiseIcon, textKey: 'trust.item3' },
  { ChipIcon: ShieldCheckIcon, textKey: 'trust.item4' },
  { ChipIcon: ImagesIcon, textKey: 'trust.item5' },
  { ChipIcon: EyeSlashIcon, textKey: 'trust.item6' },
] as const satisfies ReadonlyArray<{ ChipIcon: Icon; textKey: string }>;

export function ForClientsTrustSectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    <section className={styles.trustSection}>
      <div className={styles.trustInner}>
        {/* Wrapper lewej kolumny OBOWIĄZKOWY (wzór .v2cLeft z playgroundu):
            keeps the headline and lede together beside the trust-signal chips. */}
        <div className={styles.trustLeft}>
          {/* The existing rich-text key keeps its words without accent styling. */}
          <h2 className={styles.trustHeadline}>
            {t.rich('trust.headline', {
              accent: chunks => <>{chunks}</>,
            })}
          </h2>
          <p className={styles.trustLede}>{t('trust.lede')}</p>
        </div>
        <TrustSignalsMolecule
          variant='chips'
          items={TRUST_ITEMS.map(({ ChipIcon, textKey }) => ({
            icon: <ChipIcon size={16} weight='regular' />,
            text: t(textKey),
          }))}
        />
      </div>
    </section>
  );
}

/* ─── 6. PRIVACY mini-section ─── */
export function ForClientsPrivacySectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    /* Band = Section (bordered: para hairline 1:1); grid = innerClassName
       (max-width/centrowanie daje Section.constrained). */
    <SectionComposition
      bordered
      className={styles.privacy}
      innerClassName={styles.privacyInner}>
      <div className={styles.privacyHead}>
        <h2 className={styles.privacyHeadline}>{t('privacy.headline')}</h2>
        <p className={styles.privacyLede}>{t('privacy.lede')}</p>
      </div>
      <ul className={styles.privacyList}>
        {PRIVACY_ITEMS.map(item => (
          <li key={item.id}>{t(item.textKey)}</li>
        ))}
      </ul>
      <ProcessIllustrationMolecule
        src={LP_ASSETS.contextual.clients}
        alt={t('pageIllustrationAlt')}
        width={1536}
        height={1024}
        sizes='(max-width: 859px) calc(100vw - 32px), 768px'
        className={styles.privacyIllustration}
      />
    </SectionComposition>
  );
}

/* ─── 7. FAQ — canonical <FaqSection> molecule (skin lives in the
 * component; the page keeps only the full-bleed band + content width). ─── */
export function ForClientsFaqSectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    /* Band = Section (as='div': FaqSection sam renderuje <section>);
       inner constrained przejął rolę skasowanej .faqInner (lp+auto). */
    <SectionComposition as='div' className={styles.faqSection}>
      <FaqSectionMolecule
        title={t('faq.headline')}
        idPrefix='clients-faq'
        items={CLIENT_FAQ.map((item, idx) => ({
          id: item.id,
          question: t(item.questionKey),
          answer: t(item.answerKey),
          defaultOpen: idx === 0,
        }))}
      />
    </SectionComposition>
  );
}
