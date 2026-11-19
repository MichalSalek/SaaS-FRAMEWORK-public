import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import { announcementTranslation } from '@kernel/domain/admin/announcement-content';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import styles from './AnnouncementCreateEditDialog.module.css';

const LANGUAGE_KEY = {
  pl: 'languagePl',
  en: 'languageEn',
  de: 'languageDe',
} as const;

export interface AnnouncementTestTarget {
  announcement: AdminAnnouncement;
  locale: LocaleType;
}

export function AnnouncementTestConfirmDialogMolecule({
  target,
  errorMessage,
  isSending,
  onConfirm,
  onCancel,
  resultFocus,
}: {
  target: AnnouncementTestTarget | null;
  errorMessage: string | null;
  isSending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  resultFocus: RefObject<HTMLDivElement | null> | undefined;
}) {
  const t = useTranslations('admin.announcements');
  const title =
    target === null
      ? ''
      : (announcementTranslation(
          target.announcement.translations,
          target.locale
        )?.title ?? '');
  return (
    <AppDialogAtom
      open={target !== null}
      onOpenChangeComplete={open => {
        if (!open) {
          resultFocus?.current?.scrollIntoView({
            block: 'center',
            behavior: 'instant',
          });
        }
      }}
      onOpenChange={open => {
        if (!open && !isSending) {
          onCancel();
        }
      }}
      disablePointerDismissal>
      <AppDialogAtom.Content
        title={t('testConfirmTitle')}
        description={t('testConfirmBody')}
        closeDisabled={isSending}
        finalFocus={resultFocus ?? true}>
        <AppDialogAtom.Body>
          <p className={styles.sendTitle} lang={target?.locale}>
            {title}
          </p>
          {target !== null && (
            <p className={styles.datesHint}>
              {t('testConfirmLanguage', {
                language: t(LANGUAGE_KEY[target.locale]),
              })}
            </p>
          )}
          {errorMessage !== null && (
            <CompletionLineMolecule state='error' message={errorMessage} />
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
            loading={isSending}
            disabled={isSending}>
            {t('testConfirmAction')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
