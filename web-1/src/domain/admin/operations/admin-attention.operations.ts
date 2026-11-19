import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  countServiceHealthIssues,
  getCachedServiceHealthSnapshot,
} from '@app/health/service-health.snapshot';
import { buildSupportAwaitingReplyCountQuery } from '@domain/support/operations/support-awaiting-reply.predicate';
import { fetchLastEmailSweep } from '@domain/email/operations/email-pipeline.query';
import { isEmailSweepSilent } from '@domain/email/email-sweep-silence.policy';
import { countUnsettledProductionErrorGroups } from './admin-log-groups.operations';
import {
  buildPaymentsAttentionWhere,
  buildStuckAccountsWhere,
} from './admin-user-attention.predicates';

type AttentionCountsResponse =
  ADMIN_DTO_API_V1['ADMIN_GET_ATTENTION_COUNTS']['RESPONSE'];

type AwaitingReplyRow = { awaiting_reply: number };

/**
 * Badge counters for things waiting for the admin. Each count and its list
 * share one predicate: support awaiting reply, pending reports, cached health
 * issues (60s snapshot), open log groups, payments and stuck accounts, and a
 * silent lifecycle sweep (1 or 0). Filters live in support-awaiting-reply.predicate.ts,
 * admin-log-groups.query.ts and admin-user-attention.predicates.ts.
 */
export const getAdminAttentionCounts_IO = async (props: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    AttentionCountsResponse,
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  const permissionCheck = requireAdminPermission(props.currentUser);
  if (!permissionCheck.success) {
    return permissionCheck;
  }

  try {
    // DECISION: the awaiting-reply count runs entirely in SQL (support-awaiting-reply.predicate.ts).
    // A findMany with nested `messages: { take: 1 }` would pull whole thread histories, because
    // Prisma applies a nested to-many `take` in Node. No scan cap: the badge must equal the list,
    // which pages the same predicate uncapped.
    const now = new Date();
    const [
      awaitingRows,
      moderationPending,
      healthSnapshot,
      logIssuesOpen,
      paymentsAttention,
      stuckAccounts,
      lastEmailSweep,
    ] = await Promise.all([
      DB_CLIENT.use.$queryRaw<AwaitingReplyRow[]>(
        buildSupportAwaitingReplyCountQuery()
      ),
      DB_CLIENT.use.contentReport.count({
        where: { status: 'PENDING' },
      }),
      getCachedServiceHealthSnapshot(),
      countUnsettledProductionErrorGroups(),
      DB_CLIENT.use.user.count({ where: buildPaymentsAttentionWhere(now) }),
      DB_CLIENT.use.user.count({ where: buildStuckAccountsWhere(now) }),
      fetchLastEmailSweep(),
    ]);

    return success({
      support_awaiting_reply: awaitingRows[0]?.awaiting_reply ?? 0,
      moderation_pending: moderationPending,
      system_health_issues: countServiceHealthIssues(healthSnapshot),
      log_issues_open: logIssuesOpen,
      payments_attention: paymentsAttention,
      stuck_accounts: stuckAccounts,
      email_sweep_issues: isEmailSweepSilent({
        lastSweepAt: lastEmailSweep?.created_at ?? null,
        now,
      })
        ? 1
        : 0,
    });
  } catch (error) {
    return databaseFailure('getAdminAttentionCounts_IO', error);
  }
};
