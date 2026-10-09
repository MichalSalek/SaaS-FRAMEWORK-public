// admin/components/UserTimelineTab.organism.tsx
// Paginated user activity for the admin user sheet, on the shared table and
// the shared pager (the endpoint knows the total, so pages go both ways).
// Mounted by the parent only while its tab is selected — that mount IS the
// laziness (the query fires on mount); no extra `enabled` flag needed.

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react';
import { formatDateTimePL } from '../../../../application/date/date.utils';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../../components/DataTable/DataTable.organism';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { PaginationMolecule } from '../../../components/Pagination/Pagination.molecule';
import { isNamespaceKey, NAMESPACE_LABEL_KEY } from '../AdminAuditPage.helpers';
import { useAdminUserTimeline } from '../hooks/useAdminUserTimeline';
import styles from './UserDetailsDialog.module.css';

export interface UserTimelineTabProps {
  userId: string;
}

type TimelineEntry = NonNullable<
  ReturnType<typeof useAdminUserTimeline>['data']
>['entries'][number];

const PAGE_SIZE = 20;

export function UserTimelineTabOrganism({ userId }: UserTimelineTabProps) {
  const t = useTranslations('admin.users');
  // Event types are the audit log's namespaces: one set of labels for both.
  const tNamespace = useTranslations('admin.audit');
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever the dialog opens for a different user
  useEffect(() => {
    setPage(1);
  }, [userId]);

  const { data, isLoading, isError, refetch, isFetching, isPlaceholderData } =
    useAdminUserTimeline({ user_id: userId, page, limit: PAGE_SIZE }, true);

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const readError = {
    message: t('timelineErrorTitle'),
    retryLabel: t('timelineRetry'),
    onRetry: () => void refetch(),
    isRetrying: isFetching,
  };

  const columns: DataTableColumn<TimelineEntry>[] = [
    {
      id: 'event',
      header: t('timelineColumnEvent'),
      priority: 'primary',
      width: 'minmax(0, 2fr)',
      cell: entry => (
        <>
          {entry.description_pl}
          <code className={`${styles.code} ${styles.cellQuiet}`}>
            {entry.event_name}
          </code>
        </>
      ),
    },
    {
      id: 'type',
      header: t('timelineColumnType'),
      priority: 'meta',
      width: '8.5rem',
      cell: entry =>
        isNamespaceKey(entry.event_type)
          ? tNamespace(NAMESPACE_LABEL_KEY[entry.event_type])
          : entry.event_type,
    },
    {
      id: 'time',
      header: t('timelineColumnTime'),
      priority: 'meta',
      width: '9.5rem',
      cell: entry => (
        <span className={styles.nowrap}>
          {formatDateTimePL(entry.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className={styles.tabStack}>
      {isError && entries.length > 0 && (
        <ErrorStateMolecule {...readError} size='inline' />
      )}
      <DataTableOrganism
        caption={t('tabTimeline')}
        columns={columns}
        rows={entries}
        rowKey={entry => entry.id}
        // A failed read is its own state; a failed refresh keeps the last rows.
        state={
          isLoading
            ? 'loading'
            : entries.length > 0
              ? 'ready'
              : isError
                ? 'error'
                : 'empty'
        }
        error={readError}
        empty={
          <EmptyStateAtom
            icon={<ClockCounterClockwiseIcon size={28} />}
            titleAs='p'
            title={t('timelineEmptyState')}
            description={t('timelineEmptyHint')}
          />
        }
        surface='flush'
        skeletonRows={5}
        footer={
          <PaginationMolecule
            mode='pages'
            ariaLabel={t('timelinePaginationAriaLabel')}
            prevLabel={t('paginationPrev')}
            nextLabel={t('paginationNext')}
            page={page}
            pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            onPageChange={setPage}
            pageLabel={n => t('timelinePage', { page: n })}
            isBusy={isPlaceholderData}
          />
        }
      />
    </div>
  );
}
