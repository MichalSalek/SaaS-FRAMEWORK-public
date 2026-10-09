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
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import {
  GetAppHeroOrganism,
  GET_APP_STORES_ANCHOR_ID,
} from './GetAppHero.organism';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { ReviewsSectionOrganism } from '../shared/reviews/ReviewsSection.organism';
import { GET_APP_REVIEWS } from '../shared/reviews/ReviewsData';
import { FEATURES, GET_APP_FAQ } from './GetAppPageFeatures';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
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

/* ─── FAQ data — GET_APP_FAQ żyje w GetAppPageFeatures (wzór OBJECTION_FAQ /
   PRICING_FAQ). Ten sam zestaw par zasila FAQPage JSON-LD w pages/get-app.tsx
   (q1-q8) — render i schema pozostają spójne. ─── */

/* ─── Trust facts — głos S24/8 wariant B (ikony 1:1 z playgroundu) ─── */
const TRUST_FACTS: ReadonlyArray<{ TIcon: Icon; textKey: string }> = [
  { TIcon: CheckCircleIcon, textKey: 'trust.item1' },
  { TIcon: ArrowCounterClockwiseIcon, textKey: 'trust.item2' },
  { TIcon: CheckCircleIcon, textKey: 'trust.item3' },
  { TIcon: ShieldCheckIcon, textKey: 'trust.item4' },
];

/* ─── GetAppPage ─── */

/**
 * Landing page for desktop redirect target (Desktop Access Policy).
 *
 * Desktop users visiting /app/* on PREVIEW/PRODUCTION (non-admin, non-devMode)
 * are redirected here by `resolveDesktopAccess()`. The page communicates
 * the app-store value proposition and prompts downloading the mobile app.
 */
