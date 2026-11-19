// admin/components/AnnouncementSendConfirmDialog.molecule.tsx
// Confirms one bell-and-push send. Lists the saved roles and languages.

import { useTranslations } from 'next-intl';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import {
  announcementAppRoles,
  announcementLanguageCodes,
  joinAnnouncementList,
} from './announcement-send.logic';
import styles from './AnnouncementCreateEditDialog.module.css';

const ROLE_KEY = {
  client: 'roleClient',
  stylist: 'roleStylist',
} as const;

const LANGUAGE_KEY = {
  pl: 'languagePl',
  en: 'languageEn',
  de: 'languageDe',
} as const;

interface AnnouncementSendConfirmDialogProps {
  announcement: AdminAnnouncement | null;
  errorMessage: string | null;
  isSending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AnnouncementSendConfirmDialogMolecule({
  announcement,
  errorMessage,
  isSending,
  onConfirm,
  onCancel,
}: AnnouncementSendConfirmDialogProps) {
  const t = useTranslations('admin.announcements');
  const roles =
    announcement === null
      ? ''
      : joinAnnouncementList(
          announcementAppRoles(announcement).map(role => t(ROLE_KEY[role])),
          t('listConjunction')
        );
  const languages =
    announcement === null
      ? ''
      : joinAnnouncementList(
          announcementLanguageCodes(announcement.translations).map(locale =>
            t(LANGUAGE_KEY[locale])
          ),
          t('listConjunction')
        );
  return (
    <AppDialogAtom
      open={announcement !== null}
      onOpenChange={next => {
        if (!next && !isSending) {
          onCancel();
        }
      }}
      disablePointerDismissal>
      <AppDialogAtom.Content
        title={t('sendConfirmTitle')}
        description={t('sendConfirmBody')}
        closeDisabled={isSending}>
        <AppDialogAtom.Body>
          <p className={styles.sendTitle}>{announcement?.title}</p>
          <p className={styles.datesHint}>{t('sendConfirmRoles', { roles })}</p>
          <p className={styles.datesHint}>
            {t('sendConfirmLanguages', { languages })}
          </p>
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
            onClick={onCancel}
            disabled={isSending}>
            {t('cancel')}
          </ButtonAtom>
          <ButtonAtom
            variant='primary'
            size='md'
            onClick={onConfirm}
            loading={isSending}>
            {t('sendConfirmAction')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
