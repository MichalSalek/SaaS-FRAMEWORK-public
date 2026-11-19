import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { HomeShowcaseOrganism } from './HomeShowcase.organism';
import { HomeMidCtaOrganism } from './HomeMidCta.organism';
import { HomeHeroOrganism } from './HomeHero.organism';
import { HeroChatSceneMolecule } from '../shared/lpScenes/HeroAppScenes.molecule';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { GalleryFilterDemoOrganism } from '../shared/lpScenes/GalleryFilterDemo.organism';
import { SectionComposition } from '../../components/Section/Section.composition';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { useFreeSignupCta } from '../../shared/hooks/usePricingFunnelState';
import { useNativeEntryRedirectGuard } from '../../layouts/guards/useNativeEntryRedirectGuard';
import { BenefitVisualAtom } from './HomePageVisuals.atom';
import { STEPS, BENEFITS, PAIN_POINTS } from './homePageData';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { HomePageBottomOrganism } from './HomePageBottom.organism';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import styles from './HomePage.module.css';
import { withSignupTracking } from '../../../application/analytics/cta-events';
import { TimeValueSectionOrganism } from '../shared/timeValue/TimeValueSection.organism';

export function HomePageComposition() {
  const t = useTranslations('pages.home');
  const appScreen = useAppScreenshots();
  const showStickyCta = useShowOnScroll();

  // Cold native entry is coordinated above the page. This compatibility hook
  // does not redirect an intentional visit to the public home page.
  useNativeEntryRedirectGuard();

  // Demo entry clears stale paid-plan intent. The product remains paid; an
  // explicit tier choice takes its own checkout path after registration.
  // DECISION: the signup CTA is an ACCOUNT route (register -> onboarding), so it enters the
  // web-login funnel directly on EVERY viewport (desktop included), without the /get-app bounce
  // (that is for PRODUCT routes and closed the signup funnel on desktop). Parity with
  // pricingFunnelHref (web-login-first). After onboarding desktop lands on /app/home
  // (resolveDesktopBounceDecision), mobile/app on core /app.
  const goToLogin = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register`
  );

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO ─── */}
        <HomeHeroOrganism
          onSignup={withSignupTracking('home-hero', goToLogin)}
        />
        <TimeValueSectionOrganism id='home-time-value' />

        {/* ─── 1b. A gallery you can filter by touch (owner: „bardzo dobry pomysł”).
            It shows the function, lets people click through, and ends with a CTA
            saying to go further. The button under the gallery has the main CTA
            colour at his explicit request. The section stands on paper: the hero
            above it is a white band. ─── */}
        <SectionComposition aria-labelledby='demo-heading'>
          <SectionHeaderMolecule
            className={styles.sectionHeader}
            title={t('galleryDemo.headline')}
            titleId='demo-heading'>
            {t('galleryDemo.lede')}
          </SectionHeaderMolecule>
          <GalleryFilterDemoOrganism />
          <div className={styles.demoAction}>
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={withSignupTracking('home-demo', goToLogin)}>
              {t('galleryDemo.cta')}
            </ButtonAtom>
          </div>
        </SectionComposition>

        {/* ─── 1c. The conversation before a visit: the same story continued (the
            client picked designs, sends them and asks). Owner:
            „ten czacik jest genialny” (it explains more than the whole page and
            shows the app's process exactly), so add it to home. ─── */}
        <SectionComposition tone='white' aria-labelledby='chat-heading'>
          <div className={styles.chatSplit}>
            <div className={styles.chatSplitText}>
              <SectionHeaderMolecule
                title={t('chatDemo.headline')}
                titleId='chat-heading'>
                {t('chatDemo.lede')}
              </SectionHeaderMolecule>
              <ButtonAtom
                direction='forward'
                variant='outlined'
                size='lg'
                onClick={withSignupTracking('home-chat', goToLogin)}>
                {t('hero.ctaPrimary')}
              </ButtonAtom>
            </div>
            <HeroChatSceneMolecule surface='paper' />
          </div>
        </SectionComposition>

        {/* ─── 2. PAIN — emotional hook ─── */}
        <SectionComposition
          className={styles.painSection}
          innerClassName={styles.painInner}
          aria-label={t('pain.ariaLabel')}>
          {/* Ink band with a single-color heading and equal problem rows. */}
          <h2 className={styles.painStatement}>{t('pain.headline')}</h2>
          <p className={styles.painBody}>{t('pain.body')}</p>
          <ul className={styles.painList}>
            {PAIN_POINTS.map(point => (
              <li key={point.id} className={styles.painItem}>
                <span className={styles.painMarker} aria-hidden='true' />
                <span>{t(point.titleKey)}</span>
              </li>
            ))}
          </ul>
          <p className={styles.painResolution}>{t('pain.resolution')}</p>
        </SectionComposition>
        {/* ─── 2. HOW IT WORKS: 7/5 split, vertical step list with numeral
          markers + a real screenshot in PhoneMockup ─── */}
        <SectionComposition
          tone='subtle'
          className={styles.howSection}
          aria-labelledby='how-heading'>
          <SectionHeaderMolecule
            className={styles.sectionHeader}
            title={t('howItWorks.headline')}
            titleId='how-heading'>
            {t('howItWorks.lede')}
          </SectionHeaderMolecule>
          <div className={styles.stepsSplit}>
            <ol
              className={styles.steps}
              aria-label={t('howItWorks.stepsAriaLabel')}>
              {STEPS.map(step => (
                <li key={step.n} className={styles.stepItem}>
                  <span className={styles.stepNumeral} aria-hidden='true'>
                    {step.n}
                  </span>
                  <div className={styles.stepBody}>
                    <h3 className={styles.stepTitle}>{t(step.titleKey)}</h3>
                    <p className={styles.stepText}>{t(step.bodyKey)}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className={styles.stepsPhoneCol}>
              <PhoneMockupMolecule
                label={t('steps.step1Title')}
                route={ROUTES_FRONT.GALLERY_UPLOAD_ASSET}
                size='lg'
                screenshot={appScreen('appUpload')}
              />
            </div>
          </div>
          <ProcessIllustrationMolecule
            src={LP_ASSETS.process.stylistPortfolio}
            alt={t('howItWorks.processAlt')}
            className={styles.processIllustration}
          />
        </SectionComposition>
        {/* ─── Mid-CTA after „jak to działa" ─── */}
        <HomeMidCtaOrganism
          headline={t('midCta.stepsHeadline')}
          accent={t('midCta.stepsAccent')}
          reassurance={t('midCta.stepsReassurance')}
          cta={t('midCta.stepsCta')}
          onAction={withSignupTracking('home-mid', goToLogin)}
        />

        {/* ─── 3. BENEFITS ─── */}
        {/* constrained=false: the children (header / bento / triptych / footnote)
          carry their own max-width + centring, so the band stays edge-to-edge. */}
        <SectionComposition
          className={styles.benefitsSection}
          constrained={false}
          aria-labelledby='benefits-heading'>
          <SectionHeaderMolecule
            className={styles.sectionHeader}
            title={t('benefits.headline')}
            titleId='benefits-heading'>
            {t('benefits.lede')}
          </SectionHeaderMolecule>
          <div className={styles.benefitsList}>
            {BENEFITS.map(b => (
              <article
                key={b.n}
                className={styles.benefit}
                data-span={b.span}
                data-highlight={b.highlight || undefined}
                data-wide={b.wide || undefined}>
                <div className={styles.benefitContent}>
                  <h3 className={styles.benefitTitle}>{t(b.titleKey)}</h3>
                  <p className={styles.benefitText}>{t(b.bodyKey)}</p>
                  {b.highlight && (
                    <div
                      className={styles.benefitHighlightAnchor}
                      aria-hidden='true'>
                      <span className={styles.benefitHighlightFigure}>0%</span>
                      <span className={styles.benefitHighlightLabel}>
                        {t('benefits.commissionLabel')}
                      </span>
                    </div>
                  )}
                  <BenefitVisualAtom kind={b.n} />
                </div>
              </article>
            ))}
          </div>
        </SectionComposition>

        <HomeShowcaseOrganism />

        {/* ─── Mid-CTA after the app showcase ─── */}
        <HomeMidCtaOrganism
          headline={t('midCta.showcaseHeadline')}
          accent={t('midCta.showcaseAccent')}
          cta={t('midCta.showcaseCta')}
          onAction={withSignupTracking('home-showcase', goToLogin)}
        />

        {/* ─── Sections 4-7: Trust, Testimonials, ClientStrip, FinalCta ─── */}
        {/* (No mobile „0%" caesura: it would be the third „0%" in a row on mobile,
          bento card 0% → caesura → trust band 0% = a monotonous sequence; the
          rhythm comes from the bento and trust.) */}
        <HomePageBottomOrganism
          onLoginClick={withSignupTracking('home-bottom', goToLogin)}
        />

        {/* ─── StickyCtaBar — per-page, scroll-triggered ─── */}
        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={withSignupTracking('home-sticky', goToLogin)}
        />
      </div>
    </PublicLayoutComposition>
  );
}