export function GetAppPageComposition() {
  const showStickyCta = useShowOnScroll();
  const t = useTranslations('static.getApp');
  const appScreen = useAppScreenshots();
  // DECISION (nie usuwaj tego komentarza):
  // static.getApp.faq ma tylko pary q/a (bez headline/eyebrow). Nagłówek h2 =
  // account.pay.faq.eyebrow ("Częste pytania" / "Frequent questions" /
  // "Häufige Fragen") — jedyny generyczny nagłówek FAQ istniejący we wszystkich
  // locale. Namespace 'account.pay' doładowany w pages/get-app.tsx (loader
  // wspiera max 2 segmenty, a pages.home.faq.headline jest w en/de
  // home-specyficzny — nie nadaje się do zapożyczenia).
  const tFaqHeading = useTranslations('account.pay.faq');
  const tNav = useTranslations('nav');
  // Mobile-first funnel: this page IS the 'get-app' funnel target, so login
  // CTAs would loop get-app -> login -> get-app on desktop. In 'get-app' mode
  // the final/sticky CTAs scroll to the hero store buttons instead, with a
  // download label (their copy says "create account").
  const mode = useAppEntryMode();

  // Free-first (owner 2026-09-23): czyści zalegający zamiar planu z cennika.
  const goToLogin = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register`
  );

  const scrollToStores = () => {
    document
      .getElementById(GET_APP_STORES_ANCHOR_ID)
      ?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleFunnelCta = mode === 'app' ? goToLogin : scrollToStores;
  // W trybie 'app' ten sam przycisk zaczyna rejestrację, więc liczy się jako
  // `signup_started` (parytet z ForClients); bez tego rejestracje z /get-app
  // dawały `signup_completed` bez pasującego startu.
  const trackFunnelCta = mode === 'app' ? withSignupTracking : withCtaTracking;

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO — GetAppHero (współdzielony z /app/home od 2026-09-09;
          DECISION w GetAppHero.organism.tsx). Kanoniczny LpHero, głos S22/2
          (fuzja B+C): kolaż dwóch telefonów (galeria + rozmowa, editorial offset)
          + przyciski sklepów POD produktem („pobranie mieszka przy
          produkcie"). Wrapper przycisków = scroll anchor funnel CTA w trybie
          'get-app'. ─── */}
        {/* Owner 2026-10-08: the main action is in the FIRST view. The hero had
            no button at all; the only CTA sat at the bottom of a 9500 px page. */}
        <GetAppHeroOrganism
          headingId='getapp-hero-heading'
          actions={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={trackFunnelCta('get-app-hero', handleFunnelCta)}>
              {mode === 'app' ? t('finalCta.cta') : tNav('getApp')}
            </ButtonAtom>
          }
        />

        {/* ─── 2. FEATURES — głos S24/7 wariant B: split — pionowa lista 6
          funkcji jako hairline-wiersze z ikoną w lewej szynie + duży sticky
          screen realnej galerii (dowód zamiast dekoracji). Eyebrow
          „Co dostajesz" żyje W sekcji (markery sekcji usunięte — głos
          ownera S24). Band (tint + rama hairline + breakout + kontener)
          = Section tone='subtle'. ─── */}
        <SectionComposition tone='subtle' className={styles.featuresSection}>
          <SectionHeaderMolecule
            className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
            eyebrow={t('features.eyebrow')}
            eyebrowVariant='chip'
            title={t('features.headline')}>
            {t('features.lede')}
          </SectionHeaderMolecule>

          <div className={styles.featuresGrid}>
            <div className={styles.featuresList}>
              {FEATURES.map(f => (
                <article key={f.titleKey} className={styles.feature}>
                  <span className={styles.featureIcon} aria-hidden='true'>
                    {f.icon}
                  </span>
                  <div className={styles.featureContent}>
                    <h3 className={styles.featureTitle}>{t(f.titleKey)}</h3>
                    <p className={styles.featureText}>{t(f.bodyKey)}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className={styles.featuresPhoneCol}>
              <PhoneMockupMolecule
                label={t('features.mockupLabel')}
                route='/app/gallery'
                size='xl'
                screenshot={appScreen('appGalleryFeed')}
              />
            </div>
          </div>
        </SectionComposition>

        {/* ─── HOW — 3-step onboarding (dead-i18n activation). Band (breakout
          + kontener) = Section; bg-main + separator border-top (celowo
          pojedynczy — domyka tint-band features powyżej, NIE rama) zostają
          page-side w .howSection. ─── */}
        <SectionComposition
          className={styles.howSection}
          innerClassName={styles.howInner}
          aria-labelledby='getapp-how-heading'>
          <EyebrowAtom as='p' variant='chip'>
            {t('how.eyebrow')}
          </EyebrowAtom>
          <SectionOrnamentMolecule src={LP_ASSETS.decor.womanPhoneOutline}>
            <h2 id='getapp-how-heading' className={styles.howHeadline}>
              {t('how.headline')}
            </h2>
          </SectionOrnamentMolecule>
          <p className={styles.howLede}>{t('how.lede')}</p>
          {/* Kanoniczna sekwencja kroków — ta strona była kanonem skali
            (NumberMarker sm), parytet niemal 1:1 z dawnym .howSteps. */}
          <StepsSectionOrganism
            variant='list'
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

        {/* ─── SOCIAL PROOF — beta reviews ─── */}
        <ReviewsSectionOrganism
          reviews={GET_APP_REVIEWS}
          headlineKey='getAppHeadline'
        />

        {/* ─── 3. TRUST — głos S24/8 wariant B: zamknięta ink-karta (InkPanel)
          z 4 faktami w gridzie 2x2; panel zwężony i niski, żeby nie robić
          ściany obok gold finalCta strony. Band (breakout + default rytm
          + kontener) = Section; jawne bg-main zostaje w .trustSection. ─── */}
        <SectionComposition
          className={styles.trustSection}
          innerClassName={styles.trustInner}>
          <EyebrowAtom as='p' variant='chip'>
            {t('trust.eyebrow')}
          </EyebrowAtom>
          <div className={styles.trustPanelWrap}>
            <InkPanelAtom tone='ink' className={styles.trustPanel}>
              {/* trustGrid page-local, NIE TrustSignals grid — DECISION w
                  GetAppPage.module.css (.trustGrid): kanon renderuje jasne karty
                  nieczytelne na ink-panelu, override przegrywa specificity. */}
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

        {/* ─── 3b. FAQ — kanoniczny FaqSection (pary q1-q8 zasilają też FAQPage
          JSON-LD); band (tint + rama hairline + breakout + kontener) =
          Section tone='subtle', as='div' bo FaqSection sam renderuje
          <section aria-labelledby>. Tytuł w spanie .faqTitleScale =
          parytet skali z resztą nagłówków sekcji strony.
          DECISION (nie usuwaj tego komentarza): tytuł to <span> (NIE
          <SectionHeader>), bo FaqSection sam renderuje element nagłówkowy
          (headingId='getapp-faq-heading') — opakowanie go w kanoniczny h2
          dałoby zdublowany nagłówek w outline regionu aria-labelledby.
          Klasa .faqTitleScale (samodzielna, NIE .sectionHeadline — audyt
          eyebrow-headline-dup) tylko odwzorowuje skalę nagłówków sekcji
          (dawny lokalny .sectionHeadline: clamp(28-48px)/1.08/-0.018em). ─── */}
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

        {/* ─── 4. FINAL CTA — współdzielony FinalCtaBand ─── */}
        <FinalCtaBandOrganism
          headlineLine1={t('finalCta.headlineLine1')}
          headlineAccent={t('finalCta.headlineAccent')}
          body={t('finalCta.body')}
          actions={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={trackFunnelCta('get-app-hero', handleFunnelCta)}>
              {mode === 'app' ? t('finalCta.cta') : tNav('getApp')}
            </ButtonAtom>
          }
          secondary={
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.FOR_STYLISTS}
              onClick={() => trackCtaClick('get-app-stylists-link')}>
              {t('finalCta.secondaryStylists')}
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
