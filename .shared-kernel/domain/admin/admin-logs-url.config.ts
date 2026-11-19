import { ROUTES_FRONT_APP } from '../routing/routing.config';

/**
 * URL contract of the admin log panel. It lives in the kernel for the same
 * reason as ADMIN_USERS_QUERY: the menu badge and alert mails link into the
 * panel, and the page parses the same names. Short, stable names: they are
 * bookmarked and sent in mails.
 */
export const ADMIN_LOGS_QUERY = Object.freeze({
  view: 'view',
  type: 'type',
  application: 'application',
  environment: 'environment',
  search: 'q',
  dateFrom: 'from',
  dateTo: 'to',
  hideStartupNoise: 'noise',
  onlyOpenIssues: 'open',
  logId: 'log',
  attention: 'attention',
} as const);

/** Value of `view` that opens the grouped (one row per error class) list. */
export const ADMIN_LOGS_VIEW_GROUPS = 'groups';

/** Value of a boolean flag parameter (`noise`, `open`, `attention`) when on. */
export const ADMIN_LOGS_FLAG_ON = '1';

/**
 * The grouped list narrowed to exactly the groups counted by the menu badge
 * `log_issues_open` (ADMIN_GET_LOG_GROUPS with `attention: true`).
 */
export const adminLogsAttentionHref = (): string => {
  const params = new URLSearchParams({
    [ADMIN_LOGS_QUERY.view]: ADMIN_LOGS_VIEW_GROUPS,
    [ADMIN_LOGS_QUERY.attention]: ADMIN_LOGS_FLAG_ON,
  });
  return `${ROUTES_FRONT_APP.ADMIN_LOGS}?${params.toString()}`;
};
