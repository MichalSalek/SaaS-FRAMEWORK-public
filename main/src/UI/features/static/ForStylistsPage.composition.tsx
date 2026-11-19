import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { PhoneQuoteStripOrganism } from '../../components/PhoneQuoteStrip/PhoneQuoteStrip.organism';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { SectionComposition } from '../../components/Section/Section.composition';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { TrustStatsSectionOrganism } from '../../components/TrustStatsSection/TrustStatsSection.organism';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useFreeSignupCta } from '../../shared/hooks/usePricingFunnelState';
import { OBJECTION_FAQ } from './ForStylistsPageData';
import {
  ForStylistsProblemsSectionOrganism,
  ForStylistsPullQuoteSectionOrganism,
  ForStylistsBenefitsSectionOrganism,
  ForStylistsPlaybookSectionOrganism,
} from './ForStylistsPageSections.organism';
import { ForStylistsPricingPreviewSectionOrganism } from './ForStylistsPageSections.b.organism';
import { ReviewsSectionOrganism } from '../shared/reviews/ReviewsSection.organism';
import { STYLIST_REVIEWS } from '../shared/reviews/ReviewsData';
import styles from './ForStylistsPage.module.css';
import {
  trackCtaClick,
  withSignupTracking,
} from '../../../application/analytics/cta-events';
import { CtaFootnoteWithPriceMolecule } from '../shared/pricing/CtaFootnoteWithPrice.molecule';
import { ForStylistsHeroOrganism } from './ForStylistsHero.organism';
import { HeroChatSceneMolecule } from '../shared/lpScenes/HeroAppScenes.molecule';
import { MidPageCtaMolecule } from '../../components/MidPageCta/MidPageCta.molecule';
import { TimeValueSectionOrganism } from '../shared/timeValue/TimeValueSection.organism';

/* ─── ForStylistsPage ─── */
export function ForStylistsPageComposition() {
  const router = useRouter();
  // 280px threshold: the bar appears as the hero CTA scrolls out of view
  const showStickyCta = useShowOnScroll(280);
  const t = useTranslations('static.forStylists');
  // Free-first (owner, DOMAIN_SSOT §18): the signup CTA clears any
  // stale plan intent (useFreeSignupCta), so onboarding activates Free with no
  // plan step; the Pro trial is offered in the app at the moment of value.
  // DECISION: the signup CTA goes straight to the web-login funnel on every viewport,
  // never through /get-app (parity with pricingFunnelHref); the /get-app bounce
  // closed the funnel on desktop.
  const goToSignup = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register&role=stylist`
  );

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO ─── */}
        <ForStylistsHeroOrganism
          onSignup={withSignupTracking('stylists-hero', goToSignup)}
        />
        <TimeValueSectionOrganism id='stylist-time-value' />

        {/* ─── 2. PROBLEM→SOLUTION ─── */}
        <ForStylistsProblemsSectionOrganism />

        {/* ─── 2b. PULL-QUOTE — ink-violet manifest breaker ─── */}
        <ForStylistsPullQuoteSectionOrganism />

        {/* ─── 3. BENEFITS ─── */}
        <ForStylistsBenefitsSectionOrganism />

        {/* ─── 3b. CTA band after the app preview. Owner: the same white band as
            on the home page belongs on the most visited pages. Measured (GA4 and
            PostHog, 90 days, without own traffic and bots): besides the home page,
            entries land on this page (Polish entries from ChatGPT and Google)
            and on /get-app. ─── */}
        <MidPageCtaMolecule
          headline={t('midCta.headline')}
          headlineAccent={t('midCta.accent')}
          reassurance={t('midCta.reassurance')}
          action={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={withSignupTracking('stylists-mid', goToSignup)}>
              {t('midCta.cta')}
            </ButtonAtom>
          }
        />

        {/* ─── 4. PRODUCT PLAYBOOK ─── */}
        <ForStylistsPlaybookSectionOrganism />

        {/* ─── 4b. PROOF: PhoneQuoteStrip (owner vote A): proof of the inspiration
            session mechanics next to the promise, after the steps section.
            Form 1:1 with the playground; copy from i18n, screen from LP_ASSETS. ─── */}
        <SectionComposition tone='white'>
          {/* Next to the promise stands the conversation before a visit, not a
              screenshot of the session list (owner: „ten czacik tłumaczy więcej
              niż cała strona, widać dokładnie proces działania aplikacji”). */}
          <PhoneQuoteStripOrganism
            visual={<HeroChatSceneMolecule surface='paper' />}
            quoteTitle={t.rich('phoneQuote.title', {
              em: chunks => <em>{chunks}</em>,
            })}
            quoteBody={t('phoneQuote.body')}
          />
        </SectionComposition>

        {/* ─── 5. PRICING PREVIEW ─── */}
        <ForStylistsPricingPreviewSectionOrganism
          onPricingClick={() => void router.push(ROUTES_FRONT.PRICING)}
        />

        {/* ─── 5b. SOCIAL PROOF — beta reviews ─── */}
        <ReviewsSectionOrganism
          reviews={STYLIST_REVIEWS}
          headlineKey='stylistsHeadline'
          heroReviewId='sSessions'
        />

        {/* ─── 6. FAQ — canonical FaqSection skin; the page keeps the heading
            and FaqSection renders the accordion. Use a div wrapper because
            FaqSection already renders the section landmark. ─── */}
        <SectionComposition as='div' className={styles.faqSection}>
          <SectionHeaderMolecule
            className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
            title={t('faq.headline')}
          />
          <FaqSectionMolecule
            idPrefix='stylists-faq'
            items={OBJECTION_FAQ.map(item => ({
              id: item.questionKey,
              question: t(item.questionKey),
              answer:
                /* a05 (Booksy/Fresha) carries an inline link to /compare, the
                   only in-content entry to the comparison page from this page. */
                item.answerKey === 'faq.a05'
                  ? t.rich('faq.a05', {
                      compareLink: chunks => (
                        <AppParagraphLinkAtom
                          href={ROUTES_FRONT.COMPARE}
                          className={styles.faqInlineLink}>
                          {chunks}
                        </AppParagraphLinkAtom>
                      ),
                    })
                  : t(item.answerKey),
            }))}
          />
        </SectionComposition>

        {/* ─── 7. TRUST: canonical TrustStatsSection molecule (the same
            section lives on home; the visual is in the component, the page gives content). ─── */}
        <TrustStatsSectionOrganism
          ariaLabel={t('trust.eyebrow')}
          body={t('trust.body')}
          benefitExamples={[1, 2, 3].map(index => ({
            title: t(`trust.useCase${index}Title`),
            body: t(`trust.useCase${index}Body`),
          }))}
        />

        {/* ─── 8. FINAL CTA: ink (convention: informational page) ─── */}
        <FinalCtaBandOrganism
          tone='ink'
          headlineLine1={t('finalCta.headlineLine1')}
          headlineAccent={t('finalCta.headlineAccent')}
          body={t('finalCta.body')}
          actions={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={withSignupTracking('stylists-final', goToSignup)}>
              {t('finalCta.cta')}
            </ButtonAtom>
          }
          secondary={
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.PRICING}
              onClick={() => trackCtaClick('stylists-pricing-link')}>
              {t('finalCta.secondaryPricing')}
            </AppParagraphLinkAtom>
          }
          footnote={
            <CtaFootnoteWithPriceMolecule text={t('finalCta.reassurance')} />
          }
        />

        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={withSignupTracking('stylists-sticky', goToSignup)}
        />
      </div>
    </PublicLayoutComposition>
  );
}
