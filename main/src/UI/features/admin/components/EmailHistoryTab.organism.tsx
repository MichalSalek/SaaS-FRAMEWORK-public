// admin/components/EmailHistoryTab.organism.tsx
// Lazy-fetched email history for a user, on the shared table.
// Mounted by the parent only while its tab is selected — that mount IS the
// laziness (the query fires on mount); no extra `enabled` flag needed.
// The endpoint returns the whole history in one read: there is nothing to page.

import { EnvelopeSimpleIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { EMAIL_CATEGORY } from '@kernel/domain/email/email-schedule.config';
import { formatDateTimePL } from '../../../../application/date/date.utils';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../../components/DataTable/DataTable.organism';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import { describeAdminEvent } from '../AdminAuditPage.helpers';
import { useAdminEmailHistory } from '../hooks/useAdminEmailHistory';
import { SoftBreakTextAtom } from '../../../components/SoftBreakText/SoftBreakText.atom';
import styles from './UserDetailsDialog.module.css';

export interface EmailHistoryTabProps {
  userId: string;
}

// The response carries no id and two mails may share an event and an instant:
// the position in the read is the row's key.
type EmailEntry = NonNullable<
  ReturnType<typeof useAdminEmailHistory>['data']
>['emails'][number] & { rowId: string };

// Which kind of mail it was: transactional is plain information, the trial
// sequence is the one a reaction is expected from, marketing stays neutral.
const CATEGORY_COLOR: Record<string, string> = {
  [EMAIL_CATEGORY.TRANSACTIONAL]: 'var(--color-info)',
  [EMAIL_CATEGORY.TRIAL_SEQUENCE]: 'var(--color-warning)',
  [EMAIL_CATEGORY.MARKETING]: 'var(--color-text-primary)',
};

const isKnownCategory = (value: string): value is keyof typeof EMAIL_CATEGORY =>
  Object.prototype.hasOwnProperty.call(EMAIL_CATEGORY, value);

export function EmailHistoryTabOrganism({ userId }: EmailHistoryTabProps) {
  const t = useTranslations('admin.emailHistory');
  const tCategory = useTranslations('admin.emailSchedule.category');
  const { data, isLoading, isError, refetch, isFetching } =
    useAdminEmailHistory(userId, true);

  const emails: EmailEntry[] = (data?.emails ?? []).map((entry, index) => ({
    ...entry,
    rowId: String(index),
  }));
  const readError = {
    message: t('errorTitle'),
    retryLabel: t('retry'),
    onRetry: () => void refetch(),
    isRetrying: isFetching,
  };

  const columns: DataTableColumn<EmailEntry>[] = [
    {
      id: 'event',
      header: t('columns.event'),
      priority: 'primary',
      width: 'minmax(0, 2fr)',
      cell: entry => {
        const sentence = describeAdminEvent(entry.event);
        return sentence === null ? (
          <code className={styles.code}>
            <SoftBreakTextAtom>{entry.event}</SoftBreakTextAtom>
          </code>
        ) : (
          <>
            {sentence}
            <code className={`${styles.code} ${styles.cellQuiet}`}>
              {entry.event}
            </code>
          </>
        );
      },
    },
    {
      id: 'category',
      header: t('columns.category'),
      priority: 'meta',
      width: '10rem',
      cell: entry => (
        <StatusPillAtom
          color={
            CATEGORY_COLOR[entry.category] ?? 'var(--color-text-secondary)'
          }
          label={
            isKnownCategory(entry.category)
              ? tCategory(entry.category)
              : entry.category
          }
          showDot={false}
        />
      ),
    },
    {
      id: 'sentAt',
      header: t('columns.sentAt'),
      priority: 'meta',
      width: '9.5rem',
      cell: entry => (
        <span className={styles.nowrap}>{formatDateTimePL(entry.sentAt)}</span>
      ),
    },
  ];

  return (
    <div className={styles.tabStack}>
      {isError && emails.length > 0 && (
        <ErrorStateMolecule {...readError} size='inline' />
      )}
      <DataTableOrganism
        caption={t('caption')}
        columns={columns}
        rows={emails}
        rowKey={entry => entry.rowId}
        // A failed read is its own state; a failed refresh keeps the last rows.
        state={
          isLoading
            ? 'loading'
            : emails.length > 0
              ? 'ready'
              : isError
                ? 'error'
                : 'empty'
        }
        error={readError}
        empty={
          <EmptyStateAtom
            icon={<EnvelopeSimpleIcon size={28} />}
            titleAs='p'
            title={t('emptyState')}
            description={t('emptyHint')}
          />
        }
        surface='flush'
        skeletonRows={4}
      />
    </div>
  );
}
