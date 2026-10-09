// UI/features/admin/admin-attention.config.ts
// One place that says, for every admin "needs a reaction" counter, WHAT it
// counts (label + ICU count sentence) and WHERE its items are (href).
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08 („Logi (3): gdzie
// są te 3?”): a count without its list is noise. The sidebar, the phone tabs
// and the dashboard panel „Wymaga reakcji” all read this config, so a badge
// can never point at a screen that does not show exactly the counted items,
// and its accessible name / title always says what the number counts. A new
// counter = a field in AdminAttentionCountsResponse (kernel) + one entry here;
// the `satisfies` below fails the build until the entry exists. The hrefs are
// the kernel URL contracts (the backend builds the same links for alert mails).

import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';
import type { AdminAttentionCountsResponse } from '@kernel/models/admin/admin-attention.dto';
import { adminLogsAttentionHref } from '@kernel/domain/admin/admin-logs-url.config';
import { adminSupportAwaitingReplyHref } from '@kernel/domain/admin/admin-support-url.config';
import {
  adminUsersPaymentsAttentionHref,
  adminUsersStuckHref,
} from '@kernel/domain/admin/admin-users-url.config';
import { ADMIN_ATTENTION } from '@kernel/domain/admin/admin-attention.config';
import { LOG_ATTENTION_SCOPE } from '@kernel/domain/admin/log-triage.config';

export type AdminAttentionKey = keyof AdminAttentionCountsResponse;
export type AdminAttentionCounts = AdminAttentionCountsResponse;

export interface AdminAttentionSignal {
  key: AdminAttentionKey;
  /** Short name of the queue, namespace `admin.attention`. */
  labelKey: `signals.${AdminAttentionKey}.label`;
  /** ICU plural sentence that says WHAT is counted („3 grupy błędów do reakcji”). */
  countLabelKey: `signals.${AdminAttentionKey}.count`;
  /** Words of the removable scope chip shown on the list behind the count. */
  scopeKey: `signals.${AdminAttentionKey}.scope`;
  /** The screen that shows exactly the counted items. */
  href: string;
  /** The admin page (menu item) the queue belongs to. */
  path: string;
}

const signal = (
  key: AdminAttentionKey,
  path: string,
  href: string = path
): AdminAttentionSignal => ({
  key,
  labelKey: `signals.${key}.label`,
  countLabelKey: `signals.${key}.count`,
  scopeKey: `signals.${key}.scope`,
  href,
  path,
});

const SIGNALS = {
  log_issues_open: signal(
    'log_issues_open',
    ROUTES_FRONT_APP.ADMIN_LOGS,
    adminLogsAttentionHref()
  ),
  support_awaiting_reply: signal(
    'support_awaiting_reply',
    ROUTES_FRONT_APP.ADMIN_SUPPORT,
    adminSupportAwaitingReplyHref()
  ),
  // The moderation page opens on its pending tab: the page IS the queue.
  moderation_pending: signal(
    'moderation_pending',
    ROUTES_FRONT_APP.ADMIN_MODERATION
  ),
  system_health_issues: signal(
    'system_health_issues',
    ROUTES_FRONT_APP.ADMIN_HEALTH
  ),
  payments_attention: signal(
    'payments_attention',
    ROUTES_FRONT_APP.ADMIN_USERS,
    adminUsersPaymentsAttentionHref()
  ),
  stuck_accounts: signal(
    'stuck_accounts',
    ROUTES_FRONT_APP.ADMIN_USERS,
    adminUsersStuckHref()
  ),
  email_sweep_issues: signal(
    'email_sweep_issues',
    ROUTES_FRONT_APP.ADMIN_EMAIL_SCHEDULE
  ),
} satisfies Record<AdminAttentionKey, AdminAttentionSignal>;

export const ADMIN_ATTENTION_SIGNALS: Readonly<
  Record<AdminAttentionKey, AdminAttentionSignal>
> = SIGNALS;

/** Display order: what breaks the product first, then people, then mail. */
export const ADMIN_ATTENTION_ORDER: readonly AdminAttentionKey[] = [
  'system_health_issues',
  'log_issues_open',
  'support_awaiting_reply',
  'moderation_pending',
  'payments_attention',
  'stuck_accounts',
  'email_sweep_issues',
];

/** Numbers the copy quotes; they come from the kernel thresholds, never typed. */
export const ADMIN_ATTENTION_COPY_VALUES = {
  logDays: LOG_ATTENTION_SCOPE.windowDays,
  trialDays: ADMIN_ATTENTION.TRIAL_ENDING_WITHIN_DAYS,
  stuckMinHours: ADMIN_ATTENTION.STUCK_MIN_AGE_HOURS,
  stuckMaxDays: ADMIN_ATTENTION.STUCK_MAX_AGE_DAYS,
  sweepHours: ADMIN_ATTENTION.EMAIL_SWEEP_MAX_SILENCE_HOURS,
} as const;

export const attentionCountOf = (
  counts: AdminAttentionCounts | null,
  key: AdminAttentionKey
): number => counts?.[key] ?? 0;

export const sumAttention = (
  counts: AdminAttentionCounts | null,
  keys: readonly AdminAttentionKey[]
): number => keys.reduce((sum, key) => sum + attentionCountOf(counts, key), 0);

export interface AdminAttentionTarget {
  /** Sum over the item's queues (the number on the badge). */
  count: number;
  /** Queues with something waiting, in the given order. */
  active: readonly AdminAttentionSignal[];
  /**
   * One tap to the counted items: the list of the first waiting queue, or the
   * plain page when nothing waits.
   */
  href: string;
}

/**
 * Where a menu item with these queues leads right now.
 * `ownPage` = the item shows all of its queues itself (the dashboard panel),
 * so the destination stays the page whatever waits.
 */
export const resolveAttentionTarget = (
  path: string,
  keys: readonly AdminAttentionKey[],
  counts: AdminAttentionCounts | null,
  ownPage = false
): AdminAttentionTarget => {
  const active = keys
    .filter(key => attentionCountOf(counts, key) > 0)
    .map(key => ADMIN_ATTENTION_SIGNALS[key]);
  const first = active[0];
  return {
    count: sumAttention(counts, keys),
    active,
    href: ownPage || first === undefined ? path : first.href,
  };
};

/** Badge text: the real number up to 999 (the old „99+” hid 105 waiting threads). */
export const formatAttentionBadge = (count: number): string =>
  count > 999 ? '999+' : String(count);
