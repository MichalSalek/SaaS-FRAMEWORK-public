import { usePublicContact } from '../../components/Pii/usePublicContact';
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

import { CONTACT_FAQ } from './ContactPageData';

/**
 * Contact page orchestrator.
 *
 * Sections (the form is the page focal point):
 * 1. Canonical LpHero identifying the contact page.
 * 2. Split content: trust signals on the left and the focal form card on the
 *    right.
 * 3. FAQ pairs also feed FAQPage JSON-LD.
 * 4. Alternative contact cards for Help Center, Instagram, and email.
 * 5. Final CTA.
 *
 * Section headings carry their own names; no small label sits above them.
 * Uses PublicLayout as a thin shell.
 */
export function ContactPageComposition() {
  const contact = usePublicContact('contact');
  const showStickyCta = useShowOnScroll();
  const t = useTranslations('static.contact');
  // DECISION: see main/src/UI/features/static/AboutPage.composition.tsx (signup CTA, no
  // /get-app bounce). No role= here: a generic entry, onboarding asks the role.
  const goToSignup = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register`
  );
  // DECISION: see main/src/UI/features/static/AboutPageSections.organism.tsx (FAQ heading
  // borrows account.pay.faq.eyebrow).
  const tFaqHeading = useTranslations('account.pay.faq');

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. Hero — kanon: LpHero molecule (single-color heading, entrance
          i typografia żyją w LpHero.module.css). <br /> = projektowany łam
          linia/akcent (wzorzec FinalCtaBand). SLA = headlineAccent, bez badge. ─── */}
        <LpHeroOrganism
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

        {/* ─── 2. Content split: trust and form copy use separate white boxes
          on the paper. The FAQ list provides the next visual break. ─── */}
        <SectionComposition
          className={styles.contentSection}
          innerClassName={styles.splitGrid}>
          {/* LEFT: one headline, trust signals and the FAQ deep link.
              aria-labelledby points at this column's own h2, instead of an aria-label
              taken from info.title, which belongs to the channels section. */}
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

            {/* Trust signals as prose (owner vote): one editorial sentence in the
                heading face with one foreground (TrustProse), not an icon and
                bullet grid. The column has one focus, columnTitle; the prose sits
                left-aligned under the lede. */}
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

            {/* In-content link to /about: the page was linked only from the footer. */}
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

        {/* ─── 3. FAQ — canonical FaqSection. It sits on paper between the
          white reading bands; the list remains its single white box. The title
          in .faqHeadline keeps its existing scale. ─── */}
        <SectionComposition tone='plain' as='div' className={styles.faqSection}>
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

        {/* ─── 4. Alternative channels. Reading copy sits on white; the
          navigation cards and illustration keep paper panels inside it. ─── */}
        <SectionComposition
          tone='white'
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
                          title: t('info.instagramLabel'),
                          meta: t('info.instagramValue'),
                          href: `https://instagram.com/${BRAND_CONFIG.social.instagram}`,
                          linkType: 'external',
                        } as const,
                      ]
                    : []),
                  {
                    icon: <EnvelopeIcon size={20} weight='regular' />,
                    title: t('info.emailLabel'),
                    meta: contact.text,
                    href: contact.href,
                    linkType: 'plain',
                  },
                ] as const
              ).map(ch => (
                <NavCardOrganism
                  key={ch.href}
                  href={ch.href}
                  linkType={ch.linkType}
                  icon={ch.icon}
                  title={ch.title}
                  titleAs='span'
                  meta={ch.meta}
                  className={styles.channelCard}
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
