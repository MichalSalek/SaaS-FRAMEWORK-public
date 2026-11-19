import { KeepTogetherTextAtom } from '../../components/KeepTogetherText/KeepTogetherText.atom';
import { SectionOrnamentMolecule } from '../../components/SectionOrnament/SectionOrnament.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import {
  CheckCircleIcon,
  ArrowCounterClockwiseIcon,
  ShieldCheckIcon,
  type Icon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { MidPageCtaMolecule } from '../../components/MidPageCta/MidPageCta.molecule';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import {
  GetAppHeroOrganism,
  GET_APP_STORES_ANCHOR_ID,
} from './GetAppHero.organism';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { ReviewsSectionOrganism } from '../shared/reviews/ReviewsSection.organism';
import { SessionPickDemoOrganism } from '../shared/lpScenes/SessionPickDemo.organism';
import { GetAppQrMolecule } from './GetAppQr.molecule';
import { GET_APP_REVIEWS } from '../shared/reviews/ReviewsData';
import { FEATURE_GROUPS, GET_APP_FAQ } from './GetAppPageFeatures';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { SectionComposition } from '../../components/Section/Section.composition';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { StepsSectionOrganism } from '../../components/StepsSection/StepsSection.organism';
import { InkPanelAtom } from '../../components/InkPanel/InkPanel.atom';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { useAppEntryMode } from '../../shared/hooks/useAppEntryMode';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { useFreeSignupCta } from '../../shared/hooks/usePricingFunnelState';
import styles from './GetAppPage.module.css';
import {
  trackCtaClick,
  withCtaTracking,
  withSignupTracking,
} from '../../../application/analytics/cta-events';

/* ─── FAQ data: GET_APP_FAQ lives in GetAppPageFeatures (like OBJECTION_FAQ /
   PRICING_FAQ). The same set of pairs feeds the FAQPage JSON-LD in pages/get-app.tsx
   (q1-q8), so render and schema stay consistent. ─── */

/* ─── Trust facts: variant B (icons 1:1 from the playground) ─── */
const TRUST_FACTS = [
  { TIcon: CheckCircleIcon, textKey: 'trust.item1' },
  { TIcon: ArrowCounterClockwiseIcon, textKey: 'trust.item2' },
  { TIcon: CheckCircleIcon, textKey: 'trust.item3' },
  { TIcon: ShieldCheckIcon, textKey: 'trust.item4' },
] as const satisfies ReadonlyArray<{ TIcon: Icon; textKey: string }>;

/* ─── GetAppPage ─── */

/**
 * Landing page for visitors redirected from /app/* on PREVIEW/PRODUCTION.
 * Desktop visitors get a browser sign-up action and a QR code for opening
 * Nailfolio on a phone.
 */
