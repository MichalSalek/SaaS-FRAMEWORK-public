/**
 * ContentModerationReportForm — public, anonymous report builder.
 *
 * Renders an inline DSA-style report form. Opens the user's email
 * client with a pre-filled message to the moderation team — no auth,
 * no fetch, no server-side validation needed.
 *
 * Extracted from ContentModerationPage to keep that file under the
 * 300-line cap and to make the form independently testable.
 */

import { useState } from 'react';
import type { useTranslations } from 'next-intl';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { VALIDATION_MODERATION } from '@kernel/policies/validation.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { SelectAtom } from '../../components/Select/Select.atom';
import styles from './ContentModerationPage.module.css';

/* ─── Constants ─── */

const REPORT_REASON_KEYS = [
  'illegal',
  'portrait',
  'copyright',
  'spam',
  'offensive',
  'misleading',
  'other',
] as const;

type ReportReasonKey = (typeof REPORT_REASON_KEYS)[number];

const SUPPORT_EMAIL = BRAND_CONFIG.email.support;
// DECISION (nie usuwaj tego komentarza):
// To form-builder mailto (NIE submit do API) — buduje subject/body i otwiera
// klienta poczty. Walidacja = native HTML `required` na polach + ta brama
// `canSubmit` (reason + min długość opisu). NIE migrujemy go na RHF-resolver z
// W4.2 (brak API-submit, brak JS error-state per pole). Min długości opisu
// źródłujemy z kernel SSOT (VALIDATION_MODERATION.DESCRIPTION_MIN) — bez
// lokalnego magic-numberu.
const MIN_DESCRIPTION_LENGTH = VALIDATION_MODERATION.DESCRIPTION_MIN;
// MAX też z kernel SSOT (VALIDATION_MODERATION.DESCRIPTION_MAX) — wcześniej twardy
// 2000 był 2× sankcjonowanego limitu i niweczył anty-abuse intencję kernela.
const MAX_DESCRIPTION_LENGTH = VALIDATION_MODERATION.DESCRIPTION_MAX;

/* ─── Props ─── */

export interface ContentModerationReportFormProps {
  t: ReturnType<typeof useTranslations<'pages.contentModeration'>>;
}

/* ─── Component ─── */

export function ContentModerationReportFormMolecule({
  t,
}: ContentModerationReportFormProps) {
  const [reason, setReason] = useState<ReportReasonKey | ''>('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');

  const reasonOptions = REPORT_REASON_KEYS.map(key => ({
    value: key,
    label: t(`reportForm.reasons.${key}`),
  }));

  const canSubmit =
    reason !== '' && description.trim().length >= MIN_DESCRIPTION_LENGTH;

  let mailtoHref = '';
  if (reason !== '') {
    const subject = t('reportForm.emailSubject', {
      reason: t(`reportForm.reasons.${reason}`),
    });
    const bodyLines = [
      t('reportForm.emailBody.reasonLabel') +
        ' ' +
        t(`reportForm.reasons.${reason}`),
      t('reportForm.emailBody.urlLabel') + ' ' + (url.trim() || '-'),
      '',
      t('reportForm.emailBody.descriptionLabel'),
      description.trim(),
      '',
      t('reportForm.emailBody.reporterEmailLabel') +
        ' ' +
        (email.trim() || '-'),
      '',
      t('reportForm.emailBody.footer'),
    ];
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(bodyLines.join('\n'));
    mailtoHref = `mailto:${SUPPORT_EMAIL}?subject=${encodedSubject}&body=${encodedBody}`;
  }

  return (
    <section
      id='zglos-formularz'
      className={styles.reportSection}
      aria-labelledby='report-form-heading'>
      <span className={styles.reportEyebrow}>{t('reportForm.eyebrow')}</span>
      <h2 id='report-form-heading' className={styles.reportHeading}>
        {t('reportForm.heading')}
      </h2>
      <p className={styles.reportLead}>{t('reportForm.lead')}</p>

      <form
        className={styles.reportForm}
        onSubmit={e => {
          e.preventDefault();
          if (canSubmit) {
            window.location.href = mailtoHref;
          }
        }}>
        <div className={styles.reportFieldGrid}>
          {/* Reason */}
          <div className={styles.reportField}>
            <SelectAtom
              label={t('reportForm.fields.reason.label')}
              options={reasonOptions}
              placeholder={t('reportForm.fields.reason.placeholder')}
              value={reason}
              onChange={e => setReason(e.target.value as ReportReasonKey | '')}
              required
            />
          </div>

          {/* URL */}
          <div className={styles.reportField}>
            <InputAtom
              type='text'
              label={t('reportForm.fields.url.label')}
              placeholder={t('reportForm.fields.url.placeholder')}
              value={url}
              onChange={e => setUrl(e.target.value)}
              autoComplete='off'
              autoCapitalize='none'
              spellCheck={false}
              inputMode='url'
            />
          </div>

          {/* Description — full width */}
          <div className={`${styles.reportField} ${styles.reportFieldFull}`}>
            <InputAtom
              multiline
              label={t('reportForm.fields.description.label')}
              placeholder={t('reportForm.fields.description.placeholder')}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              maxLength={MAX_DESCRIPTION_LENGTH}
              required
            />
            <p className={styles.reportHint}>
              {/* Limity z kernela, nie z tekstu: podpowiedź mówiła „2000 znaków"
                  przy maxLength 1000 i milczała o minimum, przez które przycisk
                  „Wyślij" pozostawał wyłączony bez wyjaśnienia. */}
              {t('reportForm.fields.description.hint', {
                min: MIN_DESCRIPTION_LENGTH,
                max: MAX_DESCRIPTION_LENGTH,
              })}
            </p>
          </div>

          {/* Reporter email */}
          <div className={`${styles.reportField} ${styles.reportFieldFull}`}>
            <InputAtom
              type='email'
              label={t('reportForm.fields.email.label')}
              placeholder={t('reportForm.fields.email.placeholder')}
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete='email'
              autoCapitalize='none'
              spellCheck={false}
            />
            <p className={styles.reportHint}>
              {t('reportForm.fields.email.hint')}
            </p>
          </div>
        </div>

        <div className={styles.reportActions}>
          <p className={styles.reportLegal}>{t('reportForm.legal')}</p>
          <ButtonAtom
            type='submit'
            variant='primary'
            size='lg'
            disabled={!canSubmit}
            icon={<PaperPlaneTiltIcon size={16} weight='fill' />}>
            {t('reportForm.submit')}
          </ButtonAtom>
        </div>
      </form>
    </section>
  );
}
