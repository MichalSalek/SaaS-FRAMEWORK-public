import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import { useTranslations } from 'next-intl';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { SectionComposition } from '../../components/Section/Section.composition';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { NewsletterInlineFormOrganism } from '../shared/newsletter/NewsletterInlineForm.organism';
import styles from './HomePage.module.css';

export function HomePageLeadCollectorOrganism() {
  const t = useTranslations('pages.home');

  return (
    /* Band = Section (zero-diff): ink-tło + border-top + kotwica ::before
       w className; grid = innerClassName (lp/auto daje constrained).
       data-scroll-reveal zdjęty — atrybut martwy (PublicLayout neutralizuje). */
    <SectionComposition
      className={styles.leadSection}
      innerClassName={styles.leadInner}
      aria-label={t('leadCollector.ariaLabel')}>
      <div className={styles.leadText}>
        <EyebrowAtom as='p' variant='plain' className={styles.leadEyebrow}>
          {t('leadCollector.eyebrow')}
        </EyebrowAtom>
        <h2 className={styles.leadHeadline}>{t('leadCollector.headline')}</h2>
        <p className={styles.leadBody}>{t('leadCollector.body')}</p>
      </div>
      {/* Shared NewsletterInlineForm (consent-gated, consentSource=
          'home-lead-collector'). Button disabled-pale state before consent is
          BY DESIGN — see DECISION inside the shared component. */}
      <div className={styles.leadForm}>
        <NewsletterInlineFormOrganism
          inputVariant='field'
          consentSource='home-lead-collector'
          placeholder={t('leadCollector.emailPlaceholder')}
          ctaLabel={t('leadCollector.subscribeCta')}
          successMessage={t('leadCollector.successMessage')}
          errorMessage={t('leadCollector.errorMessage')}
          privacyNote={t('leadCollector.privacyNote')}
          ctaIcon={<PaperPlaneTiltIcon size={16} />}
          consentLabel={t.rich('leadCollector.consentText', {
            privacyLink: chunks => (
              <Link
                prefetch={false}
                href={ROUTES_FRONT.PRIVACY}
                className={styles.leadConsentLink}>
                {chunks}
              </Link>
            ),
          })}
          classNames={{
            row: styles.leadFormRow,
            input: styles.leadInput,
            consent: styles.leadConsent,
            errorMessage: styles.leadError,
            privacyNote: styles.leadPrivacyNote,
            successMessage: styles.leadSuccess,
          }}
        />
      </div>
    </SectionComposition>
  );
}
