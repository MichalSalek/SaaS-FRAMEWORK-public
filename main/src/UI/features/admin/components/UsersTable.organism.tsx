// admin/components/UsersTable.organism.tsx
// The users list on the shared table: from 768px of its own width a real
// table (sortable headers, row checkboxes, the bulk bar above the header),
// below it one card per person. The person stands first and is never cut;
// a row opens the user's details.

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import type {
  AdminUserRecord,
  AdminUsersRequest,
} from '../hooks/useAdminUsers';
import { useUsersCsvExport } from '../hooks/useUsersCsvExport';
import { USERS_CSV_ROW_CAP } from '../users-csv';
import type { SortDir, SortKey } from './UsersTable.helpers';
import { SORTABLE_KEYS } from '../AdminUsersPage.helpers';
import { DataTableOrganism } from '../../../components/DataTable/DataTable.organism';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { PaginationMolecule } from '../../../components/Pagination/Pagination.molecule';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { useDataTableColumns } from '../../../components/DataTable/useDataTableColumns';
import {
  USERS_TABLE_ID,
  buildUsersTableColumns,
} from './UsersTable.columns.config';
import styles from '../AdminUsersPage.module.css';

export type { SortKey, SortDir } from './UsersTable.helpers';

export interface UsersTableProps {
  users: AdminUserRecord[];
  isLoading: boolean;
  isError: boolean;
  selected: Set<string>;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
  onRowClick: (user: AdminUserRecord) => void;
  allOnPageSelected: boolean;
  onRetry: () => void;
  isRetrying: boolean;
  /** Text of the empty list; defaults to the generic „no users". */
  emptyLabel?: string;
  /** Bulk actions for the checked rows (table layout only). */
  bulkBar: ReactNode;
  /** The list's filters and sort, for „Eksportuj CSV” (every page, not this one). */
  exportRequest: AdminUsersRequest;
  pagination: {
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
    isBusy: boolean;
  };
}

export function UsersTableOrganism({
  users,
  isLoading,
  isError,
  selected,
  sortKey,
  sortDir,
  onSort,
  onToggleOne,
  onToggleAll,
  onRowClick,
  allOnPageSelected,
  onRetry,
  isRetrying,
  emptyLabel,
  bulkBar,
  exportRequest,
  pagination,
}: UsersTableProps) {
  const t = useTranslations('admin.users');
  const locale = useLocale();

  // `||` not `??`: name from a DB-default '' is falsy-but-not-nullish; without this the accessible name
  // of the row and checkbox ended up empty instead of the e-mail.
  const personName = (user: AdminUserRecord) => user.name?.trim() || user.email;

  // DECISION: only columns with their own backend `sort_by` field are sortable (SORTABLE_KEYS,
  // derived from SORT_KEY_MAP); the rest fall back to sort_by='id', so an active marker and
  // aria-sort would lie about the order. „Ostatnie logowanie” reads `users.last_login_at` (stamped
  // at sign-in, SCHEMA_DECISIONS.md#user-last-login-at), never a per-row Session query (that was
  // N+1). The analysis figures arrive per page in `stats`. Definitions: UsersTable.columns.config.tsx.
  const columns = buildUsersTableColumns(t, locale);
  // The same stored choice the table reads: the file has the columns on screen.
  const { visibleIds } = useDataTableColumns(USERS_TABLE_ID, columns);
  const csvExport = useUsersCsvExport(exportRequest, columns, visibleIds);

  const error = {
    message: t('loadError'),
    retryLabel: t('retry'),
    onRetry,
    isRetrying,
  };
  // An empty last read under a failed refresh is unconfirmed: the error with
  // retry, never „no users”. With rows on screen the retry stands above them.
  const hasRows = users.length > 0;

  return (
    <>
      {isError && hasRows && !isLoading && <ErrorStateMolecule {...error} />}
      {csvExport.isError && (
        <ErrorStateMolecule
          size='inline'
          message={t('exportError')}
          retryLabel={t('retry')}
          onRetry={csvExport.run}
          isRetrying={csvExport.isRunning}
        />
      )}
      {csvExport.isCapped && (
        <p className={styles.exportNote} role='status'>
          {t('exportCapped', { count: USERS_CSV_ROW_CAP })}
        </p>
      )}
      <DataTableOrganism
        caption={t('pageTitle')}
        columns={columns}
        rows={users}
        rowKey={user => user.id}
        rowLabel={user => `${t('detailsDialogTitle')}: ${personName(user)}`}
        onRowClick={onRowClick}
        state={
          isLoading
            ? 'loading'
            : isError && !hasRows
              ? 'error'
              : hasRows
                ? 'ready'
                : 'empty'
        }
        error={error}
        empty={emptyLabel ?? t('noUsers')}
        sort={{
          columnId: sortKey,
          direction: sortDir,
          onSort: columnId => {
            const key = [...SORTABLE_KEYS].find(
              candidate => candidate === columnId
            );
            if (key !== undefined) {
              onSort(key);
            }
          },
        }}
        toolbarActions={
          <ButtonAtom
            variant='outlined'
            size='sm'
            icon={<DownloadSimpleIcon weight='bold' />}
            loading={csvExport.isRunning}
            disabled={csvExport.isRunning}
            onClick={csvExport.run}>
            {t('exportCsv')}
          </ButtonAtom>
        }
        columnVisibility={{
          tableId: USERS_TABLE_ID,
          label: t('columnsMenu'),
          resetLabel: t('columnsReset'),
        }}
        selection={{
          isSelected: user => selected.has(user.id),
          onToggle: user => onToggleOne(user.id),
          allSelected: allOnPageSelected,
          onToggleAll,
          rowLabel: user => t('selectUser', { name: personName(user) }),
          allLabel: t('selectAllOnPage'),
          bar: bulkBar,
        }}
        footer={
          <PaginationMolecule
            mode='cursor'
            ariaLabel={t('paginationAriaLabel')}
            prevLabel={t('paginationPrev')}
            nextLabel={t('paginationNext')}
            {...pagination}
          />
        }
      />
    </>
  );
}
