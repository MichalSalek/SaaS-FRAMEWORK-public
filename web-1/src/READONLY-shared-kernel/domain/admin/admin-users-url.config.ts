import { ROUTES_FRONT_APP } from '../routing/routing.config';
import type { AdminUsersAttentionFilter } from './admin-attention.config';

/**
 * URL contract of the admin users list. It lives in the kernel because the
 * backend builds links into it (admin alert mails) and the frontend parses
 * them (AdminUsersPage URL codec); a rename here moves both sides at once.
 * Short, stable names: they are bookmarked and sent in mails.
 */
export const ADMIN_USERS_QUERY = Object.freeze({
  search: 'q',
  role: 'role',
  plan: 'plan',
  accountStatus: 'status',
  paymentStatus: 'payment',
  sortKey: 'sort',
  sortDir: 'dir',
  userId: 'user',
  attention: 'attention',
  registeredFrom: 'from',
  blocked: 'blocked',
} as const);

/** Value of the boolean `blocked` parameter when on. */
export const ADMIN_USERS_FLAG_ON = '1';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar day as `YYYY-MM-DD` (read as a UTC day). The shape alone let
 * `2020-13-45` and `2021-02-30` through, so the date must round-trip.
 */
export const isUtcCalendarDay = (value: string): boolean => {
  if (!ISO_DAY.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

/** Start of a UTC day given as `YYYY-MM-DD`. */
export const utcDayStart = (day: string): Date =>
  new Date(`${day}T00:00:00.000Z`);

/**
 * Windows of the dashboard tiles „new accounts”, in days back from today's
 * UTC midnight.
 */
export const ADMIN_NEW_USERS_WINDOW_DAYS = Object.freeze({
  week: 7,
  month: 30,
} as const);

/**
 * First UTC day of a „new accounts” window. ONE function for the counter
 * (ADMIN_GET_METRICS) and for the list it opens (`created_from`), so the list
 * holds exactly the accounts the tile counts.
 */
export const adminNewUsersWindowStartDay = (now: Date, days: number): string =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)
  )
    .toISOString()
    .slice(0, 10);

/**
 * Values of the `attention` parameter: the lists behind the admin menu badges
 * `payments_attention` and `stuck_accounts`. Same strings as the API filter
 * (AdminUsersAttentionFilter), so the page passes the value straight through.
 */
export const ADMIN_USERS_ATTENTION_PAYMENTS: AdminUsersAttentionFilter =
  'payments';
export const ADMIN_USERS_ATTENTION_STUCK: AdminUsersAttentionFilter = 'stuck';

/** Role filter value for people who registered but never picked a role. */
export const ADMIN_USERS_ROLE_NO_ROLE = 'NO_ROLE';

/**
 * The list narrowed to one person, with their card open when the id is known.
 * `search` matches an exact user id or a fragment of the e-mail.
 */
export const adminUserHref = ({
  search,
  userId,
}: {
  search: string;
  userId?: string | null | undefined;
}): string => {
  const params = new URLSearchParams({ [ADMIN_USERS_QUERY.search]: search });
  if (userId) {
    params.set(ADMIN_USERS_QUERY.userId, userId);
  }
  return `${ROUTES_FRONT_APP.ADMIN_USERS}?${params.toString()}`;
};

/** The list of people who registered and never finished onboarding. */
export const adminUsersWithoutRoleHref = (): string =>
  `${ROUTES_FRONT_APP.ADMIN_USERS}?${ADMIN_USERS_QUERY.role}=${ADMIN_USERS_ROLE_NO_ROLE}`;

/** Exactly the users counted by the menu badge `payments_attention`. */
export const adminUsersPaymentsAttentionHref = (): string =>
  `${ROUTES_FRONT_APP.ADMIN_USERS}?${ADMIN_USERS_QUERY.attention}=${ADMIN_USERS_ATTENTION_PAYMENTS}`;

/** Exactly the users counted by the menu badge `stuck_accounts`. */
export const adminUsersStuckHref = (): string =>
  `${ROUTES_FRONT_APP.ADMIN_USERS}?${ADMIN_USERS_QUERY.attention}=${ADMIN_USERS_ATTENTION_STUCK}`;

/** Accounts created on or after a UTC day (dashboard „new accounts” tiles). */
export const adminUsersRegisteredFromHref = (day: string): string =>
  `${ROUTES_FRONT_APP.ADMIN_USERS}?${ADMIN_USERS_QUERY.registeredFrom}=${day}`;

/** Blocked accounts (`is_active = false`, dashboard tile „Zablokowane konta”). */
export const adminUsersBlockedHref = (): string =>
  `${ROUTES_FRONT_APP.ADMIN_USERS}?${ADMIN_USERS_QUERY.blocked}=${ADMIN_USERS_FLAG_ON}`;
