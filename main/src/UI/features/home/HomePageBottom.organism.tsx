import { SectionOrnamentMolecule } from '../../components/SectionOrnament/SectionOrnament.molecule';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import clsx from 'clsx';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { HomeMidCtaOrganism } from './HomeMidCta.organism';
import { SectionComposition } from '../../components/Section/Section.composition';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { FAQ_ITEMS, FIT_ITEMS } from './homePageData';
import { HomePageLeadCollectorOrganism } from './HomePageLeadCollector.organism';
import { TrustStatsSectionOrganism } from '../../components/TrustStatsSection/TrustStatsSection.organism';
import {
  PhotoFinaleCtaAccent,
  PhotoFinaleCtaOrganism,
} from '../../components/PhotoFinaleCta/PhotoFinaleCta.organism';
import { ReviewsSectionOrganism } from '../shared/reviews/ReviewsSection.organism';
import { HOME_REVIEWS } from '../shared/reviews/ReviewsData';
import { LP_ASSETS } from '../../assets/lpAssets';
import styles from './HomePage.module.css';

interface HomePageBottomProps {
  onLoginClick: () => void;
}

/* 2+1 emphasis: Instagram + Booksy as context rows, Nailfolio as the hero in a
 * closed frame. phoneRoll is outside the composition; the variant sets the
 * competing tools side by side. */
const [FIT_INSTAGRAM, , FIT_BOOKSY, FIT_NAILFOLIO] = FIT_ITEMS;
const FIT_CONTEXT_DUO = [FIT_INSTAGRAM, FIT_BOOKSY] as const;

/* The tool name = the first word of the existing titleKey („Instagram buduje
 * zasięg" gives the name „Instagram" + the rest as a serif aside). No new i18n keys. */
function splitToolTitle(title: string): { name: string; rest: string } {
  const spaceIdx = title.indexOf(' ');
  if (spaceIdx === -1) {
    return { name: title, rest: '' };
  }
  return { name: title.slice(0, spaceIdx), rest: title.slice(spaceIdx + 1) };
}

