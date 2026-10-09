import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import {
  CheckCircleIcon,
  ArrowCounterClockwiseIcon,
  ShieldCheckIcon,
  CreditCardIcon,
} from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { TrustSignalsMolecule } from '../../components/TrustSignals/TrustSignals.molecule';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { PhoneQuoteStripOrganism } from '../../components/PhoneQuoteStrip/PhoneQuoteStrip.organism';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { SectionComposition } from '../../components/Section/Section.composition';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
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
import { EntryPriceNoteMolecule } from '../shared/pricing/EntryPriceNote.molecule';

/* ─── ForStylistsPage ─── */
export function ForStylistsPageComposition() {
  const router = useRouter();
  // F1-13: 280px threshold — bar appears as hero CTA scrolls out of view
  const showStickyCta = useShowOnScroll(280);
  const t = useTranslations('static.forStylists');
  const appScreen = useAppScreenshots();
  // Free-first (owner 2026-09-23, DOMAIN_SSOT §18): the signup CTA clears any
  // stale plan intent (useFreeSignupCta), so onboarding activates Free with no
  // plan step; the Pro trial is offered in the app at the moment of value.
  // DECISION (nie usuwaj tego komentarza):
  // Signup CTA = ACCOUNT-route → web-login funnel na KAŻDYM viewporcie, bez
  // /get-app bounce (parytet z pricingFunnelHref, S43 web-login-first). Wcześniej
  // bounce na /get-app zamykał lejek na desktopie PREVIEW/PROD.
  const goToSignup = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register&role=stylist`
  );

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO ─── */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.heroContent}>
              {/* DECISION (nie usuwaj tego komentarza):
                  Eyebrow text functions as the SEO <h1> — it carries the
                  primary keyword phrase. The emotional headline below it is
                  the visual headline (h2). Pattern: SEO keyword in semantic
                  h1, brand voice in h2 (wzorzec home — HomePage.tsx hero).
                  Rendered via <Eyebrow as='h1' variant='chip'> so the SEO h1
                  IS the eyebrow chip — element stays <h1>, style is the pill.
                  Exactly one <h1> per page. */}
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
                  onClick={withSignupTracking('stylists-hero', goToSignup)}>
                  {t('hero.cta')}
                </ButtonAtom>
              </div>
              {/* Próg wejścia wprost pod CTA — kwota z żywego cennika. */}
              <EntryPriceNoteMolecule />
              <TrustSignalsMolecule
                variant='pills'
                className={styles.heroProof}
                items={[
                  {
                    icon: <CheckCircleIcon size={14} weight='regular' />,
                    text: t('hero.proof1'),
                  },
                  {
                    icon: (
                      <ArrowCounterClockwiseIcon size={14} weight='regular' />
                    ),
                    text: t('hero.proof2'),
                  },
                  {
                    icon: <CheckCircleIcon size={14} weight='regular' />,
                    text: t('hero.proof3'),
                  },
                ]}
              />
              <AppParagraphLinkAtom
                href={ROUTES_FRONT.FOR_CLIENTS}
                className={styles.heroClientLink}>
                {t('hero.ctaForClients')}
              </AppParagraphLinkAtom>
            </div>
            <div className={styles.heroPhoneMockup}>
              <PhoneMockupMolecule
                label={t('hero.mockupLabel')}
                route='/stylist/ola-nails'
                size='lg'
                screenshot={appScreen('appPublicProfile')}
              />
            </div>
          </div>
        </section>

        {/* ─── 2. PROBLEM→SOLUTION ─── */}
        <ForStylistsProblemsSectionOrganism />

        {/* ─── 2b. PULL-QUOTE — ink-violet manifest breaker ─── */}
        <ForStylistsPullQuoteSectionOrganism />

        {/* ─── 3. BENEFITS ─── */}
        <ForStylistsBenefitsSectionOrganism />

        {/* ─── 4. PRODUCT PLAYBOOK ─── */}
        <ForStylistsPlaybookSectionOrganism />

        {/* ─── 4b. PROOF — PhoneQuoteStrip (głos ownera S27/1 = A): dowód
            mechaniki sesji inspiracji obok obietnicy, po sekcji kroków.
            FORMA 1:1 z playgroundu; copy z i18n, screen z LP_ASSETS. ─── */}
        <SectionComposition>
          <PhoneQuoteStripOrganism
            phone={{
              label: t('phoneQuote.phoneLabel'),
              route: ROUTES_FRONT.CLIENT_SESSIONS,
              screenshot: appScreen('appClientSessions'),
            }}
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

        {/* ─── 6. FAQ — kanoniczna skórka (components/FaqSection); nagłówek
            zostaje po stronie strony (chip-kicker = wzorzec nagłówków tej
            strony, FaqSection nie przyjmuje eyebrowVariant). Band = Section
            as='div', bo <section> renderuje już FaqSection w środku. ─── */}
        <SectionComposition as='div' className={styles.faqSection}>
          <SectionHeaderMolecule
            className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
            eyebrow={t('faq.eyebrow')}
            eyebrowVariant='chip'
            title={t('faq.headline')}
          />
          <FaqSectionMolecule
            idPrefix='stylists-faq'
            items={OBJECTION_FAQ.map(item => ({
              id: item.questionKey,
              question: t(item.questionKey),
              answer:
                /* a05 (Booksy/Fresha) niesie inline-link do /compare —
                   jedyne in-content wejście na stronę porównania z tej
                   strony (audyt linkowania S20). */
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

        {/* ─── 7. TRUST — kanoniczny molecule TrustStatsSection (ta sama
            sekcja żyje na home — wizual w komponencie, strona daje treść). ─── */}
        <TrustStatsSectionOrganism
          eyebrow={t('trust.eyebrow')}
          body={t('trust.body')}
          benefitExamples={[1, 2, 3].map(index => ({
            title: t(`trust.useCase${index}Title`),
            body: t(`trust.useCase${index}Body`),
          }))}
          badges={[
            {
              icon: (
                <ShieldCheckIcon
                  size={16}
                  weight='regular'
                  aria-hidden='true'
                />
              ),
              text: t('trust.item1'),
            },
            {
              icon: (
                <CreditCardIcon size={16} weight='regular' aria-hidden='true' />
              ),
              text: t('trust.item2'),
            },
            {
              icon: (
                <CheckCircleIcon
                  size={16}
                  weight='regular'
                  aria-hidden='true'
                />
              ),
              text: t('trust.item3'),
            },
            {
              icon: (
                <ArrowCounterClockwiseIcon
                  size={16}
                  weight='regular'
                  aria-hidden='true'
                />
              ),
              text: t('trust.item4'),
            },
          ]}
          badgesAriaLabel={t('trust.listAriaLabel')}
          headingId='stylists-trust-heading'
        />

        {/* ─── 8. FINAL CTA — ink (konwencja F3: strona informacyjna) ─── */}
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
