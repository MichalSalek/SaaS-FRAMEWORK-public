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
} as const);

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
