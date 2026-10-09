import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  QrCodeIcon,
  BookmarkSimpleIcon,
  CheckCircleIcon,
} from '@phosphor-icons/react';
import { TrustSignalsMolecule } from '../../components/TrustSignals/TrustSignals.molecule';
import { ButtonAtom } from '../../components/Button/Button.atom';
import {
  PhotoFinaleCtaAccent,
  PhotoFinaleCtaOrganism,
} from '../../components/PhotoFinaleCta/PhotoFinaleCta.organism';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { InteractivePhoneDuoOrganism } from '../../components/InteractivePhoneDuo/InteractivePhoneDuo.organism';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ReviewsSectionOrganism } from '../shared/reviews/ReviewsSection.organism';
import { CLIENT_REVIEWS } from '../shared/reviews/ReviewsData';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { LP_ASSETS } from '../../assets/lpAssets';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { useAppEntryMode } from '../../shared/hooks/useAppEntryMode';
import { useClientStartCta } from '../../shared/hooks/useClientStartCta';
import {
  ForClientsDiscoverySectionOrganism,
  ForClientsVisitMomentsSectionOrganism,
  ForClientsBenefitsSectionOrganism,
  ForClientsTrustSectionOrganism,
  ForClientsPrivacySectionOrganism,
  ForClientsFaqSectionOrganism,
} from './ForClientsPageSections.organism';
import { ForClientsPortfolioStripSectionOrganism } from './ForClientsPortfolioStrip.organism';
import styles from './ForClientsPage.module.css';
import {
  trackSignupStarted,
  withCtaTracking,
  withSignupTracking,
} from '../../../application/analytics/cta-events';
import { ForClientsMidCtaSectionOrganism } from './ForClientsMidCta.organism';

