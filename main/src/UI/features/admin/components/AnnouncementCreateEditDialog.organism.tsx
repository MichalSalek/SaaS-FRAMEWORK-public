// admin/components/AnnouncementCreateEditDialog.organism.tsx
// Create / edit one announcement. Sending uses the saved row only.

import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDateTime } from '../../../../application/date/date.utils';
import { useLeaveGuard } from '../../../shared/hooks/useLeaveGuard';
import { confirmDiscardIfDirty } from '../../../../application/routing/leave-guard';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import { AnnouncementFormFieldsMolecule } from './AnnouncementFormFields.molecule';
import { AnnouncementSendButtonMolecule } from './AnnouncementSendButton.molecule';
import {
  EMPTY_ANNOUNCEMENT_FORM,
  announcementFormIssues,
  buildAnnouncementSubmitPayload,
  fromAnnouncement,
  isAnnouncementFormDirty,
} from './announcement-form.utils';
import type {
  AnnouncementFormState,
  AnnouncementSubmitPayload,
} from './announcement-form.utils';
import { announcementNotificationSendState } from './announcement-send.logic';
import styles from './AnnouncementCreateEditDialog.module.css';

interface AnnouncementCreateEditDialogProps {
  open: boolean;
  editing: AdminAnnouncement | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onSubmit: (payload: AnnouncementSubmitPayload) => void;
  onCancel: () => void;
  onSend: (announcement: AdminAnnouncement) => void;
}

export function AnnouncementCreateEditDialogOrganism({
  open,
  editing,
  isSubmitting,
  errorMessage,
  onSubmit,
  onCancel,
  onSend,
}: AnnouncementCreateEditDialogProps) {
  const t = useTranslations('admin.announcements');
  const locale = useLocale();
  const formId = useId();
  const [initial, setInitial] = useState<AnnouncementFormState>(
    EMPTY_ANNOUNCEMENT_FORM
  );
  const [form, setForm] = useState<AnnouncementFormState>(
    EMPTY_ANNOUNCEMENT_FORM
  );
  const [touched, setTouched] = useState(false);
  const [shake, setShake] = useState(false);
  const [isEdit, setIsEdit] = useState(false);

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

  const issues = announcementFormIssues(form);
  const isDirty = open && isAnnouncementFormDirty(form, initial);
  useLeaveGuard({ when: isDirty, message: t('discardDraftConfirm') });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setTouched(true);
    if (issues.length > 0) {
      setShake(true);
      return;
    }
    if (editing !== null && !isDirty) {
      onCancel();
      return;
    }
    onSubmit(buildAnnouncementSubmitPayload(form, editing));
  };

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

  const sendState =
    editing === null
      ? null
      : announcementNotificationSendState({
          saved: true,
          dirty: isDirty,
          audience_client: editing.audience_client,
          audience_stylist: editing.audience_stylist,
          notification_sent_at: editing.notification_sent_at,
        });
  const sentLabel =
    editing?.notification_sent_at != null
      ? formatDateTime(editing.notification_sent_at, locale, '')
      : null;

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
            <AnnouncementFormFieldsMolecule
              form={form}
              issues={issues}
              showErrors={touched}
              disabled={isSubmitting}
              onChange={setForm}
            />
          </form>
          {sendState !== null && (
            <>
              {editing?.notification_sent_at != null && (
                <p className={styles.datesHint}>{t('sentEditHint')}</p>
              )}
              <AnnouncementSendButtonMolecule
                state={sendState}
                sentLabel={sentLabel}
                onSend={() => {
                  if (editing !== null && sendState === 'ready') {
                    onSend(editing);
                  }
                }}
              />
            </>
          )}
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
