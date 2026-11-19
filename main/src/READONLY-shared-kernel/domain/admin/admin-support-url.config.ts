import { ROUTES_FRONT_APP } from '../routing/routing.config';

/**
 * URL contract of the admin support queue (see ADMIN_USERS_QUERY for why such
 * contracts live in the kernel). `category` carries a SupportThreadCategory
 * value or SUPPORT_CATEGORY_FILTER_NONE.
 */
export const ADMIN_SUPPORT_QUERY = Object.freeze({
  filter: 'filter',
  category: 'category',
} as const);

/**
 * Value of `filter` for exactly the threads counted by the menu badge
 * `support_awaiting_reply` (SUPPORT_ADMIN_GET_ALL_THREADS with
 * `awaiting_reply: true`).
 */
export const ADMIN_SUPPORT_FILTER_AWAITING = 'awaiting';

export const adminSupportAwaitingReplyHref = (): string =>
  `${ROUTES_FRONT_APP.ADMIN_SUPPORT}?${ADMIN_SUPPORT_QUERY.filter}=${ADMIN_SUPPORT_FILTER_AWAITING}`;
