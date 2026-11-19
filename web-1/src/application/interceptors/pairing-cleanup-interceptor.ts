// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic jobs).

/**
 * PAIRING CLEANUP JOB
 *
 * Due every 24 h. Deletes expired pairing tokens. Cross-process exclusion is the scheduler's
 * durable lease (JobLease); the session-level advisory lock this job used to take was dropped
 * because its unlock could land on another PgBouncer backend and miss. A repeated delete matches
 * 0 rows, so a body that outlives a lost lease only repeats a 0-row delete.
 */

import { TIME } from '@kernel/application/constants.config';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { cleanupExpiredTokens_IO } from '@domain/pairing/operations/pairing-cleanup.operations';
import { reportIssueBackend } from '@app/debugger/error-handler';

export const pairingCleanupJob = defineScheduledJob({
  name: 'pairing-cleanup',
  wakesOnTick: true,
  intervalMs: TIME.MS_PER_DAY,
  run: async () => {
    const result = await cleanupExpiredTokens_IO();

    if (result.deleted > 0) {
      reportIssueBackend({
        namespace: 'pairingCleanupInterceptor',
        message: `Deleted ${result.deleted} expired pairing sessions`,
        payload: { deleted: result.deleted },
        mode: 'info',
      });
    }
  },
});
