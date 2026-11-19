// UI/features/admin/AdminLogGroups.organism.tsx
// Error-class view: one row per fingerprint, on the shared table (from 768px of its own width a
// table, narrower a card per group). The message stands first and is never cut; a row opens the
// entry details.

import { useTranslations } from 'next-intl';
import { isLogIssueNeedingReaction } from '@kernel/domain/admin/log-triage.config';
import type { LogIssueGroup } from '@kernel/models/admin/admin-logs.dto';
import { formatTimestampPL } from '../../../application/date/date.utils';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../components/DataTable/DataTable.organism';
import {
  LogMessageMolecule,
  LogNamespaceMolecule,
  TypeBadgeMolecule,
} from './AdminLogsPage.parts.molecule';
import styles from './AdminLogsPage.module.css';
import { logApplicationLabel } from './log-origin.labels';

type GroupsProps = {
  groups: readonly LogIssueGroup[];
  isLoading: boolean;
  /** The aggregation returns a limited number of groups: tells that the list is cut. */
  truncatedInfo: { shown: number; total: number } | null;
  onOpenLog: (id: string) => void;
  /** Accessible name of the table; defaults to the view name. */
  caption?: string;
  /** Text of the empty list; defaults to „no groups match the filters". */
  emptyLabel?: string;
};

export function AdminLogGroupsOrganism({
  groups,
  isLoading,
  truncatedInfo,
  onOpenLog,
  caption,
  emptyLabel,
}: GroupsProps) {
  const t = useTranslations('admin.logs');

  // DECISION: group status is ONE word in the row (red only where a reaction waits); setting a
  // status with a note lives in the entry details (the row opens them, "Group" section). A second
  // place in an expandable row panel needed its own button in the cell and did not fit the phone
  // card.
  const columns: DataTableColumn<LogIssueGroup>[] = [
    {
      id: 'message',
      header: t('columnMessage'),
      priority: 'primary',
      width: 'minmax(0, 2fr)',
      cell: group => (
        <>
          <LogMessageMolecule text={group.sample_message} />
          {group.note ? (
            <span className={styles.cellQuiet}>{group.note}</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'namespace',
      header: t('columnNamespace'),
      priority: 'secondary',
      cell: group => (
        <>
          <LogNamespaceMolecule value={group.namespace} />
          <span className={styles.cellQuiet}>
            {logApplicationLabel(group.application, t)}
          </span>
        </>
      ),
    },
    {
      id: 'status',
      header: t('columnStatus'),
      priority: 'meta',
      // Fits the longest status word („naprawiony”, „ignorowany”).
      width: '7rem',
      cell: group => (
        <span
          className={styles.statusWord}
          data-action={isLogIssueNeedingReaction(group.status)}>
          {t(`status_${group.status}`)}
        </span>
      ),
    },
    {
      id: 'type',
      header: t('columnType'),
      priority: 'meta',
      // Fits the longest type pill (icon + „ostrzeżenie” / „Information”).
      width: '9rem',
      cell: group => <TypeBadgeMolecule type={group.type} />,
    },
    {
      id: 'count',
      header: t('columnOccurrences'),
      priority: 'meta',
      align: 'end',
      width: '6rem',
      labelInCard: true,
      cell: group => group.count.toLocaleString('pl-PL'),
    },
    {
      id: 'lastSeen',
      header: t('columnLastSeen'),
      priority: 'meta',
      width: '9.5rem',
      labelInCard: true,
      cell: group => (
        <span className={styles.nowrap}>
          {formatTimestampPL(group.last_seen)}
        </span>
      ),
    },
  ];

  return (
    <DataTableOrganism
      caption={caption ?? t('viewGroups')}
      columns={columns}
      rows={groups}
      rowKey={group => group.fingerprint}
      rowLabel={() => t('openLogAria')}
      onRowClick={group => onOpenLog(group.sample_id)}
      state={isLoading ? 'loading' : groups.length === 0 ? 'empty' : 'ready'}
      empty={emptyLabel ?? t('noGroups')}
      {...(truncatedInfo !== null && {
        footer: (
          <p className={styles.listNote}>
            {t('groupsTruncated', truncatedInfo)}
          </p>
        ),
      })}
    />
  );
}
