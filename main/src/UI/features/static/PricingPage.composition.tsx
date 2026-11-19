import { useEffect, useState } from 'react';
import { PricingHeroDetailMolecule } from './PricingHeroDetail.molecule';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@kernel/domain/pricing/money.format';
import { capturePosthog } from '../../../application/analytics/posthog-client';
import {
  ArrowCounterClockwiseIcon,
  ShieldCheckIcon,
  GlobeHemisphereWestIcon,
  CaretDownIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  BillingToggleMolecule,
  type BillingCycle,
} from '../../components/BillingToggle/BillingToggle.molecule';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { smoothScrollToElement } from '../../shared/smoothScroll';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import { PricingTierSectionOrganism } from './PricingTierSection.organism';
import { ClientPricingBannerMolecule } from './ClientPricingBanner.molecule';
import {
  PricingCompareChapterOrganism,
  PricingTiersMockupsOrganism,
} from './PricingTierSection.parts.organism';
import { ReviewsSectionOrganism } from '../shared/reviews/ReviewsSection.organism';
import { PRICING_REVIEWS } from '../shared/reviews/ReviewsData';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { PRICING_FAQ } from './PricingPageData';
import { FeatureCardMolecule } from '../../components/FeatureCard/FeatureCard.molecule';
import { FeatureCardGridMolecule } from '../../components/FeatureCard/FeatureCardGrid.molecule';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
import { PricingTrialEndowmentOrganism } from './PricingTrialEndowment.organism';
import { SectionComposition } from '../../components/Section/Section.composition';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import styles from './PricingPage.module.css';
import {
  trackCtaClick,
  withCtaTracking,
  withSignupTracking,
} from '../../../application/analytics/cta-events';
import { PricingFinalCtaOrganism } from './PricingPage.finalCta.organism';

/* ─── PricingPage ─── */

