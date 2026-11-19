import { Prisma } from '../../../prisma-app-logs/js-client';
import {
  DEFAULT_LOG_ISSUE_STATUS,
  LOG_ISSUE_REGRESSED,
  LOG_ISSUE_STATUSES,
  isLogIssueStatus,
  type LogIssueDisplayStatus,
  type LogIssueStatusValue,
} from '@kernel/domain/admin/log-triage.config';

/** The only status for which regression is computed (the others have nothing to "undo"). */
export const FIXED_LOG_ISSUE_STATUS: LogIssueStatusValue = 'fixed';

/**
 * Status shown in the UI. `regressed` is DERIVED and never stored: a group marked fixed that
 * occurred again AFTER the mark must resurface by itself, otherwise "fixed" would be an
 * unbacked claim.
 *
 * DECISION: the fingerprint excludes `environment`, so one status covers an error class in every
 * environment (a status describes the code; per-environment triage would mark one bug three
 * times). Because the status is global, the regression evidence must be global too: the verdict
 * uses `last_seen_any` (max over the whole table, CTE `fixed_activity`), while `last_seen` is only
 * "last seen in this slice". Otherwise one row would read "fixed" under a filter and "regressed"
 * without it. A false "regressed" is cheaper than a false "fixed".
 */
export const logIssueDisplayStatus = (input: {
  storedStatus: string | null;
  statusUpdatedAt: Date | null;
  lastSeen: Date;
}): LogIssueDisplayStatus => {
  if (!isLogIssueStatus(input.storedStatus)) {
    return DEFAULT_LOG_ISSUE_STATUS;
  }
  if (
    input.storedStatus === FIXED_LOG_ISSUE_STATUS &&
    input.statusUpdatedAt !== null &&
    input.lastSeen.getTime() > input.statusUpdatedAt.getTime()
  ) {
    return LOG_ISSUE_REGRESSED;
  }
  return input.storedStatus;
};

/**
 * The SAME rule as logIssueDisplayStatus, as a SQL expression.
 *
 * DECISION: this rule exists twice on purpose, and only here. The JS function labels rows; the
 * SQL twin is needed because "needs a reaction" must be filtered before the LIMIT and counted
 * without materializing groups. Both use the same kernel constants, and
 * admin-log-groups.query.test.ts checks the CASE against the JS function for every combination.
 */
export const logIssueDisplayStatusSql = (columns: {
  storedStatus: Prisma.Sql;
  statusUpdatedAt: Prisma.Sql;
  lastSeen: Prisma.Sql;
}): Prisma.Sql => Prisma.sql`CASE
      WHEN ${columns.storedStatus} IS NULL OR ${columns.storedStatus} NOT IN (${Prisma.join([...LOG_ISSUE_STATUSES])}) THEN ${DEFAULT_LOG_ISSUE_STATUS}::text
      WHEN ${columns.storedStatus} = ${FIXED_LOG_ISSUE_STATUS} AND ${columns.statusUpdatedAt} IS NOT NULL AND ${columns.lastSeen} > ${columns.statusUpdatedAt} THEN ${LOG_ISSUE_REGRESSED}::text
      ELSE ${columns.storedStatus}
    END`;
