import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  HeartIcon,
  EyeIcon,
  LightningIcon,
  ScissorsIcon,
  UsersThreeIcon,
  QuotesIcon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { FeatureCardMolecule } from '../../components/FeatureCard/FeatureCard.molecule';
import { FeatureCardGridMolecule } from '../../components/FeatureCard/FeatureCardGrid.molecule';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import { PhoneQuoteStripOrganism } from '../../components/PhoneQuoteStrip/PhoneQuoteStrip.organism';
import { SectionComposition } from '../../components/Section/Section.composition';
import { StatsBandMolecule } from '../../components/StatsBand/StatsBand.molecule';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { TrustProseMolecule } from '../../components/TrustProse/TrustProse.molecule';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { LP_ASSETS } from '../../assets/lpAssets';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import {
  AboutTimelineSectionOrganism,
  AboutFaqSectionOrganism,
} from './AboutPageSections.organism';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { useFreeSignupCta } from '../../shared/hooks/usePricingFunnelState';
import styles from './AboutPage.module.css';
import {
  trackCtaClick,
  withCtaTracking,
  withSignupTracking,
} from '../../../application/analytics/cta-events';

/* ─── Values config (icons only — text via i18n).
   No numbering and no wide card: the values are NOT a sequence (Style Policy §6),
   and equal cards in a grid are the owner's taste (equality = quality). ─── */
const VALUE_ITEMS: {
  icon: ReactNode;
  titleKey: string;
  bodyKey: string;
}[] = [
  {
    icon: <HeartIcon size={22} weight='regular' />,
    titleKey: 'values.v01Title',
    bodyKey: 'values.v01Body',
  },
  {
    icon: <EyeIcon size={22} weight='regular' />,
    titleKey: 'values.v02Title',
    bodyKey: 'values.v02Body',
  },
  {
    icon: <LightningIcon size={22} weight='regular' />,
    titleKey: 'values.v03Title',
    bodyKey: 'values.v03Body',
  },
];

