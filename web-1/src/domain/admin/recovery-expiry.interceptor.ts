// DECISION (nie usuwaj tego komentarza):
// Sweep odpalany przez request interceptor (NIE external cron). Świadoma decyzja
// Korekta 2026-07-19: uptime monitor jest DB-free i NIE jest traffic floorem.
// Sweep planuje się dopiero po zaakceptowanym ruchu aplikacji, gdy DB już była potrzebna.
// Monitoring: "last sweep at" w admin /health; >48h = sygnał do oceny external crona.

/**
 * RECOVERY EXPIRY INTERCEPTOR — 90d MOVE driver (FAZA C)
 *
 * Runs once per 24h per instance. Fire-and-forget — doesn't block requests.
 * For soft-deleted accounts past RECOVERY_CONFIG.MAX_DAYS (90d) it performs the MOVE
 * (expireMoveRecoveryWindows_IO): full snapshot -> DeletedUser.body, then DELETE the User
 * row (email freed). SUPERSEDES the legacy flip-only behavior: the in-place row is removed
 * and the DeletedUser archive row takes its place.
 *
 * Uses composite index @@index([recovery_available, deleted_at]). Concurrent-instance safety =
 * per-row idempotency (P2025 on the losing delete -> atomic rollback, no double-move), NOT an
 * advisory lock — see expireMoveRecoveryWindows_IO DECISION. Batch 50/24h (catch-up on backlog).
 *
 * Emits APP_EVENTS.INFO.USER.USER_ACCOUNT_MOVED_TO_ARCHIVE audit log when accounts are archived.
 *
 * Throttle + timing + NEVER-throw catch = createSweepInterceptor (BDX W4.1).
 * Triggered by: HTTP middleware (every request checks, executes if 24h passed).
 */

import { TIME } from '@kernel/application/constants.config';
import { createSweepInterceptor } from '@app/interceptors/create-sweep-interceptor';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { expireMoveRecoveryWindows_IO } from '@domain/user/operations/user-soft-delete.operations';

export const recoveryExpiryInterceptor = createSweepInterceptor({
  name: 'recovery-expiry',
  throttleMs: TIME.MS_PER_DAY,
  run: async () => {
    const result = await expireMoveRecoveryWindows_IO();

    if (result.success && result.data.moved > 0) {
      reportIssueBackend({
        namespace: 'recoveryExpiryInterceptor',
        message: `Moved ${result.data.moved} expired account(s) to archive (90d MOVE)`,
        payload: { moved: result.data.moved },
        mode: 'info',
      });

      // Audit log: batch event for accounts moved to the permanent archive
      const systemActorId = await resolveSystemActorId_IO();
      void recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_ACCOUNT_MOVED_TO_ARCHIVE,
        user: systemActorId ? { id: systemActorId } : null,
        requestBody: { moved: result.data.moved },
      });
    }
  },
});
