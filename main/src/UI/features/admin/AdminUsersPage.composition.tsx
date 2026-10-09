// UI/features/admin/AdminUsersPage.tsx
// Admin Users — cursor-paginated list with filters, bulk actions, user details dialog.
// Sub-components: components/UsersFilterBar, UsersTable, UsersBulkActionsBar,
//                 UserDetailsDialog. Helpers: AdminUsersPage.helpers.
//
// DECISION (nie usuwaj tego komentarza) — głos ownera `s126-admin`,
// 2026-10-09: wygrał układ DZIŚ. Struktura strony zostaje: blok tytułu, filtry,
// lista, paginacja, panel szczegółów. Lista stoi na wspólnych prymitywach
// (DataTable, Pagination, FilterBar), bo tabela ucięta przy prawej krawędzi
// telefonu była wadą zmierzoną niezależnie od głosu. Działania zbiorcze
// (checkboxy i pasek) istnieją tylko w układzie tabeli, jak dotąd: na
// telefonie ich nie było.

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
  type FilterState,
} from './AdminUsersPage.helpers';
import { useUrlSyncedState } from '../../shared/hooks/useUrlSyncedState';
import { UsersAttentionScopeMolecule } from './components/UsersAttentionScope.molecule';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import styles from './AdminUsersPage.module.css';

/* ─── Main feature component ─── */

export function AdminUsersPageComposition() {
  const t = useTranslations('admin.users');
  /* State */
  // Filtry, sort i otwarty użytkownik żyją w adresie: „Wróć do siebie" po
  // wcieleniu wraca dokładnie tutaj (application/auth/identity-switch.ts), a
  // link z logu otwiera konkretnego użytkownika.
  const [view, setView, isUrlReady] = useUrlSyncedState(ADMIN_USERS_URL_CODEC);
  const { filters, sortKey, sortDir } = view;
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const cursorHistoryRef = useRef<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Rekord trzymany osobno od id w adresie: drawer nie znika, gdy użytkownik
  // wypadnie z bieżącej strony listy (paginacja, zmiana filtra w tle).
  const [detailRecord, setDetailRecord] = useState<AdminUserRecord | null>(
    null
  );

  /* Query — wstrzymane do pierwszego odczytu adresu (bez podwójnego fetchu) */
  const request = buildRequest(
    filters,
    cursor,
    sortKey,
    sortDir,
    view.attention
  );
  const hasOtherFilters = Object.values(filters).some(
    value => value !== 'all' && value !== ''
  );
  const { data, isLoading, isError, isFetching, isPlaceholderData, refetch } =
    useAdminUsers(request, isUrlReady);

  // Deep link / powrót z wcielenia: `?user=<id>` bez rekordu w pamięci →
  // otwórz, gdy lista go zawiera; brak na liście po załadowaniu → zdejmij
  // parametr zamiast trzymać w adresie drawer, którego nie ma.
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

  // DECISION (nie usuwaj tego komentarza):
  // BRAK globalnego toastu dla błędu ładowania listy. Inline error-state w
  // UsersTable (renderuje t('loadError') + przycisk Ponów, bezpośrednio przez
  // useTranslations('admin.users')) jest jedynym i właściwym kanałem błędu —
  // pełna afordancja retry, zero redundancji. Poprzednio tu był
  // pushNewSnackbar(t('loadError')), co JEST BUGIEM: pushNewSnackbar przechowuje
  // surowy string, a AppSnackbarsController re-tłumaczy go przez
  // useTranslations('events'); klucz z namespace'u admin.users NIE istnieje w
  // events.json, więc next-intl v4 zwraca fallback "events.Nie udało się…"
  // (NIE rzuca wyjątku → catch w translateEventMessage nie łapie) i wyciekał on
  // jako tekst toastu. Snackbar przyjmuje TYLKO klucze z events.json
  // (APP_EVENTS.INFO.* / response.event), nie gotowe stringi z common.json.

  /* Mutations */
  const bulkEnableMut = useBulkEnable();
  const bulkDisableMut = useBulkDisable();
  const bulkChangePlanMut = useBulkChangePlan();
  const bulkLogoutMut = useBulkLogout();
  /* Derived */
  const users: AdminUserRecord[] = data?.records ?? [];
  // While the next page loads, `data` is the PREVIOUS page (keepPreviousData):
  // its nextCursor is the cursor already requested, so a second click on
  // „Dalej" pushed the same page into the history and „Wstecz" went nowhere.
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
  // Jeden czysty updater dla klucza i kierunku: zagnieżdżony setter odpalał
  // się dwa razy w dev StrictMode (podwójny toggle = brak zmiany).
  const handleSort = (key: SortKey) => {
    setView(prev =>
      prev.sortKey === key
        ? { ...prev, sortDir: prev.sortDir === 'asc' ? 'desc' : 'asc' }
        : { ...prev, sortKey: key, sortDir: 'asc' }
    );
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
