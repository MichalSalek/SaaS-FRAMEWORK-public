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
 * Counters of "things waiting for the admin" behind the admin menu badges.
 * Every counter has a list that shows exactly the counted rows, because the
 * count and the list are built from ONE predicate:
 * - support_awaiting_reply: support-awaiting-reply.predicate.ts (OPEN and the
 *   latest message is from the user), list = SUPPORT_ADMIN_GET_ALL_THREADS
 *   with `awaiting_reply: true`.
 * - moderation_pending: ContentReport rows in status PENDING.
 * - system_health_issues: health services degraded or down (the snapshot
 *   shared with ADMIN_HEALTH, cached 60 s).
 * - log_issues_open: admin-log-groups.query.ts, list = ADMIN_GET_LOG_GROUPS
 *   with `attention: true`.
 * - payments_attention / stuck_accounts: admin-user-attention.predicates.ts,
 *   list = ADMIN_GET_USERS_PAGINATED with `attention`.
 * - email_sweep_issues: 1 when the lifecycle sweep is silent
 *   (email-sweep-silence.policy.ts), else 0.
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
    // DECISION (nie usuwaj tego komentarza):
    // Licznik liczy się CAŁY w SQL, bo poprzednia wersja (findMany z zagnieżdżonym
    // `messages: { take: 1 }`) materializowała do 500 wątków RAZEM z ich wiadomościami:
    // Prisma tnie zagnieżdżone to-many `take` dopiero w Node (emitowane zapytanie dziecka
    // ma OFFSET bez LIMIT-u), więc dashboard admina przy każdym pollu ściągał całą historię
    // otwartych wątków tylko po to, by policzyć jedną liczbę. Dziś to zwykły COUNT po
    // predykacie „czeka na odpowiedź" (support-awaiting-reply.predicate.ts): z bazy
    // wychodzi wyłącznie sender_type ostatniej wiadomości. Dawny strop skanu 500
    // najnowszych wątków OPEN zniknął (S126), bo lista pod badge'em stronicuje ten sam
    // predykat bez stropu, a licznik ma być równy liście; wątek bez wiadomości dalej
    // wypada, tak jak wcześniej.
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
