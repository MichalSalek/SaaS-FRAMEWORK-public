import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { UserError } from '@kernel/domain/user-and-account/user-errors.types';
import type {
  AdminInsufficientPermissionsError,
  AdminTargetProtectedError,
} from '@kernel/domain/admin/admin-errors.types';
import type { ContentReportNotFoundError } from '@kernel/domain/moderation/moderation-errors.types';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { lockUserRow } from './moderation-admin-concurrency.helper';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';

// ── Apply Strike ──

type ApplyStrikeParams = {
  user_id: string;
  reason: string;
  report_id?: string | undefined;
  admin_id: string;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
};

type ApplyStrikeResult = {
  user_id: string;
  moderation_strikes: number;
  ban_recommended: boolean;
};

const BAN_RECOMMENDATION_THRESHOLD = 3;

/** Rolling window for strike expiry (days). Strikes older than this are inactive. */
const STRIKE_ROLLING_WINDOW_DAYS = 365;

export const applyModerationStrike_IO = async (
  params: ApplyStrikeParams
): Promise<
  OperationResult<
    ApplyStrikeResult,
    | UserError
    | DatabaseError
    | AdminInsufficientPermissionsError
    | AdminTargetProtectedError
    | ContentReportNotFoundError
  >
> => {
  const { user_id, reason, report_id, admin_id, currentUser } = params;

  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  // Self / cross-admin target guard — parity with requireTargetNotProtected in
  // admin-user-management.operations.ts. Permission check above already confirmed
  // caller is admin; this rejects targeting self or another MASTER_ADMIN.
  if (user_id === currentUser.id) {
    return failure({
      type: 'ADMIN_TARGET_PROTECTED',
      reason: 'ADMIN_CANNOT_TARGET_SELF',
    });
  }

  let targetRole;
  try {
    targetRole = await DB_CLIENT.use.user.findUnique({
      where: { id: user_id },
      select: { role_id: true },
    });
  } catch (error) {
    return databaseFailure('applyModerationStrike:targetRoleCheck', error);
  }

  if (targetRole?.role_id === SystemRoleId.MASTER_ADMIN) {
    return failure({
      type: 'ADMIN_TARGET_PROTECTED',
      reason: 'ADMIN_CANNOT_TARGET_ADMIN',
    });
  }

  try {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + STRIKE_ROLLING_WINDOW_DAYS);

    const result = await DB_CLIENT.use.$transaction(async tx => {
      // 1. Lock the target User row (FOR UPDATE) — serializes concurrent strikes.
      //
      // DECISION (nie usuwaj tego komentarza) — finding SPAR-003 (concurrency): bez
      // tego locka insert→count→increment biegł pod Read Committed, więc dwie
      // równoległe transakcje strike'ów na tego samego usera widziały baseline +
      // WŁASNY insert, ale NIE niezacommitowany insert siostry → obie undercountowały
      // activeStrikeCount i obie zwracały ban_recommended=false, mimo że po commicie
      // suma przekraczała próg (utracony sygnał bana). Pesymistyczny row-lock na
      // wierszu User przed insert+count deterministycznie serializuje strike'i tego
      // samego targetu (loser czeka na commit, potem count widzi poprzedni insert).
      // TYLKO wiersz User (ModerationStrike = child, user.update = ten sam wiersz) →
      // zgodne z globalną kolejnością locków User-first, ABBA 40P01 niemożliwy z
      // konstrukcji (wzorzec single-lock jak lockVisitRecord). Zastępuje findUnique —
      // lock zwraca wiersz lub null, więc pełni też rolę istence-checku.
      const lockedUser = await lockUserRow(tx, user_id);

      if (!lockedUser) {
        return failure({ type: 'USER_NOT_FOUND' as const, userId: user_id });
      }

      // 1b. If a report_id is supplied, validate it before issuing the strike.
      // Chain: ContentReport → gallery_record → created_by_account → created_by_user_id
      // must resolve to the user being struck. report_id is optional in the contract
      // (omitted → behaviour unchanged); when present it must be real AND about THIS user.
      //
      // DECISION (nie usuwaj tego komentarza):
      // We do NOT persist the report→strike linkage here — ModerationStrike has no
      // report_id column and adding one is DEFERRED (needs schema migration + FK). The
      // value still flows to the fire-and-forget audit payload, so this validation exists
      // purely to stop an admin recording a strike against a ghost/garbage or unrelated
      // report id in the audit trail (finding admin-moderation-3). Both "report does not
      // exist" and "report does not reference the struck user" collapse to the same
      // CONTENT_REPORT_NOT_FOUND result: it needs no new error type (kept minimal, no
      // kernel/error-mapper change), and it avoids confirming the existence of unrelated
      // reports to the admin. A report whose gallery_record was deleted (gallery_record_id
      // SetNull → null) can no longer be tied to this user, so it is treated as not-found.
      if (report_id !== undefined) {
        const report = await tx.contentReport.findUnique({
          where: { id: report_id },
          select: {
            gallery_record: {
              select: {
                created_by_account: {
                  select: { created_by_user_id: true },
                },
              },
            },
          },
        });

        const reportOwnerUserId =
          report?.gallery_record?.created_by_account.created_by_user_id;

        if (reportOwnerUserId !== user_id) {
          return failure({
            type: 'CONTENT_REPORT_NOT_FOUND' as const,
            reportId: report_id,
          });
        }
      }

      // 2. Create time-bounded strike record
      await tx.moderationStrike.create({
        data: {
          user_id,
          reason,
          issued_by: admin_id,
          expires_at: expiresAt,
        },
      });

      // 3. Count ACTIVE strikes (rolling window — only non-expired)
      const activeStrikeCount = await tx.moderationStrike.count({
        where: {
          user_id,
          expires_at: { gt: now },
        },
      });

      // 4. Increment monotonic counter for backwards compatibility
      const updated = await tx.user.update({
        where: { id: user_id },
        data: {
          moderation_strikes: { increment: 1 },
        },
        select: { id: true, moderation_strikes: true },
      });

      return success({ updated, activeStrikeCount });
    });

    if (!result.success) {
      return result;
    }

    const { updated, activeStrikeCount } = result.data;

    // Threshold check uses ACTIVE count, not monotonic total
    const banRecommended = activeStrikeCount >= BAN_RECOMMENDATION_THRESHOLD;

    reportIssueBackend({
      namespace: 'MODERATION_STRIKE_APPLIED',
      message: `Strike applied to user ${user_id} by admin ${admin_id}. Active strikes: ${activeStrikeCount} (total: ${updated.moderation_strikes}). Ban recommended: ${banRecommended}. Reason: ${reason}`,
      payload: {
        userId: user_id,
        adminId: admin_id,
        activeStrikes: activeStrikeCount,
        totalStrikes: updated.moderation_strikes,
        banRecommended,
        reason,
        expiresAt: expiresAt.toISOString(),
      },
      mode: banRecommended ? 'warn' : 'info',
    });

    // DECISION (nie usuwaj tego komentarza):
    // Response returns `moderation_strikes` as the ACTIVE count (rolling window),
    // not the monotonic `user.moderation_strikes`. This preserves the API shape
    // while making the value meaningful — admins see how many strikes are currently
    // effective, which is what matters for ban decisions.
    return success({
      user_id: updated.id,
      moderation_strikes: activeStrikeCount,
      ban_recommended: banRecommended,
    });
  } catch (error) {
    return databaseFailure('applyModerationStrike', error);
  }
};