/* ─── ForClientsPage ─── */
export function ForClientsPageComposition() {
  const router = useRouter();
  // F1-13: 280px threshold — bar appears as hero CTA scrolls out of view
  const showStickyCta = useShowOnScroll(280);
  const t = useTranslations('static.forClients');
  const appScreen = useAppScreenshots();
  // Mobile-first funnel: the secondary login links here literally promise the
  // browser ("Zaloguj przez przeglądarkę") — hidden in 'get-app' mode.
  const mode = useAppEntryMode();
  // Device-aware „start" CTA klientki: mobile web bez apki do pobrania (iOS
  // zawsze; Android do premiery w Play — web-first D0) → przeglądarka zamiast
  // ślepego /get-app z wyłączonymi store-buttonami (owner 2026-07-18 + 08-02).
  const clientStart = useClientStartCta();
  // Ten sam przycisk prowadzi raz do rejestracji w przeglądarce, a raz do
  // /get-app — o tym decyduje platforma, nie strona. Bez rozróżnienia mobilne
  // rejestracje klientek dawały `signup_completed` bez pasującego `signup_started`,
  // czyli lejek z dziurą dokładnie w miejscu, które miał mierzyć.
  const trackClientCta = clientStart.isBrowserStart
    ? withSignupTracking
    : withCtaTracking;

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO ─── */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.heroContent}>
              <EyebrowAtom as='p' variant='chip'>
                {t('hero.eyebrow')}
              </EyebrowAtom>
              <h1 className={styles.heroHeadline}>
                {t('hero.headlineLine1')}{' '}
                <span className={styles.heroHeadlineAccent}>
                  {t('hero.headlineAccent')}
                </span>
              </h1>
              <p className={styles.heroLede}>{t('hero.lede')}</p>
              {/* data-cta-shimmer='on': powolny sweep na primary CTA (global.css) */}
              <div className={styles.heroActions} data-cta-shimmer='on'>
                {/* F1-05: Dual-path — app download primary, web login secondary.
                    Covers users who prefer web or already have an account. */}
                <ButtonAtom
                  direction='forward'
                  variant='primary'
                  size='lg'
                  onClick={trackClientCta(
                    'clients-hero',
                    () => void router.push(clientStart.href)
                  )}>
                  {clientStart.isBrowserStart
                    ? t('webStartCta')
                    : t('hero.cta')}
                </ButtonAtom>
                {mode === 'app' && (
                  <AppParagraphLinkAtom
                    onClick={() => trackSignupStarted('clients-hero')}
                    href={`${ROUTES_FRONT.USER_LOG}?intent=register`}
                    className={styles.heroSecondary}>
                    {t('hero.ctaWeb')}
                  </AppParagraphLinkAtom>
                )}
              </div>
              <TrustSignalsMolecule
                variant='pills'
                className={styles.heroProof}
                items={[
                  {
                    icon: <CheckCircleIcon size={14} weight='regular' />,
                    text: t('hero.proof1'),
                  },
                  {
                    icon: <QrCodeIcon size={14} weight='regular' />,
                    text: t('hero.proof2'),
                  },
                  {
                    icon: <BookmarkSimpleIcon size={14} weight='regular' />,
                    text: t('hero.proof3'),
                  },
                ]}
              />
            </div>

            {/* Interaktywny duet screenów (głos Q3 VOTE 1 = C-in-hero focal-duo,
                zastąpił statyczny single-mockup): lista sesji inspiracji (fokal)
                + przeglądanie galerii; hover/tap/focus przenosi powiększenie.
                Asset S24: lista sesji (pełny ekran) zamiast widoku klientki z
                białą pustką (głos ownera: „gigantyczny biały margin"). */}
            <div className={styles.heroPhoneMockup}>
              <InteractivePhoneDuoOrganism
                screens={[
                  {
                    label: t('hero.mockupLabel'),
                    route: '/app/sessions',
                    screenshot: appScreen('appClientSessions'),
                  },
                  {
                    label: t('benefits.mockup2Label'),
                    route: '/app/favorites',
                    screenshot: appScreen('appClientFavorites'),
                  },
                ]}
              />
            </div>
          </div>
        </section>

        {/* ─── 1b. DISCOVERY — real inspiration samples ─── */}
        <ForClientsDiscoverySectionOrganism />

        {/* ─── 2. VISIT MOMENTS — the single numbered journey (the former
            "3 kroki" section duplicated this flow and was merged here) ─── */}
        <ForClientsVisitMomentsSectionOrganism />

        {/* ─── 3. BENEFITS ─── */}
        <ForClientsBenefitsSectionOrganism />

        {/* ─── 3c. PORTFOLIO STRIP — głos S22/4 = B, visual-divider ─── */}
        <ForClientsPortfolioStripSectionOrganism />

        {/* ─── 3b. SOCIAL PROOF — beta reviews ─── */}
        <ReviewsSectionOrganism
          reviews={CLIENT_REVIEWS}
          eyebrowKey='clientsEyebrow'
          headlineKey='clientsHeadline'
        />

        {/* ─── 4. MID-FUNNEL CTA — closed ink rectangle (InkPanel) ─── */}
        <ForClientsMidCtaSectionOrganism />

        {/* ─── 5. TRUST ─── */}
        <ForClientsTrustSectionOrganism />

        {/* ─── 6. PRIVACY MINI-SECTION ─── */}
        <ForClientsPrivacySectionOrganism />

        {/* ─── 7. FAQ ─── */}
        <ForClientsFaqSectionOrganism />

        {/* ─── 8. FINAL CTA — home photo-grid, image on the right ─── */}
        <PhotoFinaleCtaOrganism
          imageSide='right'
          imageSrc={LP_ASSETS.cta.beautyDiv02TwoHands}
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
                onClick={trackClientCta(
                  'clients-mid',
                  () => void router.push(clientStart.href)
                )}>
                {clientStart.isBrowserStart
                  ? t('webStartCta')
                  : t('finalCta.cta')}
              </ButtonAtom>
              {mode === 'app' ? (
                <AppParagraphLinkAtom
                  onClick={() => trackSignupStarted('clients-mid')}
                  href={`${ROUTES_FRONT.USER_LOG}?intent=register`}>
                  {t('finalCta.ctaWeb')}
                </AppParagraphLinkAtom>
              ) : null}
            </>
          }
          footnote={t('finalCta.reassurance')}
        />

        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={
            clientStart.isBrowserStart
              ? t('webStartCta')
              : t('stickyCta.button')
          }
          onButtonClick={trackClientCta(
            'clients-sticky',
            () => void router.push(clientStart.href)
          )}
        />
      </div>
    </PublicLayoutComposition>
  );
}
