// admin/components/UsersTable.organism.tsx
// The users list on the shared table: from 768px of its own width a real
// table (sortable headers, row checkboxes, the bulk bar above the header),
// below it one card per person. The person stands first and is never cut;
// a row opens the user's details.

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminUserRecord } from '../hooks/useAdminUsers';
import {
  getPlanClass,
  getStatusInfo,
  type AdminUserStatusKey,
  type SortDir,
  type SortKey,
} from './UsersTable.helpers';
import { getPlanDisplayName } from '@kernel/domain/pricing/pricing.config';
import { formatDateShortPL } from '../../../../application/date/date.utils';
import {
  SORTABLE_KEYS,
  adminUserDisplayName,
  adminUserRoleLabelKey,
} from '../AdminUsersPage.helpers';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../../components/DataTable/DataTable.organism';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { PaginationMolecule } from '../../../components/Pagination/Pagination.molecule';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import { SoftBreakTextAtom } from '../../../components/SoftBreakText/SoftBreakText.atom';
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
  pagination,
}: UsersTableProps) {
  const t = useTranslations('admin.users');

  const statusLabel: Record<AdminUserStatusKey, string> = {
    Disabled: t('statusDisabled'),
    Trial: t('statusTrial'),
    Active: t('statusActive'),
  };
  // `||` nie `??`: name z DB-default '' jest truthy-absent (klasa S67a) — bez
  // tego nazwa dostępna wiersza i checkboxa kończyła się pustką zamiast e-maila.
  const personName = (user: AdminUserRecord) => user.name?.trim() || user.email;

  // DECISION (nie usuwaj tego komentarza):
  // Sortowalne są TYLKO kolumny z własnym polem `sort_by` po stronie backendu
  // (SORTABLE_KEYS, wyprowadzone z SORT_KEY_MAP). Pozostałe spadają na
  // sort_by='id', więc aktywny znacznik i aria-sort kłamałyby o kolejności.
  // Kolumny „Ostatnie logowanie” nie ma: wymaga osobnego zapytania po
  // Session.createdAt (`sessions: { select: { id } }` w liście było N+1), a
  // kolumna pokazywała w każdym wierszu pustą kreskę. Wróci razem z danymi.
  const columns: DataTableColumn<AdminUserRecord>[] = [
    {
      id: 'name',
      header: t('columnName'),
      priority: 'primary',
      width: 'minmax(0, 1.2fr)',
      sortable: SORTABLE_KEYS.has('name'),
      cell: user => adminUserDisplayName(user.name, t('nameEmpty')),
    },
    {
      id: 'email',
      header: t('columnEmail'),
      priority: 'secondary',
      width: 'minmax(0, 1.5fr)',
      sortable: SORTABLE_KEYS.has('email'),
      cell: user => <SoftBreakTextAtom>{user.email}</SoftBreakTextAtom>,
    },
    {
      id: 'role',
      header: t('columnRole'),
      priority: 'meta',
      width: '8rem',
      cell: user => {
        const roleKey = adminUserRoleLabelKey(user);
        return roleKey ? t(roleKey) : user.account_type;
      },
    },
    {
      id: 'plan',
      header: t('columnPlan'),
      priority: 'meta',
      width: '5.5rem',
      cell: user => {
        const plan = user.stylist_account?.pricing_plan ?? null;
        return plan ? (
          <span className={`${styles.planBadge} ${getPlanClass(plan)}`}>
            {getPlanDisplayName(plan)}
          </span>
        ) : null;
      },
    },
    {
      id: 'status',
      header: t('columnStatus'),
      priority: 'meta',
      width: '7rem',
      cell: user => {
        const status = getStatusInfo(user);
        return (
          <StatusPillAtom
            color={status.color}
            label={statusLabel[status.label]}
          />
        );
      },
    },
    {
      id: 'createdAt',
      header: t('columnCreated'),
      priority: 'meta',
      width: '7rem',
      labelInCard: true,
      sortable: SORTABLE_KEYS.has('createdAt'),
      cell: user => formatDateShortPL(user.createdAt),
    },
  ];

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
