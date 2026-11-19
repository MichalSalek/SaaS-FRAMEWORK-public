// UI/features/admin/AdminUsersPage.tsx
// Admin Users — cursor-paginated list with filters, bulk actions, user details dialog.
// Sub-components: components/UsersFilterBar, UsersTable, UsersBulkActionsBar,
//                 UserDetailsDialog. Helpers: AdminUsersPage.helpers.
//
// DECISION: the TODAY layout won the owner vote: title block, filters, list, pagination,
// details panel. The list stands on the shared primitives (DataTable, Pagination, FilterBar)
// because a table cut off at the phone's right edge was a defect measured independently of the
// vote. Bulk actions (checkboxes and bar) exist only in the table layout, as before: phones never
// had them. (owner)

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { UsersThreeIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useAdminUsers, type AdminUserRecord } from './hooks/useAdminUsers';
import { useBulkEnable } from './hooks/useBulkEnable';
import { useBulkDisable } from './hooks/useBulkDisable';
import { useBulkChangePlan } from './hooks/useBulkChangePlan';
import { useBulkLogout } from './hooks/useBulkLogout';
import { UsersFilterBarOrganism } from './components/UsersFilterBar.organism';
import { UsersBulkActionsBarOrganism } from './components/UsersBulkActionsBar.organism';
import {
  UsersTableOrganism,
  type SortKey,
} from './components/UsersTable.organism';
import { UserDetailsDialogOrganism } from './components/UserDetailsDialog.organism';
import {
  HeroCountPillAtom,
  HeroCountPillRowAtom,
} from '../../components/HeroCountPill/HeroCountPill.atom';
import {
  ADMIN_USERS_URL_CODEC,
  INITIAL_FILTERS,
  buildRequest,
  nextSort,
  type FilterState,
} from './AdminUsersPage.helpers';
import { useUrlSyncedState } from '../../shared/hooks/useUrlSyncedState';
import { UsersAttentionScopeMolecule } from './components/UsersAttentionScope.molecule';
import { UsersTileScopeMolecule } from './components/UsersTileScope.molecule';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import styles from './AdminUsersPage.module.css';

/* ─── Main feature component ─── */

