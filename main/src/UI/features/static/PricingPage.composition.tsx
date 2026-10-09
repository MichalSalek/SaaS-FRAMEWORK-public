import { useEffect, useState } from 'react';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import posthog from 'posthog-js';
import {
  ArrowCounterClockwiseIcon,
  ShieldCheckIcon,
  GlobeHemisphereWestIcon,
  CaretDownIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import {
  BillingToggleMolecule,
  type BillingCycle,
} from '../../components/BillingToggle/BillingToggle.molecule';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { PriceSlotAtom } from '../../components/PriceSlot/PriceSlot.atom';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { smoothScrollToElement } from '../../shared/smoothScroll';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
import { usePricingPlans } from '../shared/pricing/hooks/usePricingPlans';
import {
  buildPlanLoginHref,
  buildPlanPayDeepLink,
} from '../shared/pricing/pricingFunnelHref';
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
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
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
  // default miesięcznie (głos ownera S24): niższa cena na pierwszy rzut oka;
  // -20% badge na toggle'u robi upsell
  // UI toggle cycle (BillingCycle = 'monthly'|'yearly') — distinct alphabet
  // from the kernel `BillingPeriod` ('month'|'year'); reuses the toggle
  // component's own canonical type instead of a shadowing local copy.
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const router = useRouter();
  // F1-13: threshold reduced to 280px (from default 400px) — on a typical
  // phone (844px height) the hero CTA scrolls out of view at ~220px, so
  // 280px ensures the sticky bar appears as soon as the hero CTA is gone,
  // without jarring early appearance when the hero is still visible.
  const showStickyCta = useShowOnScroll(280);
  const t = useTranslations('static.pricing');

  const isYearly = billing === 'yearly';
  const { data: plans, isPending } = usePricingPlans();
  const proPlan = plans?.find(p => p.id === PricingPlanValue.PRO);
  const proPrice = proPlan
    ? isYearly
      ? proPlan.priceYearly
      : proPlan.priceMonthly
    : null;

  // Funnel-aware CTAs — SAME doctrine as PricingTierSection (owner 2026-07-03,
  // web-login-first): the page-level CTAs (hero / final / sticky) are generic
  // upgrade intent carrying the RECOMMENDED plan (Pro) + chosen billing period.
  // Pricing is a PAYMENT funnel (account route), so it enters web-login → /pay on
  // EVERY viewport, desktop included — NO /get-app bounce (that gates the
  // mobile-only PRODUCT zone, not payments). A logged-in stylist deep-links
  // straight to the in-app pay page; everyone else takes the login deep-link.
  // useCurrentUserAccount is token-gated + absent on SSR/first render, so SSR
  // markup keeps the logged-out (login-funnel) CTA — hydration-safe.
  const { data: currentUser } = useCurrentUserAccount();
  const { setPricingFunnel } = usePricingFunnelState();
  const hasPlan = currentUser?.stylist_account != null;
  // billingPeriod uses the KERNEL vocabulary ('month'|'year') — the `billing`
  // state (BillingCycle = 'monthly'|'yearly') is the UI cycle, a different
  // alphabet, so it is derived from isYearly directly.
  const billingPeriod: BillingPeriod = isYearly ? 'year' : 'month';
  const ctaHref = hasPlan
    ? buildPlanPayDeepLink(PricingPlanValue.PRO, billingPeriod)
    : buildPlanLoginHref(PricingPlanValue.PRO, billingPeriod);
  // Persist the funnel intent BEFORE navigating: the query on the login href is
  // dropped by the 302 to `from`, so sessionStorage (usePricingFunnelState) is
  // the channel that carries planId+period onto /pay (parity with the tier
  // cards' onCtaFunnel). Logged-in deep-link needs no persist (query survives).
  const persistFunnel = () => {
    if (!hasPlan) {
      setPricingFunnel({ planId: PricingPlanValue.PRO, billingPeriod });
    }
  };
  const handleCtaNavigate = () => {
    persistFunnel();
    void router.push(ctaHref);
  };
  // Handlery z pomiarem policzone raz — te same dwa CTA (band finałowy i pasek
  // dolny) prowadzą do tego samego miejsca, różni je wyłącznie miejsce kliknięcia.
  //
  // Stylistka z aktywnym planem klika „Zarządzaj planem", nie „Załóż konto";
  // liczenie jej jako rozpoczętej rejestracji zawyżałoby górę lejka o jedyną
  // grupę, która już przez niego przeszła.
  const trackCta = hasPlan ? withCtaTracking : withSignupTracking;
  const onFinalCtaClick = trackCta('pricing-final', handleCtaNavigate);
  const onStickyCtaClick = trackCta('pricing-sticky', handleCtaNavigate);

  // Hint złamany po pierwszym zdaniu (głos ownera S28: nie wchodzi na
  // kolorową połowę hero). Split na granicy zdania — działa ×3 języki
  // (PL/EN/DE mają „. " po 1. zdaniu); fallback: całość w jednej linii.
  const ctaHintParts = t('hero.ctaHint').split(/(?<=\.)\s+/);
  const ctaHintLine1 = ctaHintParts[0];
  const ctaHintLine2 = ctaHintParts.slice(1).join(' ');
  const anchorBanner = (
    <div className={styles.anchorBanner}>
      <span>
        {t.rich('anchorBanner.text', {
          strong: chunks => <strong>{chunks}</strong>,
          price: chunks => (
            <span className={styles.anchorBannerHighlight}>
              <PriceSlotAtom value={proPrice} isLoading={isPending} size='sm' />{' '}
              {chunks}
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
    posthog.capture('pricing_page_viewed');
  }, []);

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO — editorial split-font, jednolite tło ─── */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            {/* DECISION: owner review 2026-10-07: the visual headline is the
                single h1; eyebrow is a short label and the headline uses ink. */}
            <EyebrowAtom as='p' variant='chip'>
              {t('hero.eyebrow')}
            </EyebrowAtom>
            <h1 className={styles.heroHeadline}>
              {t('hero.headlineLine1')} {t('hero.headlineAccent')}
            </h1>
            <p className={styles.heroLede}>{t('hero.lede')}</p>
            {/* F1-10: Above-fold CTA — visible without scroll on mobile & desktop.
              F1-04 + F1-06: deep-link to pay page, crawlable Link. */}
            <div className={styles.heroCtaRow} data-cta-shimmer='on'>
              {/* No className: the old outer-<Link> .heroCtaLink (text-decoration:none
                  + display:inline-block) and the empty .heroCtaButton are both covered
                  by the button styling. .heroCtaLink's inline-block would tie specificity
                  with and could clobber the button's inline-flex layout (icon CTA). */}
              <LinkButtonAtom
                direction='forward'
                href={ctaHref}
                onClick={persistFunnel}
                variant='primary'
                size='lg'>
                {hasPlan ? t('hero.ctaManage') : t('hero.cta')}
              </LinkButtonAtom>
              {/* Trial/card hint targets prospects — noise for a stylist who
                already has a plan and is here to manage it. Złamany po 1.
                zdaniu (S28), trzymany w lewej kolumnie. */}
              {!hasPlan && (
                <span className={styles.heroCtaHint}>
                  {ctaHintLine1}
                  {ctaHintLine2 && (
                    <>
                      <br />
                      {ctaHintLine2}
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Scroll-down affordance (owner S82): niewielka zachęta do zejścia
            do planów bez klikania CTA. Strzałka w dół = kierunek scroll
            (semantyka zgodna ze skutkiem — taste 33 na odwrót: tu skutek TO
            scroll w dół). Kotwica #pricing-plans (tier section niżej). */}
        {/* onClick = rAF smooth-scroll (owner S81/S82): wymusza płynność nawet
            przy systemowym „reduce motion", które ubija CSS scroll-behavior;
            href zostaje dla crawlera/URL. offsetTop 96 = scroll-margin navbara. */}
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

        {/* ─── 2. TIER LIST ───
          Głos ownera: przełącznik okresu rozliczenia bezpośrednio nad
          boxami planów (slot na górze tiers-sekcji), nie w hero.
          id='pricing-plans' = kotwica scroll (login banner klikalny +
          hero scroll-hint, owner S82). */}
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

        {/* Screeny PO porównaniu (owner 2026-08-19): ink-stage przełamuje
            bandę planów, nie siedzi między kartami a tabelą. */}
        <PricingTiersMockupsOrganism />

        {/* ─── 4. TRUST — editorial 3-column. Band = Section (bordered: pełna
          rama hairline S24); custom tint w className. Grid = FeatureCardGrid. ─── */}
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
                  eyebrowKey: 'trust.trialEyebrow',
                  titleKey: 'trust.trialTitle',
                  bodyKey: 'trust.trialText',
                },
                {
                  icon: <GlobeHemisphereWestIcon size={22} weight='regular' />,
                  eyebrowKey: 'trust.privacyEyebrow',
                  titleKey: 'trust.privacyTitle',
                  bodyKey: 'trust.privacyText',
                },
                {
                  icon: <ShieldCheckIcon size={22} weight='regular' />,
                  eyebrowKey: 'trust.securityEyebrow',
                  titleKey: 'trust.securityTitle',
                  bodyKey: 'trust.securityText',
                },
              ] as const
            ).map(item => (
              <FeatureCardMolecule
                key={item.titleKey}
                icon={item.icon}
                eyebrow={t(item.eyebrowKey)}
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

        {/* ─── 5. FAQ — na samym dole, tuż nad finalCta (głos ownera S24);
          współdzielony FaqSection (skórka kanoniczna bazuje na pricing W6,
          parytet ~1:1). Band = Section tone subtle (bg + pełna rama z kanonu);
          as='div' bo FaqSection sam renderuje <section aria-labelledby>.
          id='pricing-faq' = kotwica dla finalCta secondary. ─── */}
        <SectionComposition
          bordered
          as='div'
          className={styles.faqSection}
          id='pricing-faq'>
          <FaqSectionMolecule
            eyebrow={t('faq.eyebrow')}
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

        {/* ─── 5b. TRIAL ENDOWMENT — ink-karta „Masz pełne Pro" nad final CTA.
          Endowment + loss-frame trialu (dźwignia konwersji, głos ownera
          2026-07-12): po rozwianiu obiekcji (FAQ) przypomina, że 30 dni to
          POSIADANIE pełnego Pro, a Free to strata. Copy z i18n
          static.pricing.trialEndowment (osierocone po S52 → podłączone). ─── */}
        <PricingTrialEndowmentOrganism />

        {/* ─── 6. FINAL CTA — współdzielony FinalCtaBand (kanon gold-band);
          akcje plan-aware zostają per-page, molecule styluje. ─── */}
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
