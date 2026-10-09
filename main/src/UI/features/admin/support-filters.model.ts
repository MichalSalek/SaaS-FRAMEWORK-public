// UI/features/admin/support-filters.model.ts
// URL state of the admin support queue. Parameter names and the `awaiting`
// value are the kernel contract (ADMIN_SUPPORT_QUERY): the menu badge
// „Wsparcie N” links here with them.
//
// `category` (the second kernel parameter) is deliberately NOT owned yet: the
// page has no category control and no labels for the values, and a filter the
// admin cannot see or remove is worse than none. useUrlSyncedState carries
// parameters a codec does not own through untouched, so a link that has it
// keeps it until the control lands.

import {
  ADMIN_SUPPORT_FILTER_AWAITING,
  ADMIN_SUPPORT_QUERY,
} from '@kernel/domain/admin/admin-support-url.config';
import type { SupportThreadStatus } from '@kernel/models/support/support.dto';

/** `AWAITING` = exactly the threads counted by the badge `support_awaiting_reply`. */
export type SupportFilterTab = 'ALL' | SupportThreadStatus | 'AWAITING';

export type AdminSupportUrlState = { tab: SupportFilterTab };

/** The inbox opens on the open threads, so that value never reaches the URL. */
export const DEFAULT_SUPPORT_TAB: SupportFilterTab = 'OPEN';

const URL_VALUE_BY_TAB: Readonly<Record<SupportFilterTab, string>> = {
  AWAITING: ADMIN_SUPPORT_FILTER_AWAITING,
  ALL: 'all',
  OPEN: 'open',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

// A Map, not an object lookup: `filter=toString` must not resolve to an
// inherited Object.prototype member.
const TAB_BY_URL_VALUE = new Map<string, SupportFilterTab>(
  (Object.keys(URL_VALUE_BY_TAB) as SupportFilterTab[]).map(tab => [
    URL_VALUE_BY_TAB[tab],
    tab,
  ])
);

type QueryRecord = Record<string, string | string[] | undefined>;

export const parseAdminSupportQuery = (
  query: QueryRecord
): AdminSupportUrlState => {
  const raw = query[ADMIN_SUPPORT_QUERY.filter];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return {
    tab:
      (value !== undefined ? TAB_BY_URL_VALUE.get(value) : undefined) ??
      DEFAULT_SUPPORT_TAB,
  };
};

export const buildAdminSupportQuery = (
  state: AdminSupportUrlState
): Record<string, string> =>
  state.tab === DEFAULT_SUPPORT_TAB
    ? {}
    : { [ADMIN_SUPPORT_QUERY.filter]: URL_VALUE_BY_TAB[state.tab] };

export const ADMIN_SUPPORT_URL_CODEC = {
  keys: [ADMIN_SUPPORT_QUERY.filter],
  parse: parseAdminSupportQuery,
  build: buildAdminSupportQuery,
};
