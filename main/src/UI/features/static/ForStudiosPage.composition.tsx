import Image from 'next/image';
import { LP_ASSETS } from '../../assets/lpAssets';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@kernel/domain/pricing/money.format';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { canUsePaidPricing } from './PricingMarket.molecule';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
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
import styles from './ForStudiosPage.module.css';
import { ForStudiosGallerySectionOrganism } from './ForStudiosGallerySection.organism';
import {
  trackCtaClick,
  withSignupTracking,
} from '../../../application/analytics/cta-events';

/* ─── ForStudiosPage ─── */
export function ForStudiosPageComposition() {
  const router = useRouter();
  const showStickyCta = useShowOnScroll();
  const t = useTranslations('static.forStudios');
  const {
    data: plans,
    currency,
    country,
    internationalBillingEnabled,
    isCurrencyLocked,
  } = usePricingPlans();
  const locale = useLocale();
  const studioPlan = plans?.find(p => p.id === PricingPlanValue.STUDIO);
  // Monthly price (owner): the product states one amount everywhere.
  // The yearly discount is the pricing-page switch, not a second number here.
  const studioMonthlyPrice = studioPlan?.priceMonthly ?? null;
  const paidAvailable =
    currency !== null &&
    studioMonthlyPrice !== null &&
    canUsePaidPricing(country, internationalBillingEnabled, isCurrencyLocked);
  // DECISION: see main/src/UI/features/static/AboutPage.composition.tsx (signup CTA, no
  // /get-app bounce). A studio is a stylist account (binary roles), hence role=stylist.
  const loginCtaHref = `${ROUTES_FRONT.USER_LOG}?intent=register&role=stylist`;
  // DECISION: the Studio CTA sets an explicit STUDIO plan intent. Onboarding shows the plan
  // step ONLY with an intent, so without it the salon would silently enter the
  // individual Free Demo instead of the chosen Studio checkout. (owner)
  const { setPricingFunnel } = usePricingFunnelState();
  const goToStudioSignup = () => {
    setPricingFunnel({
      planId: PricingPlanValue.STUDIO,
      billingPeriod: 'month',
      ...(country && { billingCountry: country }),
      ...(currency && { currency }),
    });
    void router.push(loginCtaHref);
  };

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO ─── */}
        {/* DECISION: the keyword phrase stays the SEO <h1> via `lead`, inline
            with the description. No proof pills or number row: the first proof
            is plain text in `meta`, the voted studio photos sit in `media`.
            (owner) */}
        <LpHeroOrganism
          lead={t('hero.lead')}
          headline={t('hero.headlineLine1')}
          headlineAccent={t('hero.headlineAccent')}
          lede={t('hero.lede')}
          shimmerCta
          actions={
            <>
              <ButtonAtom
                direction='forward'
                variant='primary'
                size='lg'
                disabled={!paidAvailable}
                onClick={withSignupTracking('studios-hero', goToStudioSignup)}>
                {t('hero.cta')}
              </ButtonAtom>
              <AppParagraphLinkAtom
                href={ROUTES_FRONT.FOR_STYLISTS}
                className={styles.heroSecondary}>
                {t('hero.secondarySolo')}
              </AppParagraphLinkAtom>
            </>
          }
          meta={<span>{t('hero.proof1')}</span>}
          media={
            /* Owner review: a real team context replaces the generic hero screens. */
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
          }
        />

        {/* ─── 2. BENEFITS ─── */}
        <ForStudiosBenefitsSectionOrganism />
        <ForStudiosGallerySectionOrganism />

        {/* ─── 3. OPERATING MODEL ─── */}
        <ForStudiosOperatingSectionOrganism />

        {/* ─── 3b. USE CASES (Solo→Studio→Network) ─── */}
        <ForStudiosUseCasesSectionOrganism />

        {/* ─── 4. PRICING TIER PREVIEW (multi-tier) ─── */}
        <ForStudiosPricingTierPreviewSectionOrganism
          onSecondaryClick={() => void router.push(ROUTES_FRONT.PRICING)}
        />

        {/* ─── 4b. Payment assurances, right under the plan prices.
            DECISION: payment and data assurances (commission, Stripe, database)
            stand only next to prices, never under the hero. (owner) ─── */}
        <ForStudiosTrustStripSectionOrganism />

        {/* ─── 5. SOCIAL PROOF — beta reviews ───
            DECISION: heroReviewId is explicit. The archived sTeam quote is excluded from
            STUDIO_REVIEWS (ReviewsData.ts), so the old pin silently fell back to the longest
            quote of the set, which is sSessions in pl, en and de. Pinned here to keep that. */}
        <ReviewsSectionOrganism
          reviews={STUDIO_REVIEWS}
          headlineKey='studiosHeadline'
          heroReviewId='sSessions'
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
              {currency !== null && studioMonthlyPrice !== null
                ? formatMoney(studioMonthlyPrice, currency, locale)
                : '…'}
              {t('finalCta.bodySuffix')}
            </>
          }
          actions={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              disabled={!paidAvailable}
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
                {t('finalCta.scalePath')}
              </AppParagraphLinkAtom>
            </>
          }
        />

        <StickyCtaBarMolecule
          visible={showStickyCta && paidAvailable}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={withSignupTracking('studios-sticky', goToStudioSignup)}
        />
      </div>
    </PublicLayoutComposition>
  );
}