export function HomePageBottomOrganism({ onLoginClick }: HomePageBottomProps) {
  const t = useTranslations('pages.home');
  const nailfolioTitle = splitToolTitle(t(FIT_NAILFOLIO.titleKey));
  return (
    <>
      {/* ─── 4. TRUST: through the canonical molecule TrustStatsSection (the same
          section also lives on for-stylists; the visual is in the component,
          the page gives only content). ─── */}
      <TrustStatsSectionOrganism
        ariaLabel={t('trust.eyebrow')}
        body={t('trust.body')}
        benefitExamples={[1, 2, 3].map(index => ({
          title: t(`trust.useCase${index}Title`),
          body: t(`trust.useCase${index}Body`),
        }))}
      />

      {/* ─── 5. FIT: 2+1 emphasis (context in rows, Nailfolio in a closed
          frame with compareLink) ─── */}
      <SectionComposition
        className={styles.fitSection}
        aria-labelledby='fit-heading'>
        <SectionOrnamentMolecule
          src={LP_ASSETS.decor.homeFinale}
          className={styles.fitHeadingOrnament}>
          <SectionHeaderMolecule
            className={styles.sectionHeaderScaled}
            title={t('fit.headline')}
            titleId='fit-heading'>
            {t('fit.lede')}
          </SectionHeaderMolecule>
        </SectionOrnamentMolecule>
        <ProcessIllustrationMolecule
          src={LP_ASSETS.contextual.home}
          alt={t('pageIllustrationAlt')}
          width={1600}
          height={800}
          sizes='(max-width: 768px) 100vw, 960px'
          className={styles.contextualIllustration}
        />
        <div className={styles.fitGrid}>
          <div className={styles.fitRows}>
            {FIT_CONTEXT_DUO.map(item => (
              <article key={item.id} className={styles.fitRow}>
                <h3 className={styles.fitRowTitle}>{t(item.titleKey)}</h3>
                <div className={styles.fitRowText}>
                  <p className={styles.fitBody}>{t(item.bodyKey)}</p>
                  <p className={styles.fitProof}>{t(item.proofKey)}</p>
                </div>
              </article>
            ))}
          </div>
          <article className={styles.fitFrame}>
            <h3 className={styles.fitFrameName}>{nailfolioTitle.name}</h3>
            {nailfolioTitle.rest !== '' && (
              <p className={styles.fitFrameSub}>{nailfolioTitle.rest}</p>
            )}
            <p className={styles.fitBody}>{t(FIT_NAILFOLIO.bodyKey)}</p>
            <div className={styles.fitFrameFoot}>
              <span className={styles.fitFrameDivider} aria-hidden='true' />
              <p className={styles.fitProofStrong}>
                {t(FIT_NAILFOLIO.proofKey)}
              </p>
              <AppParagraphLinkAtom
                href={ROUTES_FRONT.COMPARE}
                className={styles.fitCompareLink}>
                {t('fit.compareLink')}
              </AppParagraphLinkAtom>
            </div>
          </article>
        </div>
      </SectionComposition>

      {/* ─── 6. SOCIAL PROOF — beta reviews ─── */}
      <ReviewsSectionOrganism
        reviews={HOME_REVIEWS}
        headlineKey='homeHeadline'
      />

      {/* ─── Mid-CTA after the reviews: the ask follows the proof, and the white CTA
          band does not touch the white „fit” section. ─── */}
      <HomeMidCtaOrganism
        headline={t('midCta.fitHeadline')}
        accent={t('midCta.fitAccent')}
        cta={t('midCta.fitCta')}
        onAction={onLoginClick}
      />

      {/* ─── 7. LEAD COLLECTOR — soft email capture (ink-violet band).
          Sits before FAQ so the tail narrows to a single hard CTA:
          faq → clientStrip → finalCta. ─── */}
      <HomePageLeadCollectorOrganism />

      {/* ─── 8. FAQ — objection handling ─── */}
      {/* constrained=false: the narrow column (--content-narrow) from .faqInner
          instead of the canonical --lp-content-width (a caesura before the tail). */}
      {/* as='div': <FaqSection> itself renders the only <section> landmark
          (aria-labelledby='faq-heading'), so the band does not duplicate the section;
          same as ForStudiosFaqSection. */}
      <SectionComposition
        as='div'
        className={styles.faqSection}
        constrained={false}
        innerClassName={styles.faqInner}>
        {/* The heading is rendered separately (outside <FaqSection>) to keep Home's
            signature scale (1.04 / 18ch) through a var override; FaqSection carries
            only the canonical accordion (the skin = the only LP FAQ pattern). */}
        <SectionHeaderMolecule
          className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
          title={t('faq.headline')}
          titleId='faq-heading'
        />
        <FaqSectionMolecule
          headingId='faq-heading'
          idPrefix='home-faq'
          items={FAQ_ITEMS.map(item => ({
            id: item.id,
            question: t(item.questionKey),
            answer: t(item.answerKey),
          }))}
        />
      </SectionComposition>

      {/* ─── 9. CLIENT PATH — subordinate cross-persona band (tonal) ─── */}
      <SectionComposition
        bordered
        className={styles.clientStrip}
        innerClassName={styles.clientStripInner}
        aria-label={t('clientStrip.ariaLabel')}>
        <div className={styles.clientStripPhotoFrame}>
          <Image
            className={styles.clientStripPhoto}
            src={LP_ASSETS.cta.beautyNailsClientsCta03Hands}
            alt={t('clientStrip.photoAlt')}
            fill
            sizes='(max-width: 767px) 100vw, 34vw'
          />
        </div>
        <div className={styles.clientStripText}>
          <h3 className={styles.clientStripHeadline}>
            {t('clientStrip.headline')}
          </h3>
          <p className={styles.clientStripBody}>{t('clientStrip.body')}</p>
        </div>
        <AppParagraphLinkAtom
          href={ROUTES_FRONT.FOR_CLIENTS}
          className={styles.clientStripLink}>
          {t('clientStrip.learnMore')}
        </AppParagraphLinkAtom>
      </SectionComposition>

      {/* ─── 10. FINAL CTA ─── */}
      <PhotoFinaleCtaOrganism
        imageSide='left'
        imageSrc={LP_ASSETS.cta.beautyNailsHomeCta03RedSilk}
        headingId='final-cta-heading'
        heading={
          <>
            {t('finalCta.headlineLine1')}
            <br />
            <PhotoFinaleCtaAccent>
              {t('finalCta.headlineAccent')}
            </PhotoFinaleCtaAccent>
          </>
        }
        body={t('finalCta.body')}
        actions={
          <>
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={onLoginClick}>
              {t('hero.ctaPrimary')}
            </ButtonAtom>
            <AppParagraphLinkAtom href={ROUTES_FRONT.PRICING}>
              {t('finalCta.pricingLink')}
            </AppParagraphLinkAtom>
          </>
        }
        footnote={t('finalCta.reassurance')}
      />
    </>
  );
}