export function AboutPageComposition() {
  const router = useRouter();
  const showStickyCta = useShowOnScroll();
  const t = useTranslations('static.about');
  const appScreen = useAppScreenshots();

  // DECISION: the stylist CTA is an account route, so it enters the web-login funnel on
  // every viewport with no /get-app bounce (parity with pricingFunnelHref; the bounce closed
  // the funnel on desktop). The client CTA stays on /get-app: her product is mobile (QR scan
  // in the salon). useFreeSignupCta clears a stale plan intent from an earlier pricing
  // visit, or a generic signup from here would land on the payment step. (owner)
  const handleLoginNavigate = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register&role=stylist`
  );

  const handleClientNavigate = () => {
    void router.push(ROUTES_FRONT.GET_APP);
  };

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO ─── */}
        <LpHeroOrganism
          headline={t('hero.headlineLine1')}
          headlineAccent={t('hero.headlineAccent')}
          lede={t('hero.lede')}
          media={
            <div className={styles.heroImage}>
              <Image
                src={LP_ASSETS.editorial.staticSalonEntrance01}
                alt={t('hero.imageAlt')}
                fill
                style={{ objectFit: 'cover' }}
                sizes='(max-width: 767px) 100vw, 40vw'
                priority
              />
            </div>
          }
        />

        {/* ─── 2. MISSION — editorial pull-quote. ─── */}
        <SectionComposition tone='white' className={styles.missionSection}>
          {/* The manifesto as a closed ink card (taste „negative
              = a closed rectangle”), the section clean: the dull half-tint +
              tint-box removed (taste „either clean or a full negative”). */}
          <div className={styles.missionContent}>
            <div className={styles.missionCard}>
              <p className={styles.missionPullQuote}>
                {t('mission.pullQuote')}
              </p>
            </div>
            <p className={styles.missionText}>{t('mission.text')}</p>
          </div>
        </SectionComposition>

        {/* ─── STATS — citable facts inline, dead-i18n activation ─── */}
        <SectionComposition
          bordered
          className={styles.statsSection}
          innerClassName={styles.statsInner}
          aria-labelledby='about-stats-heading'>
          <SectionHeaderMolecule
            className={styles.statsHeader}
            title={t('stats.headline')}
            titleId='about-stats-heading'
          />
          {/* Plain-row canon (StatsBand): this page was the source of the pattern. */}
          <StatsBandMolecule
            variant='plain-row'
            items={[
              { figure: t('stats.stat1Figure'), label: t('stats.stat1Label') },
              { figure: t('stats.stat2Figure'), label: t('stats.stat2Label') },
              { figure: t('stats.stat3Figure'), label: t('stats.stat3Label') },
            ]}
          />
          <p className={styles.statsNote}>{t('stats.note')}</p>
        </SectionComposition>

        {/* ─── 3. STORY — editorial paragraphs with dropcap + a photo bank
          (the client's and the stylist's hands) in a closed rounded frame,
          filling the right half of the grid on desktop. ─── */}
        <SectionComposition className={styles.storySection}>
          <SectionHeaderMolecule
            className={styles.accentHeader}
            title={t('story.headline')}
          />

          <div className={styles.storyLayout}>
            <div className={styles.storyParagraphs}>
              <p className={`${styles.storyText} ${styles.storyTextLead}`}>
                {t('story.p1')}
              </p>
              <blockquote className={styles.storyQuote}>
                <QuotesIcon
                  size={20}
                  weight='fill'
                  className={styles.storyQuoteIcon}
                  aria-hidden='true'
                />
                {t('story.quote')}
              </blockquote>
              <p className={styles.storyText}>{t('story.p2')}</p>
              <p className={styles.storyText}>{t('story.p3')}</p>
            </div>
            <div className={styles.storyImage}>
              <Image
                src={LP_ASSETS.cta.beautyDiv04HandsJewelry}
                alt={t('story.photoAlt')}
                fill
                style={{ objectFit: 'cover' }}
                sizes='(max-width: 1023px) 100vw, 40vw'
              />
            </div>
          </div>
        </SectionComposition>

        {/* ─── 4. VALUES — equal value cards (no numbering) ─── */}
        <SectionComposition className={styles.valuesSection}>
          <SectionHeaderMolecule
            className={styles.accentHeader}
            title={t('values.headline')}>
            {t('values.lede')}
          </SectionHeaderMolecule>

          <FeatureCardGridMolecule columns={3} className={styles.valuesList}>
            {VALUE_ITEMS.map(v => (
              <FeatureCardMolecule
                key={v.titleKey}
                icon={v.icon}
                title={t(v.titleKey)}
                body={t(v.bodyKey)}
              />
            ))}
          </FeatureCardGridMolecule>
        </SectionComposition>

        {/* ─── 5. TIMELINE — zamknięta ink-karta (InkPanel) ─── */}
        <AboutTimelineSectionOrganism />

        {/* ─── 5b. PROOF — PhoneQuoteStrip (owner): the human
          finale of the story, the product as its punchline. Form 1:1 from the playground;
          copy from i18n, the client view screen from LP_ASSETS. ─── */}
        <SectionComposition tone='white'>
          <PhoneQuoteStripOrganism
            phone={{
              label: t('phoneQuote.phoneLabel'),
              route: ROUTES_FRONT.APP,
              screenshot: appScreen('appClientHome'),
            }}
            quoteTitle={t.rich('phoneQuote.title', {
              em: chunks => <em>{chunks}</em>,
            })}
            quoteBody={t('phoneQuote.body')}
          />
        </SectionComposition>

        {/* ─── 7. TRUST — trust prose (owner, variant C):
          icon+bullet chips replaced by one editorial sentence in the --font-heading role
          with gold-italic accents (the TrustProse canon). ─── */}
        <SectionComposition
          className={styles.trustSection}
          innerClassName={styles.trustInner}
          aria-label={t('trust.eyebrow')}>
          <TrustProseMolecule
            sentence={t.rich('trust.trustProse', {
              em: chunks => <em>{chunks}</em>,
            })}
          />
        </SectionComposition>

        {/* ─── 7b. FAQ — accordion (pary q1-q5 zasilają też FAQPage JSON-LD) ─── */}
        <AboutFaqSectionOrganism />

        {/* ─── 8. FINAL CTA — split path: Stylist / Client; ink ─── */}
        <FinalCtaBandOrganism
          tone='ink'
          headlineLine1={t('finalCta.headlineLine1')}
          headlineAccent={t('finalCta.headlineAccent')}
          body={t('finalCta.body')}
          actions={
            <>
              <ButtonAtom
                variant='primary'
                size='lg'
                icon={<ScissorsIcon size={18} weight='regular' />}
                onClick={withSignupTracking(
                  'about-login',
                  handleLoginNavigate
                )}>
                {t('finalCta.ctaStylist')}
              </ButtonAtom>
              {/* Split-path ghost button: the page-specific class stays
                  (the specificity bump in the page module beats the molecule's
                  canonical .actions button). */}
              <ButtonAtom
                variant='outlined'
                size='lg'
                className={styles.finalCtaButtonAlt}
                icon={<UsersThreeIcon size={18} weight='regular' />}
                onClick={withCtaTracking('about-client', handleClientNavigate)}>
                {t('finalCta.ctaClient')}
              </ButtonAtom>
            </>
          }
          secondary={
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.PRICING}
              onClick={() => trackCtaClick('about-pricing-link')}>
              {t('finalCta.secondary')}
            </AppParagraphLinkAtom>
          }
          footnote={t('finalCta.reassurance')}
        />

        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={withSignupTracking(
            'about-sticky',
            handleLoginNavigate
          )}
        />
      </div>
    </PublicLayoutComposition>
  );
}