export function GetAppPageComposition() {
  const showStickyCta = useShowOnScroll();
  const t = useTranslations('static.getApp');
  const appScreen = useAppScreenshots();
  // DECISION: static.getApp.faq holds only q/a pairs, so the FAQ heading borrows
  // account.pay.faq.eyebrow, the only generic FAQ heading in all locales
  // (pages.home.faq.headline is home-specific in en/de). The namespace is in this
  // page's contract in application/i18n/page-messages.config.ts.
  const tFaqHeading = useTranslations('account.pay.faq');
  const tNav = useTranslations('nav');
  // On desktop in 'get-app' mode, secondary CTAs return to the hero where the
  // QR code and browser sign-up action live. Visitors in 'app' mode can start
  // registration directly from those CTAs.
  // DECISION: these CTAs scroll to the very top of the page, not to the QR block, so
  // the whole hero message is in view; an anchor on the action block cut the
  // headline under the header bar. (owner)
  const mode = useAppEntryMode();

  // Free-first (owner): clears a lingering plan intent from pricing.
  const goToLogin = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register`
  );

  const scrollToHero = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFunnelCta = mode === 'app' ? goToLogin : scrollToHero;
  // In 'app' mode the same button starts registration, so it counts as
  // `signup_started` (parity with ForClients); without it signups from /get-app
  // produced `signup_completed` with no matching start.
  const trackFunnelCta = mode === 'app' ? withSignupTracking : withCtaTracking;

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO: GetAppHero (shared with /app/home;
          see the DECISION in GetAppHero.organism.tsx). Canonical LpHero (owner
          vote, B+C fusion): a collage of two phones (gallery + conversation, editorial
          offset) + store buttons UNDER the product („pobranie mieszka przy
          produkcie"). The buttons wrapper is the scroll anchor of the funnel CTA in
          'get-app' mode. ─── */}
        {/* Owner: the main action is in the FIRST view. The hero had
            no button at all; the only CTA sat at the bottom of a 9500 px page. */}
        {/* The hero button ALWAYS starts sign-up in this browser (web-login-first
            covers this page too), and on a computer a QR code above it opens
            Nailfolio on the phone. Scrolling every button to the store notes would
            leave a dead end. The other buttons in 'get-app' mode scroll to the top
            of the page (the DECISION above). */}
        <GetAppHeroOrganism
          headingId='getapp-hero-heading'
          actions={
            <div id={GET_APP_STORES_ANCHOR_ID} className={styles.heroActions}>
              <GetAppQrMolecule />
              <ButtonAtom
                direction='forward'
                variant='primary'
                size='lg'
                onClick={withSignupTracking('get-app-hero', goToLogin)}>
                {t('finalCta.cta')}
              </ButtonAtom>
            </div>
          }
        />

        {}
        <SectionComposition aria-labelledby='getapp-demo-heading'>
          <div className={styles.demoColumn}>
            <SectionHeaderMolecule
              className={styles.demoHeader}
              title={t('demo.headline')}
              titleId='getapp-demo-heading'>
              {t('demo.lede')}
            </SectionHeaderMolecule>
            <SessionPickDemoOrganism />
            <p className={styles.demoResponse}>{t('demo.response')}</p>
            <div className={styles.demoAction}>
              <ButtonAtom
                direction='forward'
                variant='primary'
                size='lg'
                onClick={trackFunnelCta('get-app-demo', handleFunnelCta)}>
                {mode === 'app' ? t('finalCta.cta') : tNav('getApp')}
              </ButtonAtom>
            </div>
          </div>
        </SectionComposition>

        {/* ─── 2. FEATURES: variant B, split: a vertical list of 6
          features as hairline rows with an icon in the left rail + a large sticky
          screen of the real gallery (proof instead of decoration). There is no small
          label above the heading (owner: „to jest AI slop”).
          Band (tint + hairline frame + breakout + container)
          = Section tone='subtle'. ─── */}
        <SectionComposition
          tone='subtle'
          className={styles.featuresSection}
          aria-labelledby='getapp-features-heading'>
          <SectionHeaderMolecule
            className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
            title={t('features.headline')}
            titleId='getapp-features-heading'>
            {t('features.lede')}
          </SectionHeaderMolecule>

          <div className={styles.featuresGrid}>
            <div className={styles.featuresList}>
              {FEATURE_GROUPS.map(group => (
                <div
                  className={styles.featureGroup}
                  key={group.headingKey}
                  role='group'
                  aria-labelledby={group.headingId}>
                  <h3
                    id={group.headingId}
                    className={styles.featureGroupHeading}>
                    {t(group.headingKey)}
                  </h3>
                  <div className={styles.featureGroupRows}>
                    {group.entries.map(f => (
                      <article key={f.titleKey} className={styles.feature}>
                        <span className={styles.featureIcon} aria-hidden='true'>
                          {f.icon}
                        </span>
                        <div className={styles.featureContent}>
                          <h4 className={styles.featureTitle}>
                            {t(f.titleKey)}
                          </h4>
                          <p className={styles.featureText}>
                            <KeepTogetherTextAtom>
                              {t(f.bodyKey)}
                            </KeepTogetherTextAtom>
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.featuresPhoneCol}>
              <PhoneMockupMolecule
                label={t('features.mockupLabel')}
                route='/app/gallery'
                size='xl'
                /* Default gallery view: one photo across the full width. The home
                   page shows tiles, so the screenshots do not repeat the same
                   frame (owner). */
                screenshot={appScreen('appGalleryWide')}
              />
            </div>
          </div>
        </SectionComposition>

        {/* ─── HOW: 3-step onboarding. Band (breakout
          + container) = Section; bg-main + separator border-top (deliberately
          single: it closes the tint band of features above, NOT a frame) stay
          page-side in .howSection. ─── */}
        <SectionComposition
          className={styles.howSection}
          innerClassName={styles.howInner}
          aria-labelledby='getapp-how-heading'>
          <SectionOrnamentMolecule src={LP_ASSETS.decor.womanPhoneOutline}>
            <h2 id='getapp-how-heading' className={styles.howHeadline}>
              {t('how.headline')}
            </h2>
          </SectionOrnamentMolecule>
          <p className={styles.howLede}>{t('how.lede')}</p>
          {/* Canonical step sequence: this page was the scale canon
            (NumberMarker sm), near 1:1 parity with the former .howSteps. */}
          <StepsSectionOrganism
            variant='list'
            surface='card'
            steps={[
              { title: t('how.step1Title'), body: t('how.step1Body') },
              { title: t('how.step2Title'), body: t('how.step2Body') },
              { title: t('how.step3Title'), body: t('how.step3Body') },
            ]}
          />
          <ProcessIllustrationMolecule
            src={LP_ASSETS.contextual.getApp}
            alt={t('pageIllustrationAlt')}
            width={1600}
            height={800}
            sizes='(max-width: 768px) 100vw, 960px'
            className={styles.contextualIllustration}
          />
        </SectionComposition>

        {/* ─── Mid-page CTA band (owner). This page is the
            second entry after the home page (ChatGPT traffic, phone),
            and the button stood only in the hero and at the very end. ─── */}
        <MidPageCtaMolecule
          headline={t('midCta.headline')}
          headlineAccent={t('midCta.accent')}
          action={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={trackFunnelCta('get-app-mid', handleFunnelCta)}>
              {mode === 'app' ? t('finalCta.cta') : tNav('getApp')}
            </ButtonAtom>
          }
        />

        {/* ─── SOCIAL PROOF — beta reviews ─── */}
        <ReviewsSectionOrganism
          reviews={GET_APP_REVIEWS}
          headlineKey='getAppHeadline'
          heroReviewId='sMemory'
        />

        {/* ─── 3. TRUST: variant B: a closed ink card (InkPanel)
          with 4 facts in a 2x2 grid; the panel is narrow and low, so it does not make
          a wall next to the page's gold finalCta. Band (breakout + default rhythm
          + container) = Section; the explicit bg-main stays in .trustSection. ─── */}
        <SectionComposition
          tone='white'
          className={styles.trustSection}
          innerClassName={styles.trustInner}
          /* The small label above the panel is gone (owner: „to jest AI
             slop”); its text stays as the region name for screen readers. */
          aria-label={t('trust.eyebrow')}>
          <div className={styles.trustPanelWrap}>
            <InkPanelAtom tone='ink' className={styles.trustPanel}>
              {/* trustGrid is page-local, NOT the TrustSignals grid; see the DECISION in
                  GetAppPage.module.css (.trustGrid): the canon renders light cards
                  unreadable on the ink panel, and an override loses on specificity. */}
              <ul className={styles.trustGrid}>
                {TRUST_FACTS.map(({ TIcon, textKey }) => (
                  <li key={textKey} className={styles.trustFact}>
                    <TIcon size={20} weight='regular' />
                    <span>{t(textKey)}</span>
                  </li>
                ))}
              </ul>
            </InkPanelAtom>
          </div>
        </SectionComposition>

        {/* ─── 3b. FAQ: canonical FaqSection (pairs q1-q8 also feed the FAQPage
          JSON-LD); band (tint + hairline frame + breakout + container) =
          Section tone='subtle', as='div' because FaqSection renders
          <section aria-labelledby> itself. The title in the .faqTitleScale span =
          scale parity with the other section headings of the page.
          DECISION: the title is a <span>, not a <SectionHeader>: FaqSection renders
          its own <h2> (headingId), so a wrapping heading would duplicate it in the
          aria-labelledby outline. .faqTitleScale only matches the section heading
          scale. ─── */}
        <SectionComposition bordered as='div' className={styles.faqSection}>
          <FaqSectionMolecule
            title={
              <span className={styles.faqTitleScale}>
                {tFaqHeading('eyebrow')}
              </span>
            }
            headingId='getapp-faq-heading'
            idPrefix='getapp-faq'
            items={GET_APP_FAQ.map(item => ({
              id: item.questionKey,
              question: t(item.questionKey),
              answer: t(item.answerKey),
            }))}
          />
        </SectionComposition>

        {/* ─── 4. FINAL CTA: shared FinalCtaBand ─── */}
        <FinalCtaBandOrganism
          headlineLine1={t('finalCta.headlineLine1')}
          headlineAccent={t('finalCta.headlineAccent')}
          body={t('finalCta.body')}
          actions={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={trackFunnelCta('get-app-final', handleFunnelCta)}>
              {mode === 'app' ? t('finalCta.cta') : tNav('getApp')}
            </ButtonAtom>
          }
          /* Clean-context readers looked for the price before giving an e-mail
             and found no way to it outside the footer: the second link under the
             button leads to pricing. The page for stylists is in the menu. */
          secondary={
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.PRICING}
              onClick={() => trackCtaClick('get-app-pricing-link')}>
              {t('finalCta.secondaryPricing')}
            </AppParagraphLinkAtom>
          }
          footnote={t('finalCta.reassurance')}
        />

        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={mode === 'app' ? t('stickyCta.button') : tNav('getApp')}
          onButtonClick={trackFunnelCta('get-app-sticky', handleFunnelCta)}
        />
      </div>
    </PublicLayoutComposition>
  );
}
