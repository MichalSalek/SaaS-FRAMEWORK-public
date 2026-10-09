/**
 * ContentModerationPage — DSA-compliant public moderation policy + report form.
 *
 * Layout:
 *   1. Editorial hero (eyebrow chip + headline + lead + DSA reg note)
 *   2. Trust strip (3 reassurance bullets)
 *   3. TOC + 4 narrative sections (existing copy preserved)
 *   4. Inline mailto-based public report form (extracted to a sibling file)
 *   5. CTA — open contact form or email support directly
 *
 * DECISION (nie usuwaj tego komentarza):
 * Hero adopts the W1+ vocabulary (glow blob, eyebrow chip)
 * for visual continuity. We intentionally drop the small duotone shield
 * icon from the previous design — the eyebrow chip already carries
 * the "trust / safety" signal without competing with the headline.
 */

import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import {
  ShieldCheckIcon,
  FlagIcon,
  GavelIcon,
  EnvelopeSimpleIcon,
  EyeSlashIcon,
  ClockClockwiseIcon,
  ScalesIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { ContentModerationReportFormMolecule } from './ContentModerationReportForm.molecule';
import styles from './ContentModerationPage.module.css';

/* --- Constants --- */

const FORBIDDEN_KEYS = [
  'illegal',
  'portrait',
  'copyright',
  'spam',
  'offensive',
  'misleading',
] as const;

type ForbiddenKey = (typeof FORBIDDEN_KEYS)[number];

const REPORT_STEP_KEYS = ['open', 'click', 'send'] as const;

type ReportStepKey = (typeof REPORT_STEP_KEYS)[number];

const REPORT_STEP_ICONS: Record<ReportStepKey, React.ElementType> = {
  open: FlagIcon,
  click: ShieldCheckIcon,
  send: GavelIcon,
};

const REVIEW_STEP_KEYS = ['step1', 'step2', 'step3', 'step4'] as const;

const TRUST_KEYS = ['weReview', 'youStayAnonymous', 'gdprCompliant'] as const;
type TrustKey = (typeof TRUST_KEYS)[number];

const TRUST_ICONS: Record<TrustKey, React.ElementType> = {
  weReview: ClockClockwiseIcon,
  youStayAnonymous: EyeSlashIcon,
  gdprCompliant: ScalesIcon,
};

const SUPPORT_EMAIL = BRAND_CONFIG.email.support;

/* --- TOC --- */

interface ContentModerationTOCProps {
  t: ReturnType<typeof useTranslations<'pages.contentModeration'>>;
}

function ContentModerationTOC({ t }: ContentModerationTOCProps) {
  const tocItems = [
    { id: 'co-jest-niedozwolone', labelKey: 'tocItems.forbidden' as const },
    { id: 'jak-zglosic', labelKey: 'tocItems.howToReport' as const },
    { id: 'co-dalej', labelKey: 'tocItems.whatNext' as const },
    { id: 'apelacja', labelKey: 'tocItems.appeal' as const },
    { id: 'zglos-formularz', labelKey: 'tocItems.reportForm' as const },
  ] as const;

  return (
    <nav className={styles.toc} aria-label={t('tocHeading')}>
      <p className={styles.tocHeading}>{t('tocHeading')}</p>
      <ol className={styles.tocList}>
        {tocItems.map(item => (
          <li key={item.id}>
            <a href={`#${item.id}`} className={styles.tocLink}>
              {t(item.labelKey)}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* --- Page --- */

export function ContentModerationPageComposition() {
  const t = useTranslations('pages.contentModeration');

  return (
    <PublicLayoutComposition>
      <article className={styles.page}>
        {/* ─── Hero ─── */}
        <section className={styles.hero} aria-labelledby='moderation-title'>
          <h1 id='moderation-title' className={styles.heading}>
            {t('heroTitle')}
          </h1>
          <p className={styles.lead}>{t('heroLead')}</p>
          <p className={styles.regNote}>{t('heroRegNote')}</p>
        </section>

        {/* ─── Trust strip ─── */}
        <div className={styles.trustStrip}>
          {TRUST_KEYS.map((key: TrustKey) => {
            const Icon = TRUST_ICONS[key];
            return (
              <div key={key} className={styles.trustItem}>
                <span className={styles.trustIcon} aria-hidden='true'>
                  <Icon size={20} weight='duotone' />
                </span>
                <span className={styles.trustText}>
                  {t(`trustStrip.${key}`)}
                </span>
              </div>
            );
          })}
        </div>

        <div className={styles.content}>
          <ContentModerationTOC t={t} />

          <div className={styles.sections}>
            {/* Section 1 */}
            <section id='co-jest-niedozwolone' className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('section1.title')}</h2>
              <p className={styles.sectionText}>{t('section1.intro')}</p>
              <ul className={styles.list}>
                {FORBIDDEN_KEYS.map((key: ForbiddenKey) => (
                  <li key={key} className={styles.listItem}>
                    <span className={styles.listItemTitle}>
                      {t(`section1.forbidden.${key}.title`)}
                    </span>
                    <span className={styles.listItemDesc}>
                      {t(`section1.forbidden.${key}.description`)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className={styles.sectionText}>
                {t.rich('section1.termsNote', {
                  termsLink: chunks => (
                    <AppParagraphLinkAtom
                      prefetch={false}
                      href={ROUTES_FRONT.TERMS}
                      className={styles.inlineLink}>
                      {chunks}
                    </AppParagraphLinkAtom>
                  ),
                })}
              </p>
            </section>

            {/* Section 2 */}
            <section id='jak-zglosic' className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('section2.title')}</h2>
              <p className={styles.sectionText}>{t('section2.intro')}</p>
              <ol className={styles.stepsList}>
                {REPORT_STEP_KEYS.map((key: ReportStepKey) => {
                  const Icon = REPORT_STEP_ICONS[key];
                  return (
                    <li key={key} className={styles.stepItem}>
                      <span className={styles.stepIcon} aria-hidden='true'>
                        <Icon size={20} weight='duotone' />
                      </span>
                      <span className={styles.stepBody}>
                        <span className={styles.stepTitle}>
                          {t(`section2.steps.${key}.title`)}
                        </span>
                        <span className={styles.stepText}>
                          {t(`section2.steps.${key}.body`)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className={styles.sectionNote}>{t('section2.rateLimit')}</p>
            </section>

            {/* Section 3 */}
            <section id='co-dalej' className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('section3.title')}</h2>
              <p className={styles.sectionText}>{t('section3.intro')}</p>
              <ol className={styles.numberedList}>
                {REVIEW_STEP_KEYS.map(key => (
                  <li key={key} className={styles.numberedItem}>
                    {t(`section3.reviewSteps.${key}`)}
                  </li>
                ))}
              </ol>
              <p className={styles.sectionText}>{t('section3.conclusion')}</p>
            </section>

            {/* Section 4 */}
            <section id='apelacja' className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('section4.title')}</h2>
              <p className={styles.sectionText}>{t('section4.para1')}</p>
              <p className={styles.sectionText}>
                {t('section4.para2Start')}{' '}
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('section4.appealEmailSubject'))}`}
                  className={styles.inlineLink}>
                  {SUPPORT_EMAIL}
                </a>{' '}
                {t('section4.para2End')}
              </p>
              <p className={styles.sectionNote}>{t('section4.note')}</p>
            </section>
          </div>
        </div>

        {/* ─── Inline report form ─── */}
        <ContentModerationReportFormMolecule t={t} />

        {/* ─── CTA ─── */}
        <section className={styles.ctaSection}>
          <h2 className={styles.ctaHeading}>{t('cta.heading')}</h2>
          <p className={styles.ctaBody}>{t('cta.body')}</p>
          <div className={styles.ctaButtons}>
            <LinkButtonAtom
              direction='forward'
              href={ROUTES_FRONT.CONTACT}
              variant='primary'
              size='lg'>
              {t('cta.contactButton')}
            </LinkButtonAtom>
            <LinkButtonAtom
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('cta.emailSubject'))}`}
              variant='outlined'
              size='lg'
              icon={<EnvelopeSimpleIcon size={16} />}
              className={styles.ctaInlineLink}>
              {SUPPORT_EMAIL}
            </LinkButtonAtom>
          </div>
        </section>
      </article>
    </PublicLayoutComposition>
  );
}
