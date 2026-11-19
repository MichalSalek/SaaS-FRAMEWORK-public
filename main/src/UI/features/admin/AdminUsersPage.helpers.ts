// UI/features/admin/AdminUsersPage.helpers.ts
// Pure helpers + types extracted from AdminUsersPage.tsx (max-lines guard).

import {
  AccountStatusValue,
  AccountTypeValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  ADMIN_USERS_FLAG_ON,
  ADMIN_USERS_QUERY,
  ADMIN_USERS_ROLE_NO_ROLE,
  isUtcCalendarDay,
} from '@kernel/domain/admin/admin-users-url.config';
import {
  isAdminUsersAttentionFilter,
  type AdminUsersAttentionFilter,
} from '@kernel/domain/admin/admin-attention.config';
import type { AdminUsersRequest } from './hooks/useAdminUsers';
import type { SortKey, SortDir } from './components/UsersTable.organism';
import type {
  RoleFilter,
  PlanFilter,
  AccountStatusFilter,
  PaymentStatusFilter,
} from './components/UsersFilterBar.organism';

export const PAGE_SIZE = 15;

/** Role filter value for people who registered but never picked a role. */
export const ROLE_FILTER_NO_ROLE = ADMIN_USERS_ROLE_NO_ROLE;

/* Sort key → backend `sort_by` mapping. */
export const SORT_KEY_MAP: Record<SortKey, AdminUsersRequest['sort_by']> = {
  name: 'name',
  email: 'email',
  role: 'id', // fallback — no role sort backend-side
  plan: 'id', // fallback — plan lives on stylist_account
  status: 'id', // fallback — computed client-side
  createdAt: 'created_at',
  lastLogin: 'last_login_at',
  photos: 'photos',
  city: 'city',
};

/**
 * Which columns are REALLY sortable — derived (SSOT) from SORT_KEY_MAP: a column
 * is sortable iff it has its own backend `sort_by` field (not the 'id' fallback).
 * Columns that fall back to 'id' (role/plan/status) must render as
 * non-sortable headers — otherwise the active caret + aria-sort lie about the
 * ordering (click → sort by id, the header promises a sort by the column).
 */
export const SORTABLE_KEYS: ReadonlySet<SortKey> = new Set(
  (Object.keys(SORT_KEY_MAP) as SortKey[]).filter(
    key => SORT_KEY_MAP[key] !== 'id'
  )
);

/**
 * Direction of the first click on a column header. Counts and the last
 * sign-in open with the most first (the people worth a look), text with A to Z.
 */
export const firstSortDir = (key: SortKey): SortDir =>
  key === 'photos' || key === 'lastLogin' ? 'desc' : 'asc';

/** A click on a header: the same column flips, another opens at firstSortDir. */
export const nextSort = (
  current: { sortKey: SortKey; sortDir: SortDir },
  key: SortKey
): { sortKey: SortKey; sortDir: SortDir } =>
  current.sortKey === key
    ? { sortKey: key, sortDir: current.sortDir === 'asc' ? 'desc' : 'asc' }
    : { sortKey: key, sortDir: firstSortDir(key) };

export interface FilterState {
  search: string;
  role: RoleFilter;
  plan: PlanFilter;
  accountStatus: AccountStatusFilter;
  paymentStatus: PaymentStatusFilter;
}

export const INITIAL_FILTERS: FilterState = {
  search: '',
  role: 'all',
  plan: 'all',
  accountStatus: 'all',
  paymentStatus: 'all',
};

/**
 * What a counter opened the list with (menu badge, dashboard tile). Shown as
 * removable scope chips, never as the page's own filters.
 */
export interface UsersCounterScope {
  attention: AdminUsersAttentionFilter | null;
  /** `YYYY-MM-DD` (UTC): accounts created on or after that day. */
  registeredFrom: string | null;
  /** Only blocked accounts (`is_active = false`). */
  blocked: boolean;
}

export const NO_COUNTER_SCOPE: UsersCounterScope = {
  attention: null,
  registeredFrom: null,
  blocked: false,
};

export function buildRequest(
  filters: FilterState,
  cursor: string | undefined,
  sortKey: SortKey,
  sortDir: SortDir,
  scope: UsersCounterScope = NO_COUNTER_SCOPE
): AdminUsersRequest {
  const trimmedSearch = filters.search.trim();
  const sortBy = SORT_KEY_MAP[sortKey];

  const req: AdminUsersRequest = {
    take: PAGE_SIZE,
    sort_order: sortDir,
  };
  if (cursor) {
    req.cursor = cursor;
  }
  if (sortBy) {
    req.sort_by = sortBy;
  }
  if (trimmedSearch) {
    req.search = trimmedSearch;
  }
  if (filters.role === ROLE_FILTER_NO_ROLE) {
    req.onboarding_pending = true;
  } else if (filters.role !== 'all') {
    req.role = filters.role;
  }
  if (filters.plan !== 'all') {
    req.pricing_plan = filters.plan;
  }
  if (filters.accountStatus !== 'all') {
    req.account_status = filters.accountStatus;
  }
  if (filters.paymentStatus !== 'all') {
    req.payment_status = filters.paymentStatus;
  }
  // AND-ed with the filters above by the server; the predicate is shared with
  // the menu counter, so the list equals the badge.
  if (scope.attention !== null) {
    req.attention = scope.attention;
  }
  // The dashboard tiles' queries: same predicate as their counters.
  if (scope.registeredFrom !== null) {
    req.created_from = scope.registeredFrom;
  }
  if (scope.blocked) {
    req.is_active = false;
  }
  return req;
}

