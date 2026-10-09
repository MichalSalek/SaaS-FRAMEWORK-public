import { SectionOrnamentMolecule } from '../../components/SectionOrnament/SectionOrnament.molecule';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  CreditCardIcon,
  ArrowCounterClockwiseIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import clsx from 'clsx';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { HomeMidCtaOrganism } from './HomeMidCta.organism';
import { SectionComposition } from '../../components/Section/Section.composition';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
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

/* Głos 3B (2+1 wyróżnienie): Instagram + Booksy jako kontekst w wierszach,
 * Nailfolio jako bohater w zamkniętej ramie. phoneRoll poza kompozycją —
 * wariant zestawia narzędzia konkurencyjnego kontekstu. */
const [FIT_INSTAGRAM, , FIT_BOOKSY, FIT_NAILFOLIO] = FIT_ITEMS;
const FIT_CONTEXT_DUO = [FIT_INSTAGRAM, FIT_BOOKSY] as const;

/* Nazwa narzędzia = pierwszy wyraz istniejącego titleKey („Instagram buduje
 * zasięg" daje nazwę „Instagram" + resztę jako serif-dopowiedzenie).
 * Zero nowych kluczy i18n. */
function splitToolTitle(title: string): { name: string; rest: string } {
  const spaceIdx = title.indexOf(' ');
  if (spaceIdx === -1) {
    return { name: title, rest: '' };
  }
  return { name: title.slice(0, spaceIdx), rest: title.slice(spaceIdx + 1) };
}

export function HomePageBottomOrganism({ onLoginClick }: HomePageBottomProps) {
  const t = useTranslations('pages.home');
  const tNav = useTranslations('nav');
  const nailfolioTitle = splitToolTitle(t(FIT_NAILFOLIO.titleKey));
  return (
    <>
      {/* ─── 4. TRUST — głos 2C, od S24 przez kanoniczny molecule
          TrustStatsSection (ta sama sekcja żyje też na for-stylists —
          wizual w komponencie, strona daje tylko treść). ─── */}
      <TrustStatsSectionOrganism
        eyebrow={t('trust.eyebrow')}
        body={t('trust.body')}
        benefitExamples={[1, 2, 3].map(index => ({
          title: t(`trust.useCase${index}Title`),
          body: t(`trust.useCase${index}Body`),
        }))}
        badges={[
          {
            icon: (
              <CreditCardIcon size={16} weight='regular' aria-hidden='true' />
            ),
            text: t('trust.badge2'),
          },
          {
            icon: (
              <CheckCircleIcon size={16} weight='regular' aria-hidden='true' />
            ),
            text: t('trust.badge3'),
          },
          {
            icon: (
              <ArrowCounterClockwiseIcon
                size={16}
                weight='regular'
                aria-hidden='true'
              />
            ),
            text: t('hero.proof3'),
          },
        ]}
        badgesAriaLabel={t('trust.listAriaLabel')}
      />

      {/* ─── 5. FIT — głos 3B: 2+1 wyróżnienie (kontekst w wierszach,
          Nailfolio w zamkniętej ramie z compareLink) ─── */}
      <SectionComposition
        className={styles.fitSection}
        aria-labelledby='fit-heading'>
        <SectionOrnamentMolecule
          src={LP_ASSETS.decor.phoneGalleryOutline}
          className={styles.fitHeadingOrnament}>
          <SectionHeaderMolecule
            className={styles.sectionHeaderScaled}
            eyebrow={t('fit.eyebrow')}
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

      {/* ─── Mid-CTA po „fit" (S81 co drugą sekcję) ─── */}
      <HomeMidCtaOrganism
        headline={t('midCta.fitHeadline')}
        accent={t('midCta.fitAccent')}
        cta={t('midCta.fitCta')}
        onAction={onLoginClick}
      />

      {/* ─── 6. SOCIAL PROOF — beta reviews ─── */}
      <ReviewsSectionOrganism
        reviews={HOME_REVIEWS}
        headlineKey='homeHeadline'
      />

      {/* ─── 7. LEAD COLLECTOR — soft email capture (ink-violet band).
          Sits before FAQ so the tail narrows to a single hard CTA:
          faq → clientStrip → finalCta. ─── */}
      <HomePageLeadCollectorOrganism />

      {/* ─── 8. FAQ — objection handling ─── */}
      {/* constrained=false: wąska kolumna (--content-narrow) z .faqInner
          zamiast kanonicznego --lp-content-width (cezura przed ogonem). */}
      {/* as='div': <FaqSection> sam renderuje jedyny landmark <section>
          (aria-labelledby='faq-heading'), więc band nie dubluje sekcji —
          wzorzec ForStudiosFaqSection. */}
      <SectionComposition
        as='div'
        className={styles.faqSection}
        constrained={false}
        innerClassName={styles.faqInner}>
        {/* Nagłówek renderowany osobno (poza <FaqSection>), żeby zachować
            sygnaturową skalę Home (1.04 / 18ch) przez var-override; FaqSection
            niesie tylko kanoniczny akordeon (skórka = jedyny wzorzec FAQ LP). */}
        <SectionHeaderMolecule
          className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
          eyebrow={t('faq.eyebrow')}
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
          <EyebrowAtom as='p' variant='plain'>
            {tNav('forClients')}
          </EyebrowAtom>
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
