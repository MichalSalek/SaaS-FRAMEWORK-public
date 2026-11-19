import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
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
  // Urządzenia bez dostępnej aplikacji, w tym desktop, zaczynają rejestrację
  // w przeglądarce. Android z aktywnym linkiem Play przechodzi do /get-app.
  const clientStart = useClientStartCta();
  // The same button goes either to in-browser registration or to /get-app.
  // The platform decides, not the page. Without that split, client signups
  // recorded `signup_completed` with no matching `signup_started`, a hole
  // exactly where the funnel was meant to be measured.
  const trackClientCta = clientStart.isBrowserStart
    ? withSignupTracking
    : withCtaTracking;

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO ─── */}
        <LpHeroOrganism
          headline={t('hero.headlineLine1')}
          headlineAccent={t('hero.headlineAccent')}
          lede={t('hero.lede')}
          shimmerCta
          actions={
            <>
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
                {clientStart.isBrowserStart ? t('webStartCta') : t('hero.cta')}
              </ButtonAtom>
              {mode === 'app' && (
                <AppParagraphLinkAtom
                  onClick={() => trackSignupStarted('clients-hero')}
                  href={`${ROUTES_FRONT.USER_LOG}?intent=register`}
                  className={styles.heroSecondary}>
                  {t('hero.ctaWeb')}
                </AppParagraphLinkAtom>
              )}
            </>
          }
          meta={<span>{t('hero.proof1')}</span>}
          media={
            /* Interactive screen pair: the inspiration-session list (focal) plus
               gallery browsing. Hover, tap and focus move the enlargement.
               The session list is a full screen, not the client view with a
               large empty margin (owner: „gigantyczny biały margin"). */
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
          }
        />

        {/* ─── 1b. DISCOVERY — real inspiration samples ─── */}
        <ForClientsDiscoverySectionOrganism />

        {/* ─── 2. VISIT MOMENTS — the single numbered journey (the former
            "3 kroki" section duplicated this flow and was merged here) ─── */}
        <ForClientsVisitMomentsSectionOrganism />

        {/* ─── 3. BENEFITS ─── */}
        <ForClientsBenefitsSectionOrganism />

        {/* Portfolio strip: a visual divider between benefits and reviews. */}
        <ForClientsPortfolioStripSectionOrganism />

        {/* ─── 3b. SOCIAL PROOF — beta reviews ─── */}
        <ReviewsSectionOrganism
          reviews={CLIENT_REVIEWS}
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
