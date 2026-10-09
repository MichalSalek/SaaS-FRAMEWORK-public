import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import Image from 'next/image';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import {
  EnvelopeIcon,
  InstagramLogoIcon,
  LifebuoyIcon,
  QuestionIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { BRAND_SOCIAL_PROFILES_PUBLIC } from '../../shared/brandSocial';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
import { NavCardOrganism } from '../../components/NavCard/NavCard.organism';
import { SectionComposition } from '../../components/Section/Section.composition';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { TrustProseMolecule } from '../../components/TrustProse/TrustProse.molecule';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { ContactPageFormMolecule } from './ContactPageForm.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { useFreeSignupCta } from '../../shared/hooks/usePricingFunnelState';
import { withSignupTracking } from '../../../application/analytics/cta-events';
import styles from './ContactPage.module.css';

/* ─── FAQ data — keys only (wzór OBJECTION_FAQ / PRICING_FAQ). Ten sam zestaw
   par zasila FAQPage JSON-LD w pages/contact.tsx (q1-q6) — render i schema
   pozostają spójne. ─── */
const CONTACT_FAQ: { questionKey: string; answerKey: string }[] = [
  { questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { questionKey: 'faq.q5', answerKey: 'faq.a5' },
  { questionKey: 'faq.q6', answerKey: 'faq.a6' },
];

/**
 * Contact page orchestrator.
 *
 * Sections (S21 hierarchy fix — jeden fokal: formularz):
 * 1. Hero — kanon LpHero (gold-italic akcent). SLA dnia roboczego żyje
 *    w headlineAccent; osobny badge w meta został usunięty (sklejka dwóch
 *    faktów + powtórka obietnicy).
 * 2. Content split — left: jeden headline + 3 trust-sygnały (TrustSignals grid)
 *                    right: form card (fokal strony)
 * 3. FAQ — kanon FaqSection (pary q1-q6 zasilają FAQPage JSON-LD)
 * 4. Alternative channels — 3 chip cards (Help Center / Instagram / Email)
 * 5. Final CTA (preserved)
 *
 * Konwencja etykiet (S21): max 1 etykieta nad sekcją — hero ma kicker-chip,
 * sekcje body niosą tytuły WEWNĄTRZ siebie (markery-dividery usunięte S24 — tytuł sekcji żyje w sekcji, nie nad nią).
 *
 * Uses PublicLayout (thin shell responsibility).
 */
export function ContactPageComposition() {
  const showStickyCta = useShowOnScroll();
  const t = useTranslations('static.contact');
  // DECISION (nie usuwaj tego komentarza):
  // „Start" CTA = ACCOUNT-route → web-login funnel na KAŻDYM viewporcie, bez
  // /get-app bounce (parytet z pricingFunnelHref, S43 web-login-first). Bez role=
  // (generyczne wejście — rolę wybiera krok onboardingu, wzorzec HomePage).
  // Free-first (owner 2026-09-23): useFreeSignupCta czyści zalegający zamiar
  // planu z cennika, jak na pozostałych stronach publicznych.
  const goToSignup = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register`
  );
  // DECISION (nie usuwaj tego komentarza):
  // static.contact.faq ma tylko pary q/a (bez headline/eyebrow). Nagłówek h2 =
  // account.pay.faq.eyebrow ("Częste pytania" / "Frequent questions" /
  // "Häufige Fragen") — jedyny generyczny nagłówek FAQ istniejący we
  // wszystkich locale. Namespace 'account.pay' doładowany w pages/contact.tsx
  // (loader wspiera max 2 segmenty, a pages.home.faq.headline jest w en/de
  // home-specyficzny — nie nadaje się do zapożyczenia).
  const tFaqHeading = useTranslations('account.pay.faq');

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. Hero — kanon: LpHero molecule (gold-italic akcent, entrance
          i typografia żyją w LpHero.module.css). <br /> = projektowany łam
          linia/akcent (wzorzec FinalCtaBand). SLA = headlineAccent, bez badge. ─── */}
        <LpHeroOrganism
          eyebrow={t('hero.eyebrow')}
          headline={
            <>
              {t('hero.headlineLine1')}
              <br />
            </>
          }
          headlineAccent={t('hero.headlineAccent')}
          lede={t('hero.lede')}
          headingId='contact-hero-heading'
        />

        {/* ─── 2. Content split: trust column + form card (fokal strony).
          Band = Section (plain; tint tła + rytm strony żyją w .contentSection);
          .splitGrid jako inner kontener Section (breakout + max-width z kanonu). ─── */}
        <SectionComposition
          className={styles.contentSection}
          innerClassName={styles.splitGrid}>
          {/* LEFT: jeden headline + trust-sygnały + FAQ deep link.
              aria-labelledby → własny h2 (zamiast aria-label z info.title,
              który tematycznie należy do sekcji kanałów). */}
          <aside
            className={styles.trustColumn}
            aria-labelledby='contact-trust-heading'>
            {/* Decorative envelope — asymmetric editorial accent, aria-hidden, mobile-hidden */}
            <Image
              src={LP_ASSETS.decor.staticContactEnvelope}
              alt=''
              aria-hidden='true'
              width={140}
              height={140}
              className={styles.decorEnvelope}
            />

            <h2 id='contact-trust-heading' className={styles.columnTitle}>
              {t('trust.title')}
            </h2>
            <p className={styles.columnLede}>{t('trust.lede')}</p>

            {/* Trust-sygnały — proza zaufania (głos ownera /ui S52 = wariant C):
                ikona+bullet grid zastąpiony jednym editorial zdaniem w roli --font-heading
                z gold-italic akcentem (kanon TrustProse). Jeden fokal kolumny
                = columnTitle; proza wyrównana do lewej pod lede. */}
            <TrustProseMolecule
              align='start'
              sentence={t.rich('info.trustProse', {
                em: chunks => <em>{chunks}</em>,
              })}
            />

            <div className={styles.faqCallout}>
              <span className={styles.faqIcon} aria-hidden='true'>
                <LifebuoyIcon size={20} weight='regular' />
              </span>
              <div className={styles.faqBody}>
                <p className={styles.faqTitle}>{t('faqCallout.title')}</p>
                <p className={styles.faqText}>{t('faqCallout.text')}</p>
              </div>
              <AppParagraphLinkAtom
                href={ROUTES_FRONT.HELP_CENTER}
                className={styles.faqLink}>
                {t('faqCallout.link')}
              </AppParagraphLinkAtom>
            </div>

            {/* In-content wejście na /about (audyt linkowania S20: about było
                sierotą — linkowane tylko ze stopki). */}
            <p className={styles.aboutPrompt}>
              {t.rich('aboutPrompt', {
                aboutLink: chunks => (
                  <AppParagraphLinkAtom
                    href={ROUTES_FRONT.ABOUT}
                    className={styles.aboutPromptLink}>
                    {chunks}
                  </AppParagraphLinkAtom>
                ),
              })}
            </p>
          </aside>

          {/* RIGHT: form wrapped in elevated card */}
          <div className={styles.formColumn}>
            <ContactPageFormMolecule />
          </div>
        </SectionComposition>

        {/* ─── 3. FAQ — kanoniczny FaqSection (pary q1-q6 zasilają też FAQPage
          JSON-LD); band = Section (subtle + pełna rama hairline, rytm strony
          w .faqSection). Tytuł w spanie .faqHeadline = parytet skali
          z resztą nagłówków sekcji strony. faqCallout w kolumnie trust
          zostaje bez zmian. ─── */}
        <SectionComposition
          tone='subtle'
          as='div'
          className={styles.faqSection}>
          <FaqSectionMolecule
            title={
              <span className={styles.faqHeadline}>
                {tFaqHeading('eyebrow')}
              </span>
            }
            headingId='contact-faq-heading'
            idPrefix='contact-faq'
            items={CONTACT_FAQ.map(item => ({
              id: item.questionKey,
              question: t(item.questionKey),
              answer: t(item.answerKey),
            }))}
          />
        </SectionComposition>

        {/* ─── 4. Alternative channels (chip cards) — band = Section (plain,
          bg-main + rytm strony w .channelsSection), .channelsInner jako
          inner kontener Section. ─── */}
        <SectionComposition
          className={styles.channelsSection}
          innerClassName={styles.channelsInner}>
          <h2 className={styles.channelsTitle}>{t('channels.title')}</h2>
          <p className={styles.channelsLede}>{t('channels.lede')}</p>

          <div className={styles.channelsLayout}>
            <div className={styles.channelGrid}>
              {(
                [
                  {
                    icon: <QuestionIcon size={20} weight='regular' />,
                    eyebrow: t('channels.helpCenter.kicker'),
                    title: t('info.helpCenterLabel'),
                    meta: t('info.helpCenterValue'),
                    href: ROUTES_FRONT.HELP_CENTER,
                    linkType: 'internal',
                  },
                  // Hidden with the footer row until the profile carries content
                  // (DECISION in UI/shared/brandSocial.ts).
                  ...(BRAND_SOCIAL_PROFILES_PUBLIC
                    ? [
                        {
                          icon: (
                            <InstagramLogoIcon size={20} weight='regular' />
                          ),
                          eyebrow: t('channels.instagram.kicker'),
                          title: t('info.instagramLabel'),
                          meta: t('info.instagramValue'),
                          href: `https://instagram.com/${BRAND_CONFIG.social.instagram}`,
                          linkType: 'external',
                        } as const,
                      ]
                    : []),
                  {
                    icon: <EnvelopeIcon size={20} weight='regular' />,
                    eyebrow: t('channels.email.kicker'),
                    title: t('info.emailLabel'),
                    meta: BRAND_CONFIG.email.contact,
                    href: `mailto:${BRAND_CONFIG.email.contact}`,
                    linkType: 'plain',
                  },
                ] as const
              ).map(ch => (
                <NavCardOrganism
                  key={ch.href}
                  href={ch.href}
                  linkType={ch.linkType}
                  icon={ch.icon}
                  eyebrow={ch.eyebrow}
                  title={ch.title}
                  titleAs='span'
                  meta={ch.meta}
                />
              ))}
            </div>
            <ProcessIllustrationMolecule
              src={LP_ASSETS.contextual.contact}
              alt={t('pageIllustrationAlt')}
              width={1400}
              height={1050}
              sizes='(max-width: 768px) 100vw, 672px'
              className={styles.contextualIllustration}
            />
          </div>
        </SectionComposition>

        {/* ─── 5. Final CTA — ink (konwencja F3: strona informacyjna) ─── */}
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
              onClick={withSignupTracking('contact-final', goToSignup)}>
              {t('finalCta.cta')}
            </ButtonAtom>
          }
          secondary={
            <AppParagraphLinkAtom href={ROUTES_FRONT.PRICING}>
              {t('finalCta.secondary')}
            </AppParagraphLinkAtom>
          }
          footnote={t('finalCta.reassurance')}
        />

        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={withSignupTracking('contact-sticky', goToSignup)}
        />
      </div>
    </PublicLayoutComposition>
  );
}