export function PricingPageComposition() {
  // default monthly (owner): the lower price at first glance;
  // the -20% badge on the toggle does the upsell
  // UI toggle cycle (BillingCycle = 'monthly'|'yearly') — distinct alphabet
  // from the kernel `BillingPeriod` ('month'|'year'); reuses the toggle
  // component's own canonical type instead of a shadowing local copy.
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const router = useRouter();
  // threshold reduced to 280px (from default 400px): on a typical
  // phone (844px height) the hero CTA scrolls out of view at ~220px, so
  // 280px ensures the sticky bar appears as soon as the hero CTA is gone,
  // without jarring early appearance when the hero is still visible.
  const showStickyCta = useShowOnScroll(280);
  const t = useTranslations('static.pricing');

  const isYearly = billing === 'yearly';
  const { data: plans, currency } = usePricingPlans();
  const locale = useLocale();
  const proPlan = plans?.find(p => p.id === PricingPlanValue.PRO);
  const proPrice = proPlan
    ? isYearly
      ? proPlan.priceYearly
      : proPlan.priceMonthly
    : null;

  // Generic entry does not select a paid tier. A new stylist starts with Demo;
  // an existing stylist opens the plan chooser. Explicit tier-card actions keep
  // their selected plan and billing period through the separate funnel helper.
  const { data: currentUser } = useCurrentUserAccount();
  const { clearPricingFunnel } = usePricingFunnelState();
  const hasPlan = currentUser?.stylist_account != null;
  const ctaHref = hasPlan
    ? ROUTES_FRONT.USER_ACCOUNT_PAY
    : `${ROUTES_FRONT.USER_LOG}?intent=register&role=stylist`;
  const persistFunnel = clearPricingFunnel;
  const handleCtaNavigate = () => {
    persistFunnel();
    void router.push(ctaHref);
  };
  // Handlers with measurement computed once: the same two CTAs (final band and
  // bottom bar) lead to the same place, differing only in where the click happened.
  //
  // A stylist with an active plan clicks „Zarządzaj planem", not „Załóż konto";
  // counting her as a started signup would inflate the top of the funnel with the
  // only group that has already been through it.
  const trackCta = hasPlan ? withCtaTracking : withSignupTracking;
  const onFinalCtaClick = trackCta('pricing-final', handleCtaNavigate);
  const onStickyCtaClick = trackCta('pricing-sticky', handleCtaNavigate);

  const anchorBanner = (
    <div className={styles.anchorBanner}>
      <span>
        {t.rich('anchorBanner.text', {
          strong: chunks => <strong>{chunks}</strong>,
          price: () => (
            <span className={styles.anchorBannerHighlight}>
              {currency !== null && proPrice !== null
                ? formatMoney(proPrice, currency, locale)
                : '…'}
            </span>
          ),
        })}
      </span>{' '}
      <AppParagraphLinkAtom
        href={ROUTES_FRONT.COMPARE}
        onClick={() => trackCtaClick('pricing-compare-link')}
        className={styles.anchorBannerCompareLink}>
        {t('anchorBanner.compareLink')}
      </AppParagraphLinkAtom>
    </div>
  );

  // Mount-once semantic "entered pricing" event (obok autocapture pageview;
  // posthog singleton = instancja PostHogProvider, respektuje opt-out).
  useEffect(() => {
    capturePosthog('pricing_page_viewed');
  }, []);

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO: editorial split-font, uniform background ─── */}
        {/* DECISION: centred hero with no label above the h1 and no connector on
            the accent line; the demo context stays under the CTA, the proofs
            stay on the plan cards (no proof list here), the stylist ornament and
            equal gaps around the scroll link. (owner) */}
        <LpHeroOrganism
          className={styles.heroCompact}
          headline={t('hero.headlineLine1')}
          layout='center'
          headlineAccent={
            <>
              <br />
              {t('hero.headlineAccent')}
            </>
          }
          lede={<>{t('hero.lede')}</>}
          actions={
            <LinkButtonAtom
              direction='forward'
              href={ctaHref}
              onClick={persistFunnel}
              variant='primary'
              size='lg'>
              {hasPlan ? t('hero.ctaManage') : t('hero.cta')}
            </LinkButtonAtom>
          }
          meta={!hasPlan ? t('hero.demoNote') : undefined}
          aside={
            <div className={styles.heroDetailStack}>
              <PricingHeroDetailMolecule />
              <a
                href='#pricing-plans'
                className={styles.scrollToPlans}
                onClick={e => {
                  const el = document.getElementById('pricing-plans');
                  if (el) {
                    e.preventDefault();
                    smoothScrollToElement(el, 96);
                    history.replaceState(null, '', '#pricing-plans');
                  }
                }}>
                <span>{t('hero.scrollToPlans')}</span>
                <CaretDownIcon size={16} weight='bold' aria-hidden='true' />
              </a>
            </div>
          }
          headingId='pricing-hero-heading'
        />

        {/* ─── 2. TIER LIST ───
          Owner: the billing-period switch directly above the plan
          boxes (slot at the top of the tiers section), not in the hero.
          id='pricing-plans' = scroll anchor (clickable login banner +
          hero scroll-hint). */}
        <div id='pricing-plans' className={styles.plansAnchor}>
          <PricingTierSectionOrganism
            isYearly={isYearly}
            afterScale={<ClientPricingBannerMolecule />}
            afterPlans={
              <PricingCompareChapterOrganism afterTrust={anchorBanner} />
            }
            billingToggle={
              <BillingToggleMolecule
                variant='pricing'
                cycle={billing}
                onChange={setBilling}
                monthlyLabel={t('hero.billingMonthly')}
                yearlyLabel={t('hero.billingYearly')}
              />
            }
          />
        </div>

        {/* Screens AFTER the comparison (owner): the ink-stage breaks through
            the plans band, it does not sit between the cards and the table. */}
        <PricingTiersMockupsOrganism />

        {/* ─── 4. TRUST: editorial 3-column. Band = Section (bordered: full
          hairline frame); custom tint in className. Grid = FeatureCardGrid. ─── */}
        <SectionComposition
          bordered
          className={styles.trustSection}
          innerClassName={styles.trustInner}>
          <FeatureCardGridMolecule columns={3} className={styles.trustGrid}>
            {(
              [
                {
                  icon: (
                    <ArrowCounterClockwiseIcon size={22} weight='regular' />
                  ),
                  titleKey: 'trust.trialTitle',
                  bodyKey: 'trust.trialText',
                },
                {
                  icon: <GlobeHemisphereWestIcon size={22} weight='regular' />,
                  titleKey: 'trust.privacyTitle',
                  bodyKey: 'trust.privacyText',
                },
                {
                  icon: <ShieldCheckIcon size={22} weight='regular' />,
                  titleKey: 'trust.securityTitle',
                  bodyKey: 'trust.securityText',
                },
              ] as const
            ).map(item => (
              <FeatureCardMolecule
                key={item.titleKey}
                icon={item.icon}
                title={t(item.titleKey)}
                body={t(item.bodyKey)}
              />
            ))}
          </FeatureCardGridMolecule>
        </SectionComposition>

        {/* ─── 4b. SOCIAL PROOF — beta reviews ─── */}
        <ReviewsSectionOrganism
          reviews={PRICING_REVIEWS}
          headlineKey='pricingHeadline'
        />

        {/* ─── 5. FAQ: at the very bottom, right above finalCta (owner);
          shared FaqSection (the canonical skin is based on pricing,
          ~1:1 parity). Band = Section tone subtle (bg + full frame from the canon);
          as='div' because FaqSection renders <section aria-labelledby> itself.
          id='pricing-faq' = anchor for finalCta secondary. ─── */}
        <SectionComposition
          bordered
          as='div'
          className={styles.faqSection}
          id='pricing-faq'>
          <FaqSectionMolecule
            title={t('faq.headline')}
            headingId='pricing-faq-heading'
            idPrefix='pricing-faq'
            items={PRICING_FAQ.map(item => ({
              id: item.questionKey,
              question: t(item.questionKey),
              answer: t(item.answerKey),
            }))}
          />
        </SectionComposition>

        {/* ─── 5b. TRIAL ENDOWMENT: ink card „Masz pełne Pro" above the final CTA.
          Trial endowment + loss frame (a conversion lever, owner):
          after the objections are cleared (FAQ) it reminds that the trial is
          HAVING full Pro, and Free is a loss. Copy from i18n
          static.pricing.trialEndowment. ─── */}
        <PricingTrialEndowmentOrganism />

        {/* ─── 6. FINAL CTA: shared FinalCtaBand (gold-band canon);
          plan-aware actions stay per-page, the molecule styles. ─── */}
        <PricingFinalCtaOrganism
          hasPlan={hasPlan}
          onCtaClick={onFinalCtaClick}
        />

        {/* Sticky acquisition nag is pointless for a stylist who already has a
          plan — the in-content CTAs already read "Zarządzaj planem". */}
        <StickyCtaBarMolecule
          visible={showStickyCta && !hasPlan}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={onStickyCtaClick}
          textVariant='caption'
          buttonSize='md'
        />
      </div>
    </PublicLayoutComposition>
  );
}
