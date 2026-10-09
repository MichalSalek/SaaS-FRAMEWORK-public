// admin/components/AnnouncementCreateEditDialog.organism.tsx
// Create / edit one announcement.

import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { CheckboxAtom } from '../../../components/Checkbox/Checkbox.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { SelectAtom } from '../../../components/Select/Select.atom';
import { useLeaveGuard } from '../../../shared/hooks/useLeaveGuard';
import { confirmDiscardIfDirty } from '../../../../application/routing/leave-guard';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import {
  ANNOUNCEMENT_TYPE_OPTIONS,
  EMPTY_ANNOUNCEMENT_FORM,
  buildAnnouncementSubmitPayload,
  fromAnnouncement,
  isAnnouncementFormDirty,
  validateAnnouncementForm,
} from './announcement-form.utils';
import type {
  AnnouncementFormState,
  AnnouncementSubmitPayload,
} from './announcement-form.utils';
import styles from './AnnouncementCreateEditDialog.module.css';

interface AnnouncementCreateEditDialogProps {
  open: boolean;
  editing: AdminAnnouncement | null;
  isSubmitting: boolean;
  /** The last save failed: shown next to the buttons until the next try. */
  errorMessage: string | null;
  onSubmit: (payload: AnnouncementSubmitPayload) => void;
  onCancel: () => void;
}

export function AnnouncementCreateEditDialogOrganism({
  open,
  editing,
  isSubmitting,
  errorMessage,
  onSubmit,
  onCancel,
}: AnnouncementCreateEditDialogProps) {
  const t = useTranslations('admin.announcements');
  const formId = useId();
  const startId = useId();
  const endId = useId();
  const datesErrorId = useId();
  const [initial, setInitial] = useState<AnnouncementFormState>(
    EMPTY_ANNOUNCEMENT_FORM
  );
  const [form, setForm] = useState<AnnouncementFormState>(
    EMPTY_ANNOUNCEMENT_FORM
  );
  const [touched, setTouched] = useState(false);
  const [shake, setShake] = useState(false);
  // Frozen while the dialog is open: the title must not flip to „new” while
  // the dialog of a finished edit is still closing.
  const [isEdit, setIsEdit] = useState(false);

  // Reset form whenever the dialog (re)opens or editing target changes.
  useEffect(() => {
    if (!open) {
      return;
    }
    const next = editing ? fromAnnouncement(editing) : EMPTY_ANNOUNCEMENT_FORM;
    setInitial(next);
    setForm(next);
    setTouched(false);
    setIsEdit(editing !== null);
  }, [open, editing]);

  const errors = validateAnnouncementForm(form, t);
  const hasErrors = Object.keys(errors).length > 0;
  const isDirty = open && isAnnouncementFormDirty(form, initial);
  useLeaveGuard({ when: isDirty, message: t('discardDraftConfirm') });

  const handleChange = <K extends keyof AnnouncementFormState>(
    key: K,
    value: AnnouncementFormState[K]
  ) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setTouched(true);
    if (hasErrors) {
      setShake(true);
      return;
    }
    onSubmit(buildAnnouncementSubmitPayload(form, editing));
  };

  // Closing mid-save dropped the form: on a failed save the admin was left
  // with an error and nothing to retry. The dialog holds until it settles,
  // and an edited form asks before it is thrown away.
  const requestClose = () => {
    if (isSubmitting) {
      return;
    }
    void confirmDiscardIfDirty(isDirty, t('discardDraftConfirm')).then(
      discard => {
        if (discard) {
          onCancel();
        }
      }
    );
  };

  const datesError = touched ? errors.dates : undefined;

  return (
    <AppDialogAtom
      open={open}
      onOpenChange={next => {
        if (!next) {
          requestClose();
        }
      }}
      disablePointerDismissal>
      <AppDialogAtom.Content
        title={isEdit ? t('editTitle') : t('createTitle')}
        closeDisabled={isSubmitting}
        className={styles.dialog}>
        <AppDialogAtom.Body>
          <form
            id={formId}
            className={styles.form}
            onSubmit={handleSubmit}
            noValidate>
            <InputAtom
              label={t('fieldTitle')}
              value={form.title}
              disabled={isSubmitting}
              onChange={e => handleChange('title', e.target.value)}
              error={touched ? errors.title : undefined}
            />
            <InputAtom
              multiline
              label={t('fieldContent')}
              value={form.message}
              disabled={isSubmitting}
              rows={6}
              onChange={e => handleChange('message', e.target.value)}
              error={touched ? errors.message : undefined}
            />
            <SelectAtom
              label={t('fieldType')}
              value={form.type}
              disabled={isSubmitting}
              onChange={e => {
                const picked = ANNOUNCEMENT_TYPE_OPTIONS.find(
                  option => option.value === e.target.value
                );
                if (picked !== undefined) {
                  handleChange('type', picked.value);
                }
              }}
              options={ANNOUNCEMENT_TYPE_OPTIONS.map(option => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
            />

            <fieldset className={styles.dates}>
              <legend className={styles.datesLegend}>
                {t('fieldDateRange')}
              </legend>
              <div className={styles.datesRow}>
                <InputAtom
                  id={startId}
                  type='date'
                  className={styles.dateField}
                  label={t('fieldStartDate')}
                  value={form.starts_at}
                  disabled={isSubmitting}
                  onChange={e => handleChange('starts_at', e.target.value)}
                  aria-invalid={datesError !== undefined}
                  aria-describedby={
                    datesError !== undefined ? datesErrorId : undefined
                  }
                />
                <InputAtom
                  id={endId}
                  type='date'
                  className={styles.dateField}
                  label={t('fieldEndDate')}
                  value={form.ends_at}
                  disabled={isSubmitting}
                  onChange={e => handleChange('ends_at', e.target.value)}
                  aria-invalid={datesError !== undefined}
                  aria-describedby={
                    datesError !== undefined ? datesErrorId : undefined
                  }
                />
              </div>
              <p className={styles.datesHint}>{t('fieldDateRangeHint')}</p>
              {datesError !== undefined && (
                <p id={datesErrorId} className={styles.formError} role='alert'>
                  {datesError}
                </p>
              )}
            </fieldset>

            <CheckboxAtom
              label={t('fieldVisibilityActive')}
              checked={form.is_active}
              disabled={isSubmitting}
              onChange={e => handleChange('is_active', e.target.checked)}
            />
          </form>
          {errorMessage !== null && (
            <p className={styles.formError} role='alert'>
              {errorMessage}
            </p>
          )}
        </AppDialogAtom.Body>

        <AppDialogAtom.Actions>
          <ButtonAtom
            variant='outlined'
            size='md'
            onClick={requestClose}
            disabled={isSubmitting}>
            {t('cancel')}
          </ButtonAtom>
          <ButtonAtom
            type='submit'
            form={formId}
            variant='primary'
            size='md'
            loading={isSubmitting}
            shake={shake}
            onShakeEnd={() => setShake(false)}>
            {isEdit ? t('saveChanges') : t('create')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
