import Image from 'next/image';
import { LP_ASSETS } from '../../assets/lpAssets';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { PriceSlotAtom } from '../../components/PriceSlot/PriceSlot.atom';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
import { HERO_METRICS } from './ForStudiosPageData';
import { TrustSignalsMolecule } from '../../components/TrustSignals/TrustSignals.molecule';
import {
  ForStudiosBenefitsSectionOrganism,
  ForStudiosFaqSectionOrganism,
  ForStudiosOperatingSectionOrganism,
  ForStudiosTrustStripSectionOrganism,
  ForStudiosUseCasesSectionOrganism,
  ForStudiosPricingTierPreviewSectionOrganism,
} from './ForStudiosPageSections.organism';
import { ReviewsSectionOrganism } from '../shared/reviews/ReviewsSection.organism';
import { STUDIO_REVIEWS } from '../shared/reviews/ReviewsData';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import styles from './ForStudiosPage.module.css';
import {
  trackCtaClick,
  withSignupTracking,
} from '../../../application/analytics/cta-events';

/* ─── ForStudiosPage ─── */
export function ForStudiosPageComposition() {
  const router = useRouter();
  const showStickyCta = useShowOnScroll();
  const t = useTranslations('static.forStudios');
  const { data: plans, isPending } = usePricingPlans();
  const studioPlan = plans?.find(p => p.id === PricingPlanValue.STUDIO);
  // Cena MIESIĘCZNA (owner 2026-09-02): produkt podaje jedną kwotę wszędzie,
  // a rabat roczny pokazuje przełącznik w cenniku, nie osobna liczba na landingu.
  const studioMonthlyPrice = studioPlan?.priceMonthly ?? null;
  // DECISION (nie usuwaj tego komentarza):
  // Signup CTA = ACCOUNT-route → web-login funnel na KAŻDYM viewporcie, bez
  // /get-app bounce (parytet z pricingFunnelHref, S43 web-login-first). Studio =
  // konto stylistki (role binarne STYLIST/CLIENT); plan wybierany w onboardingu.
  const loginCtaHref = `${ROUTES_FRONT.USER_LOG}?intent=register&role=stylist`;
  // DECISION (nie usuwaj tego komentarza):
  // The Studio CTA carries an explicit STUDIO plan intent. Onboarding shows its
  // plan step ONLY with an intent (free-first entry, owner 2026-09-23, DOMAIN_SSOT
  // §18); without it „Wypróbuj plan Studio" would silently land the salon on Free.
  const { setPricingFunnel } = usePricingFunnelState();
  const goToStudioSignup = () => {
    setPricingFunnel({
      planId: PricingPlanValue.STUDIO,
      billingPeriod: 'month',
    });
    void router.push(loginCtaHref);
  };

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO ─── */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.heroContent}>
              {/* DECISION (nie usuwaj tego komentarza):
                  Eyebrow text functions as the SEO <h1> — it carries the
                  primary keyword phrase. The visual headline below it is
                  <h2>. Pattern: SEO keyword in semantic h1, brand voice in
                  h2 (wzorzec home — HomePage.tsx hero). Rendered via
                  <Eyebrow as='h1' variant='chip'> so the SEO h1 IS the
                  eyebrow chip. Exactly one <h1> per page. */}
              <EyebrowAtom as='h1' variant='chip'>
                {t('hero.eyebrow')}
              </EyebrowAtom>
              <h2 className={styles.heroHeadline}>
                {t('hero.headlineLine1')}{' '}
                <span className={styles.heroHeadlineAccent}>
                  {t('hero.headlineAccent')}
                </span>
              </h2>
              <p className={styles.heroLede}>{t('hero.lede')}</p>
              {/* data-cta-shimmer='on': powolny sweep na primary CTA (global.css) */}
              <div className={styles.heroActions} data-cta-shimmer='on'>
                <ButtonAtom
                  direction='forward'
                  variant='primary'
                  size='lg'
                  onClick={withSignupTracking(
                    'studios-hero',
                    goToStudioSignup
                  )}>
                  {t('hero.cta')}
                </ButtonAtom>
                <AppParagraphLinkAtom
                  href={ROUTES_FRONT.FOR_STYLISTS}
                  className={styles.heroSecondary}>
                  {t('hero.secondarySolo')}
                </AppParagraphLinkAtom>
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
                    icon: <CheckCircleIcon size={14} weight='regular' />,
                    text: t('hero.proof2'),
                  },
                  {
                    icon: <CheckCircleIcon size={14} weight='regular' />,
                    text: t('hero.proof3'),
                  },
                ]}
              />

              {/* Liczby-dowody — cichy rząd serif-figur z hairline-
                  separatorami, bez boxów i bez kropek (S24 głosowanie 3,
                  wariant A — kanon StatsBand plain-row).
                  DECISION (nie usuwaj tego komentarza):
                  Migracja na StatsBand plain-row DIVERGENT: kanon plain-row
                  używa figure clamp(36-56px), tu potrzeba 28-44px (kontekst
                  hero); kanon używa auto-fit grid, tu explicit 3-col +
                  hairline-separatory (::before) + mobile row-layout. Bez
                  var-hooków w StatsBand.module.css nie da się nadpisać
                  wewnętrznych klas z zewnętrznego CSS Modules scope.
                  Zostaje hand-rolled do czasu rozszerzenia kanonu StatsBand
                  o var-hooki (--stats-band-figure-size, --stats-band-cols). */}
              <ul
                className={styles.heroMetrics}
                aria-label={t('hero.metricsAriaLabel')}>
                {HERO_METRICS.map(m => (
                  <li key={m.figureKey} className={styles.heroMetric}>
                    <strong className={styles.heroMetricFigure}>
                      {t(m.figureKey)}
                    </strong>
                    <span className={styles.heroMetricLabel}>
                      {t(m.labelKey)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Owner review: a real team context replaces the generic hero screens. */}
            <div className={styles.heroPhoneMockup}>
              <Image
                src={LP_ASSETS.editorial.salonTeamSwatch}
                alt={t('hero.teamPhotoAlt')}
                width={1536}
                height={1024}
                quality={95}
                priority
                sizes='(max-width: 1023px) calc(100vw - 32px), 700px'
                className={styles.heroTeamPhoto}
              />
              <Image
                src={LP_ASSETS.editorial.staticSalonEntrance01}
                alt={t('hero.workspacePhotoAlt')}
                width={1536}
                height={1024}
                quality={95}
                sizes='(max-width: 767px) calc(100vw - 40px), 560px'
                className={styles.heroTeamPhoto}
              />
            </div>
          </div>
        </section>

        {/* ─── 1b. TRUST STRIP ─── */}
        <ForStudiosTrustStripSectionOrganism />

        {/* ─── 2. BENEFITS ─── */}
        <ForStudiosBenefitsSectionOrganism />

        {/* ─── 3. OPERATING MODEL ─── */}
        <ForStudiosOperatingSectionOrganism />

        {/* ─── 3b. USE CASES (Solo→Studio→Network) ─── */}
        <ForStudiosUseCasesSectionOrganism />

        {/* ─── 4. PRICING TIER PREVIEW (multi-tier) ─── */}
        <ForStudiosPricingTierPreviewSectionOrganism
          onSecondaryClick={() => void router.push(ROUTES_FRONT.PRICING)}
        />

        {/* ─── 5. SOCIAL PROOF — beta reviews ───
            heroReviewId: pod nagłówkiem "Co mówią salony" hero-cytat MUSI być
            głosem właścicielki zespołu (Ola T., Velvet Nails) — automat
            "najdłuższa opinia" wybierał solo-stylistkę, verbatim duplikat
            hero-cytatu z /for-stylists. */}
        <ReviewsSectionOrganism
          reviews={STUDIO_REVIEWS}
          headlineKey='studiosHeadline'
          heroReviewId='sTeam'
        />

        {/* ─── 6. FAQ ─── */}
        <ForStudiosFaqSectionOrganism />

        {/* ─── 7. FINAL CTA — ink (konwencja F3: strona informacyjna) ─── */}
        <FinalCtaBandOrganism
          tone='ink'
          headlineLine1={t('finalCta.headlineLine1')}
          headlineAccent={t('finalCta.headlineAccent')}
          body={
            <>
              {t('finalCta.bodyPrefix')}{' '}
              <PriceSlotAtom
                value={studioMonthlyPrice}
                isLoading={isPending}
                size='sm'
              />{' '}
              {t('finalCta.bodySuffix')}
            </>
          }
          actions={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={withSignupTracking('studios-final', goToStudioSignup)}>
              {t('finalCta.cta')}
            </ButtonAtom>
          }
          secondary={
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.FOR_STYLISTS}
              onClick={() => trackCtaClick('studios-stylists-link')}>
              {t('finalCta.secondarySolo')}
            </AppParagraphLinkAtom>
          }
          footnote={
            /* scalePath = page-specific extra pod reassurance — klasa
               zostaje w module strony (slot footnote, inline w <p>). */
            <>
              {t('finalCta.reassurance')}
              <br />
              <AppParagraphLinkAtom
                href={ROUTES_FRONT.PRICING}
                onClick={() => trackCtaClick('studios-pricing-link')}
                className={styles.finalCtaScalePath}>
                {t('finalCta.scalePath').replace(/\s*(?:→|->)\s*$/u, '')}
              </AppParagraphLinkAtom>
            </>
          }
        />

        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={withSignupTracking('studios-sticky', goToStudioSignup)}
        />
      </div>
    </PublicLayoutComposition>
  );
}