/* ─── URL state (filters, sort, open user) ─── */

export interface AdminUsersViewState {
  filters: FilterState;
  sortKey: SortKey;
  sortDir: SortDir;
  /** User whose details drawer is open (deep link, return from impersonation). */
  userId: string | null;
  /**
   * The list behind a menu badge (`payments_attention`, `stuck_accounts`),
   * shown on the page as one removable scope chip.
   */
  attention: AdminUsersAttentionFilter | null;
  /** Dashboard tile „new accounts”: created on or after this UTC day. */
  registeredFrom: string | null;
  /** Dashboard tile „blocked accounts”. */
  blocked: boolean;
}

export const DEFAULT_SORT_KEY: SortKey = 'createdAt';
export const DEFAULT_SORT_DIR: SortDir = 'desc';

// Parameter names are the kernel URL contract (ADMIN_USERS_QUERY): the
// backend builds links into this list for admin mails.
const Q = ADMIN_USERS_QUERY;

type QueryRecord = Record<string, string | string[] | undefined>;

const firstValue = (raw: string | string[] | undefined): string => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : '';
};

const oneOf = <V extends string>(
  raw: string,
  allowed: readonly V[]
): V | null =>
  (allowed as readonly string[]).includes(raw) ? (raw as V) : null;

export const parseAdminUsersQuery = (
  query: QueryRecord
): AdminUsersViewState => {
  const sortKey = oneOf(firstValue(query[Q.sortKey]), [...SORTABLE_KEYS]);
  const sortDir = oneOf(firstValue(query[Q.sortDir]), ['asc', 'desc'] as const);
  const userId = firstValue(query[Q.userId]).trim();
  const attention = firstValue(query[Q.attention]);
  const registeredFrom = firstValue(query[Q.registeredFrom]);
  return {
    filters: {
      search: firstValue(query[Q.search]),
      role:
        oneOf(firstValue(query[Q.role]), [
          ...Object.values(AccountTypeValue),
          ROLE_FILTER_NO_ROLE,
        ] as const) ?? 'all',
      plan:
        oneOf(firstValue(query[Q.plan]), Object.values(PricingPlanValue)) ??
        'all',
      accountStatus:
        oneOf(
          firstValue(query[Q.accountStatus]),
          Object.values(AccountStatusValue)
        ) ?? 'all',
      paymentStatus:
        oneOf(
          firstValue(query[Q.paymentStatus]),
          Object.values(PaymentStatusValue)
        ) ?? 'all',
    },
    sortKey: sortKey ?? DEFAULT_SORT_KEY,
    sortDir: sortDir ?? DEFAULT_SORT_DIR,
    userId: userId.length > 0 ? userId : null,
    attention: isAdminUsersAttentionFilter(attention) ? attention : null,
    registeredFrom: isUtcCalendarDay(registeredFrom) ? registeredFrom : null,
    blocked: firstValue(query[Q.blocked]) === ADMIN_USERS_FLAG_ON,
  };
};

export const buildAdminUsersQuery = (
  state: AdminUsersViewState
): Record<string, string> => {
  const query: Record<string, string> = {};
  const { filters } = state;
  if (filters.search.trim().length > 0) {
    query[Q.search] = filters.search;
  }
  if (filters.role !== 'all') {
    query[Q.role] = filters.role;
  }
  if (filters.plan !== 'all') {
    query[Q.plan] = filters.plan;
  }
  if (filters.accountStatus !== 'all') {
    query[Q.accountStatus] = filters.accountStatus;
  }
  if (filters.paymentStatus !== 'all') {
    query[Q.paymentStatus] = filters.paymentStatus;
  }
  if (
    state.sortKey !== DEFAULT_SORT_KEY ||
    state.sortDir !== DEFAULT_SORT_DIR
  ) {
    query[Q.sortKey] = state.sortKey;
    query[Q.sortDir] = state.sortDir;
  }
  if (state.userId !== null) {
    query[Q.userId] = state.userId;
  }
  if (state.attention !== null) {
    query[Q.attention] = state.attention;
  }
  if (state.registeredFrom !== null) {
    query[Q.registeredFrom] = state.registeredFrom;
  }
  if (state.blocked) {
    query[Q.blocked] = ADMIN_USERS_FLAG_ON;
  }
  return query;
};

export type AdminUserRoleLabelKey =
  'roleAdmin' | 'roleClient' | 'roleStylist' | 'roleOnboardingPending';

/**
 * Label key for a user row. Admin wins; then a user who never finished
 * onboarding, whose `account_type` is only the CLIENT signup default and says
 * nothing about the role they will pick.
 */
export function adminUserRoleLabelKey(user: {
  account_type: string;
  role_id: string;
  onboarding_completed: boolean;
}): AdminUserRoleLabelKey | null {
  if (user.role_id === SystemRoleId.MASTER_ADMIN) {
    return 'roleAdmin';
  }
  if (!user.onboarding_completed) {
    return 'roleOnboardingPending';
  }
  if (user.account_type === AccountTypeValue.CLIENT) {
    return 'roleClient';
  }
  if (user.account_type === AccountTypeValue.STYLIST) {
    return 'roleStylist';
  }
  return null;
}

/** Empty DB names are `''`, not null. Callers pass the locale's empty label. */
export function adminUserDisplayName(
  name: string | null | undefined,
  emptyLabel: string
): string {
  const trimmed = name?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : emptyLabel;
}

export const ADMIN_USERS_URL_CODEC = {
  keys: Object.values(ADMIN_USERS_QUERY),
  parse: parseAdminUsersQuery,
  build: buildAdminUsersQuery,
} as const;