export function AdminUsersPageComposition() {
  const t = useTranslations('admin.users');
  /* State */
  // Filters, sort and the open user live in the address: „Wróć do siebie" after impersonation
  // returns exactly here (application/auth/identity-switch.ts), and a log link opens a specific user.
  const [view, setView, isUrlReady] = useUrlSyncedState(ADMIN_USERS_URL_CODEC);
  const { filters, sortKey, sortDir } = view;
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const cursorHistoryRef = useRef<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The record is kept apart from the id in the address: the drawer does not vanish when the user
  // drops out of the current list page (pagination, a background filter change).
  const [detailRecord, setDetailRecord] = useState<AdminUserRecord | null>(
    null
  );

  /* Query — held until the address is first read (no double fetch) */
  // `view` carries the counter scope (attention, registeredFrom, blocked).
  const request = buildRequest(filters, cursor, sortKey, sortDir, view);
  const hasOtherFilters = Object.values(filters).some(
    value => value !== 'all' && value !== ''
  );
  const { data, isLoading, isError, isFetching, isPlaceholderData, refetch } =
    useAdminUsers(request, isUrlReady);

  // Deep link / return from impersonation: `?user=<id>` with no record in memory → open it when the
  // list contains it; absent from the list after loading → drop the parameter instead of keeping a
  // drawer in the address that does not exist.
  useEffect(() => {
    if (view.userId === null || data === undefined) {
      return;
    }
    if (detailRecord?.id === view.userId) {
      return;
    }
    const match = data.records.find(u => u.id === view.userId);
    if (match) {
      setDetailRecord(match);
    } else {
      setView(prev => ({ ...prev, userId: null }));
    }
  }, [view.userId, data, detailRecord, setView]);

  const detailUser =
    view.userId !== null && detailRecord?.id === view.userId
      ? detailRecord
      : null;

  // DECISION: no global toast for a list load error. The inline error state in UsersTable (message
  // plus retry) is the only channel. pushNewSnackbar stores a raw string and AppSnackbarsController
  // re-translates it through the `events` namespace; an `admin.users` key does not exist there and
  // next-intl v4 returns the fallback "events.…" instead of throwing, so it leaked as toast text.
  // The snackbar takes only events.json keys.

  /* Mutations */
  const bulkEnableMut = useBulkEnable();
  const bulkDisableMut = useBulkDisable();
  const bulkChangePlanMut = useBulkChangePlan();
  const bulkLogoutMut = useBulkLogout();
  /* Derived */
  const users: AdminUserRecord[] = data?.records ?? [];
  // While the next page loads, `data` is the PREVIOUS page (keepPreviousData): its nextCursor is the
  // cursor already requested, so a second click on „Dalej" pushed the same page into the history
  // and „Wstecz" went nowhere.
  const hasNextPage = !isPlaceholderData && data?.nextCursor != null;
  const hasPrevPage = !isPlaceholderData && cursorHistoryRef.current.length > 0;
  const allOnPageSelected =
    users.length > 0 && users.every(u => selected.has(u.id));

  const resetCursor = () => {
    setCursor(undefined);
    cursorHistoryRef.current = [];
  };

  /* Handlers — filters */
  const updateFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    setView(prev => ({ ...prev, filters: { ...prev.filters, [key]: value } }));
    resetCursor();
  };

  const clearFilters = () => {
    setView(prev => ({ ...prev, filters: INITIAL_FILTERS }));
    resetCursor();
  };

  /* Handlers — sort */
  // One pure updater for key and direction: a nested setter fired twice in dev StrictMode (a double
  // toggle = no change).
  const handleSort = (key: SortKey) => {
    setView(prev => ({ ...prev, ...nextSort(prev, key) }));
    resetCursor();
  };

  /* Handlers — pagination */
  const handleNextPage = () => {
    if (data?.nextCursor) {
      cursorHistoryRef.current.push(cursor ?? '__first__');
      setCursor(data.nextCursor);
    }
  };

  const handlePrevPage = () => {
    const history = cursorHistoryRef.current;
    if (history.length > 0) {
      const prev = history.pop();
      setCursor(prev === '__first__' ? undefined : prev);
    }
  };

  /* Handlers — selection */
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const u of users) {
          next.delete(u.id);
        }
      } else {
        for (const u of users) {
          next.add(u.id);
        }
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  /* Handlers — bulk actions */
  const handleBulkEnable = () => {
    const userIds = Array.from(selected);
    if (userIds.length === 0) {
      return;
    }
    bulkEnableMut.mutate(
      { user_ids: userIds },
      {
        onSuccess: () => clearSelection(),
        onError: () => pushNewSnackbar(t('bulkEnableError'), 'error'),
      }
    );
  };

  const handleBulkDisable = () => {
    const userIds = Array.from(selected);
    if (userIds.length === 0) {
      return;
    }
    bulkDisableMut.mutate(
      { user_ids: userIds },
      {
        onSuccess: () => clearSelection(),
        onError: () => pushNewSnackbar(t('bulkDisableError'), 'error'),
      }
    );
  };

  const handleBulkChangePlan = (plan: PricingPlan) => {
    const userIds = Array.from(selected);
    if (userIds.length === 0) {
      return;
    }
    bulkChangePlanMut.mutate(
      { user_ids: userIds, pricing_plan: plan },
      {
        onSuccess: () => clearSelection(),
        onError: () => pushNewSnackbar(t('bulkChangePlanError'), 'error'),
      }
    );
  };

  const handleBulkLogout = () => {
    const userIds = Array.from(selected);
    if (userIds.length === 0) {
      return;
    }
    bulkLogoutMut.mutate(
      { user_ids: userIds },
      {
        onSuccess: () => clearSelection(),
        onError: () => pushNewSnackbar(t('bulkLogoutError'), 'error'),
      }
    );
  };

  const openDetail = (user: AdminUserRecord) => {
    setDetailRecord(user);
    setView(prev => ({ ...prev, userId: user.id }));
  };
  const closeDetail = () => setView(prev => ({ ...prev, userId: null }));

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('heroEyebrow')}
      title={t('pageTitle')}
      subtitle={t('heroSubtitle')}
      meta={
        data?.records != null ? (
          <HeroCountPillRowAtom>
            <HeroCountPillAtom
              icon={<UsersThreeIcon size={13} weight='fill' />}>
              {t('heroPillTotal', { count: data.records.length })}
            </HeroCountPillAtom>
            {selected.size > 0 && (
              <HeroCountPillAtom tone='emphasized'>
                {t('heroPillSelected', { count: selected.size })}
              </HeroCountPillAtom>
            )}
          </HeroCountPillRowAtom>
        ) : undefined
      }>
      <div className={styles.page}>
        {view.attention !== null && (
          <UsersAttentionScopeMolecule
            attention={view.attention}
            hasOtherFilters={hasOtherFilters}
            onRemove={() => {
              setView(prev => ({ ...prev, attention: null }));
              resetCursor();
            }}
          />
        )}
        <UsersTileScopeMolecule
          registeredFrom={view.registeredFrom}
          blocked={view.blocked}
          onRemoveRegisteredFrom={() => {
            setView(prev => ({ ...prev, registeredFrom: null }));
            resetCursor();
          }}
          onRemoveBlocked={() => {
            setView(prev => ({ ...prev, blocked: false }));
            resetCursor();
          }}
        />
        <UsersFilterBarOrganism
          search={filters.search}
          role={filters.role}
          plan={filters.plan}
          accountStatus={filters.accountStatus}
          paymentStatus={filters.paymentStatus}
          onSearch={v => updateFilter('search', v)}
          onRole={v => updateFilter('role', v)}
          onPlan={v => updateFilter('plan', v)}
          onAccountStatus={v => updateFilter('accountStatus', v)}
          onPaymentStatus={v => updateFilter('paymentStatus', v)}
          onClear={clearFilters}
        />

        <UsersTableOrganism
          users={users}
          isLoading={isLoading || !isUrlReady}
          isError={isError}
          selected={selected}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onToggleOne={toggleOne}
          onToggleAll={toggleAll}
          onRowClick={openDetail}
          allOnPageSelected={allOnPageSelected}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
          {...(view.attention !== null && {
            emptyLabel: t('attentionEmpty'),
          })}
          exportRequest={request}
          bulkBar={
            <UsersBulkActionsBarOrganism
              selectedCount={selected.size}
              onClear={clearSelection}
              onEnable={handleBulkEnable}
              onDisable={handleBulkDisable}
              onChangePlan={handleBulkChangePlan}
              onLogout={handleBulkLogout}
              isEnabling={bulkEnableMut.isPending}
              isDisabling={bulkDisableMut.isPending}
              isChangingPlan={bulkChangePlanMut.isPending}
              isLoggingOut={bulkLogoutMut.isPending}
            />
          }
          pagination={{
            hasPrev: hasPrevPage,
            hasNext: hasNextPage,
            onPrev: handlePrevPage,
            onNext: handleNextPage,
            isBusy: isPlaceholderData,
          }}
        />

        <UserDetailsDialogOrganism
          user={detailUser}
          open={detailUser !== null}
          onClose={closeDetail}
        />
      </div>
    </AdminPageLayoutComposition>
  );
}
