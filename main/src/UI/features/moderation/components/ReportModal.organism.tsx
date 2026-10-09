// UI/features/moderation/components/ReportModal.tsx
// Report-content modal. Opens for a logged-in viewer who wants to flag
// a gallery record. Posts to /api/v1/gallery/report (handled by the
// useReportGalleryRecord hook).
// Stack: AppDialog primitive + Base UI + TanStack Query.

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FlagIcon } from '@phosphor-icons/react';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { ContentReportReason } from '@kernel/models/moderation/moderation.dto';
import { ContentReportReasonValue } from '@kernel/models/db_models.generated.dto';
import { isIOError } from '../../../../application/http/toPromise.adapter';
import { useReportGalleryRecord } from '../hooks/useReportGalleryRecord';
import styles from './ReportModal.module.css';

const MAX_DESCRIPTION_LENGTH = 1000;

// DECISION (nie usuwaj tego komentarza):
// Translation keys są lowercase (i18n stability — locale files mapują 'inappropriate',
// 'face', 'spam', 'other'). API reason values są UPPERCASE (Prisma enum, SSOT po F1).
// REASON_OPTIONS to mostek display → wire value.
const REASON_OPTIONS = [
  { key: 'inappropriate', value: ContentReportReasonValue.INAPPROPRIATE },
  { key: 'face', value: ContentReportReasonValue.FACE },
  { key: 'spam', value: ContentReportReasonValue.SPAM },
  { key: 'other', value: ContentReportReasonValue.OTHER },
] as const;
type ReasonKey = (typeof REASON_OPTIONS)[number]['key'];

/* --- Props --- */

export interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  galleryRecordId: string;
  onSuccess?: () => void;
}

/* --- Component --- */

export function ReportModalOrganism({
  open,
  onClose,
  galleryRecordId,
  onSuccess,
}: ReportModalProps) {
  const t = useTranslations('moderation.report');

  const reasonGroupId = useId();
  const descriptionId = useId();

  const [reason, setReason] = useState<ContentReportReason | null>(null);
  const [description, setDescription] = useState<string>('');
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  const mutation = useReportGalleryRecord();

  // Reset state every time the modal re-opens
  useEffect(() => {
    if (open) {
      setReason(null);
      setDescription('');
      setGeneralError(null);
      setShake(false);
    }
  }, [open]);

  const isSubmitting = mutation.isPending;
  const isSelected = (value: ContentReportReason) => reason === value;
  const canSubmit =
    reason !== null && !isSubmitting && galleryRecordId.length > 0;

  const handleSubmit = () => {
    if (!canSubmit || reason === null) {
      return;
    }
    setGeneralError(null);

    const trimmedDescription = description.trim();

    mutation.mutate(
      {
        gallery_record_id: galleryRecordId,
        reason,
        ...(trimmedDescription.length > 0
          ? { description: trimmedDescription }
          : {}),
      },
      {
        // DECISION (nie usuwaj tego komentarza): ZERO lokalnego snackbara
        // success/error — warstwa 1 (HTTP interceptor) jest właścicielem toasta.
        // reportGalleryRecord_IO nie ustawia silentBusinessError, więc backendowy
        // event (INFO.GALLERY.CONTENT_REPORTED na sukcesie; REPORT_RATE_LIMITED /
        // CANNOT_REPORT_CONTENT / CONTENT_REPORT_SELF_REPORT na błędzie — żaden nie
        // jest w eventsDisallowedForUI, wszystkie mają klucz w events.json) zawsze
        // się toastuje. Lokalny pushNewSnackbar(t('successToast')/message) = INNY
        // string → Sonner id nie łapie → DWA toasty (klasa S74/S75).
        // Zostaje TYLKO inline setGeneralError (tekst w modalu, nie snackbar).
        onSuccess: () => {
          onSuccess?.();
          onClose();
        },
        onError: error => {
          // Map the backend error envelope (error.httpError.event) to a specific,
          // actionable INLINE message (rate-limited / duplicate-pending / self-
          // report); the snackbar itself is owned by the interceptor (see above).
          const event = isIOError(error) ? error.httpError.event : null;
          const message =
            event === APP_EVENTS.INFO.GALLERY.REPORT_RATE_LIMITED
              ? t('errorRateLimited')
              : event === APP_EVENTS.INFO.GALLERY.CANNOT_REPORT_CONTENT
                ? t('errorDuplicatePending')
                : event === APP_EVENTS.INFO.GALLERY.CONTENT_REPORT_SELF_REPORT
                  ? t('errorSelfReport')
                  : t('errorToast');
          setGeneralError(message);
          setShake(true);
        },
      }
    );
  };

  return (
    <AppDialogAtom
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen && !isSubmitting) {
          onClose();
        }
      }}>
      <AppDialogAtom.Content title={t('title')} description={t('description')}>
        <form
          className={styles.form}
          onSubmit={e => {
            e.preventDefault();
            handleSubmit();
          }}>
          <AppDialogAtom.Body>
            <div className={styles.form}>
              <fieldset
                className={styles.fieldset}
                disabled={isSubmitting}
                aria-labelledby={reasonGroupId}>
                <TypographyAtom
                  variant='caption'
                  id={reasonGroupId}
                  className={styles.legend}>
                  {t('reasonLabel')}
                </TypographyAtom>
                <ul className={styles.reasonList} role='radiogroup'>
                  {REASON_OPTIONS.map(opt => (
                    <li key={opt.key} className={styles.reasonItem}>
                      <label
                        className={styles.reasonLabel}
                        htmlFor={`report-reason-${opt.key}`}>
                        <input
                          id={`report-reason-${opt.key}`}
                          type='radio'
                          name='report-reason'
                          value={opt.value}
                          checked={isSelected(opt.value)}
                          onChange={() => setReason(opt.value)}
                          className={styles.reasonRadio}
                        />
                        <span className={styles.reasonTitle}>
                          {t(`reasons.${opt.key satisfies ReasonKey}.label`)}
                        </span>
                        <span className={styles.reasonDesc}>
                          {t(
                            `reasons.${opt.key satisfies ReasonKey}.description`
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>

              <div className={styles.descriptionWrap}>
                <label
                  htmlFor={descriptionId}
                  className={styles.descriptionLabel}>
                  {t('additionalLabel')}
                </label>
                <textarea
                  id={descriptionId}
                  className={styles.textarea}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  maxLength={MAX_DESCRIPTION_LENGTH}
                  rows={4}
                  placeholder={t('placeholder')}
                  disabled={isSubmitting}
                />
                <span className={styles.charCounter} aria-live='polite'>
                  {description.length} / {MAX_DESCRIPTION_LENGTH}
                </span>
              </div>

              {generalError !== null && (
                <TypographyAtom
                  variant='body2'
                  className={styles.errorText}
                  role='alert'>
                  {generalError}
                </TypographyAtom>
              )}
            </div>
          </AppDialogAtom.Body>

          <AppDialogAtom.Actions>
            <ButtonAtom
              type='button'
              variant='text'
              size='md'
              onClick={() => {
                if (!isSubmitting) {
                  onClose();
                }
              }}
              disabled={isSubmitting}>
              {t('cancel')}
            </ButtonAtom>
            <ButtonAtom
              type='submit'
              variant='primary'
              size='md'
              icon={<FlagIcon size={16} />}
              shake={shake}
              onShakeEnd={() => setShake(false)}
              disabled={!canSubmit}>
              {isSubmitting ? t('submitting') : t('submit')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </form>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
