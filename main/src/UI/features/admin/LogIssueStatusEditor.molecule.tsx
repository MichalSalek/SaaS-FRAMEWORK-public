import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  LOG_ISSUE_STATUSES,
  type LogIssueDisplayStatus,
  type LogIssueStatusValue,
} from '@kernel/domain/admin/log-triage.config';
import styles from './AdminLogsPage.module.css';

export function LogIssueStatusEditorMolecule({
  fingerprint,
  status,
  note,
  isPending,
  onSetStatus,
}: {
  fingerprint: string;
  status: LogIssueDisplayStatus;
  note: string | null;
  isPending: boolean;
  onSetStatus: (input: {
    fingerprint: string;
    status: LogIssueStatusValue;
    note?: string;
  }) => void;
}) {
  const t = useTranslations('admin.logs');
  const [noteDraft, setNoteDraft] = useState(note ?? '');

  useEffect(() => {
    setNoteDraft(note ?? '');
  }, [fingerprint, note]);

  return (
    <div className={styles.statusEditor}>
      <span className={styles.panelLabel}>{t('statusPickerLabel')}</span>
      <div
        className={styles.statusPicker}
        role='group'
        aria-label={t('statusPickerLabel')}>
        {LOG_ISSUE_STATUSES.map(option => (
          <button
            key={option}
            type='button'
            className={`${styles.quickChip} ${status === option ? styles.quickChipActive : ''}`}
            aria-pressed={status === option}
            disabled={isPending}
            onClick={() =>
              onSetStatus({
                fingerprint,
                status: option,
                ...(noteDraft.trim().length > 0 && {
                  note: noteDraft.trim(),
                }),
              })
            }>
            {t(`status_${option}`)}
          </button>
        ))}
      </div>
      <input
        type='text'
        className={styles.noteInput}
        placeholder={t('notePlaceholder')}
        aria-label={t('notePlaceholder')}
        value={noteDraft}
        disabled={isPending}
        onChange={event => setNoteDraft(event.target.value)}
      />
    </div>
  );
}
