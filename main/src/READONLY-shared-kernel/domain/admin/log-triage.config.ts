// SSOT of log triage: the admin panel's filter dimensions, error-group statuses and the list of
// namespaces treated as operational noise. Triage exists because a raw stream filtered by type and
// date cannot separate front from back, production from development, or one error class from its
// repeats.

import type { SendLogType } from './send-log.config';

/** Layer the log came from. Values of the `AppLogRecord.application` column. */
export const LOG_APPLICATIONS = ['frontend', 'backend'] as const;
export type LogApplication = (typeof LOG_APPLICATIONS)[number];

/**
 * Environments visible in the log store. The log DB is SHARED by dev/staging/prod (separated by
 * this column, see ENVIRONMENT_REFERENCE.md), so without this filter a production admin sees
 * development entries mixed in. Mirrors web-1 `EnvironmentMode` without the `UNKNOWN` sentinel
 * (not a user choice).
 */
export const LOG_ENVIRONMENTS = [
  'PRODUCTION',
  'STAGING',
  'DEVELOPMENT',
] as const;
export type LogEnvironment = (typeof LOG_ENVIRONMENTS)[number];

/**
 * Error-group status set manually by the admin.
 *
 * `new` is the DEFAULT and deliberately NOT stored: no `LogIssueStatus` row == `new`. Undoing a
 * mark is deleting the row, and the status table does not fill with no-information entries.
 */
export const LOG_ISSUE_STATUSES = ['new', 'known', 'fixed', 'ignored'] as const;
export type LogIssueStatusValue = (typeof LOG_ISSUE_STATUSES)[number];

export const DEFAULT_LOG_ISSUE_STATUS: LogIssueStatusValue = 'new';

/**
 * DERIVED status, never stored: a group marked `fixed` that occurred AGAIN after the mark date.
 * Without it "fixed" would be an unchecked claim and a recurrence would look closed.
 */
export const LOG_ISSUE_REGRESSED = 'regressed' as const;

export type LogIssueDisplayStatus =
  LogIssueStatusValue | typeof LOG_ISSUE_REGRESSED;

/** Statuses meaning "closed": filtered out of the to-do list by default. */
export const SETTLED_LOG_ISSUE_STATUSES: readonly LogIssueDisplayStatus[] = [
  'fixed',
  'ignored',
] as const;

/**
 * DECISION: one definition of "a log group that needs a reaction". The admin menu badge
 * `log_issues_open` and the log panel opened with `attention=1` share these constants and one
 * backend query builder (admin-log-groups.query.ts), so the badge number always equals the rows the
 * link shows. `known` and `ignored` are decisions the admin already took and `fixed` is closed until
 * it regresses, so this set is NOT the complement of SETTLED_LOG_ISSUE_STATUSES: `known` is neither
 * settled nor waiting.
 */
export const LOG_ATTENTION_SCOPE = Object.freeze({
  type: 'error',
  environment: 'PRODUCTION',
  windowDays: 7,
} as const satisfies {
  type: SendLogType;
  environment: LogEnvironment;
  windowDays: number;
});

export const LOG_ISSUE_ATTENTION_STATUSES: readonly LogIssueDisplayStatus[] = [
  DEFAULT_LOG_ISSUE_STATUS,
  LOG_ISSUE_REGRESSED,
] as const;

export const isLogIssueNeedingReaction = (
  displayStatus: LogIssueDisplayStatus
): boolean => LOG_ISSUE_ATTENTION_STATUSES.includes(displayStatus);

/**
 * Namespaces written at EVERY process start. They are not errors but seeding-sequence
 * confirmations, logged as `warn` on purpose because the `info` channel is gated by
 * VERBOSE_LOG_MODE (docs/LOGGING.md). They add ~8 entries per cold start in production and drown
 * real warnings, so the panel can hide them in one click.
 */
export const STARTUP_NOISE_NAMESPACES: readonly string[] = [
  'STARTUP',
  'STARTUP_SEEDING_DURATION',
  'PERMISSIONS',
  'runtime-config-seed',
] as const;

/** How many error groups the aggregation returns (bounds query and payload). */
export const LOG_GROUPS_LIMIT = 200;

/** Page size of the admin log stream when the client omits `take`. */
export const LOG_STREAM_DEFAULT_TAKE = 50;

/** Hard cap of one stream page. */
export const LOG_STREAM_MAX_TAKE = 200;

/** Other events of the same request chain returned with one log's details. */
export const LOG_DETAILS_CHAIN_LIMIT = 50;

/** Newest siblings of the same fingerprint returned with one log's details. */
export const LOG_DETAILS_RECENT_LIMIT = 10;

/**
 * How far back the details view counts siblings of one fingerprint. Equals the
 * default log retention (EVENT_LOG_MAX_AGE_DAYS), so normally it cuts nothing;
 * it lets the scan use the (type, created_at) index range instead of the
 * whole table when retention is raised.
 */
export const LOG_DETAILS_GROUP_WINDOW_DAYS = 90;

/** Max length of the note on a group status. */
export const LOG_ISSUE_NOTE_MAX_LENGTH = 500;

export const isLogIssueStatus = (
  value: unknown
): value is LogIssueStatusValue =>
  typeof value === 'string' &&
  (LOG_ISSUE_STATUSES as readonly string[]).includes(value);

export const isLogApplication = (value: unknown): value is LogApplication =>
  typeof value === 'string' &&
  (LOG_APPLICATIONS as readonly string[]).includes(value);

export const isLogEnvironment = (value: unknown): value is LogEnvironment =>
  typeof value === 'string' &&
  (LOG_ENVIRONMENTS as readonly string[]).includes(value);
