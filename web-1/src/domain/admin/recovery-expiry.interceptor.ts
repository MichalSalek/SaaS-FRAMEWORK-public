// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic jobs).

/**
 * Moves soft-deleted accounts past RECOVERY_CONFIG.MAX_DAYS into DeletedUser
 * (snapshot, then delete the User so the email is freed) and emits
 * USER_ACCOUNT_MOVED_TO_ARCHIVE. Due every 24h on the job lease; does not block
 * requests. A losing concurrent delete hits P2025 and that transaction rolls
 * back. Batch of 50 per run. Uses index [recovery_available, deleted_at].
 * See expireMoveRecoveryWindows_IO.
 */

import { TIME } from '@kernel/application/constants.config';
import {
  defineScheduledJob,
  unwrapJobResult,
} from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { expireMoveRecoveryWindows_IO } from '@domain/user/operations/user-soft-delete.operations';

export const recoveryExpiryJob = defineScheduledJob({
  name: 'recovery-expiry',
  wakesOnTick: true,
  intervalMs: TIME.MS_PER_DAY,
  run: async () => {
    const data = unwrapJobResult(
      'recovery-expiry',
      await expireMoveRecoveryWindows_IO()
    );

    if (data.moved > 0) {
      reportIssueBackend({
        namespace: 'recoveryExpiryInterceptor',
        message: `Moved ${data.moved} expired account(s) to archive (90d MOVE)`,
        payload: { moved: data.moved },
        mode: 'info',
      });

      // Audit log: batch event for accounts moved to the permanent archive
      const systemActorId = await resolveSystemActorId_IO();
      void recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_ACCOUNT_MOVED_TO_ARCHIVE,
        user: systemActorId ? { id: systemActorId } : null,
        requestBody: { moved: data.moved },
      });
    }
  },
});
