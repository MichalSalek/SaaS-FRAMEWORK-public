// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic jobs).

/**
 * EVENT LOG CLEANUP JOB
 *
 * Due every 24h (durable lease in JobLease, one run per interval across processes). Fire-and-forget — doesn't block requests.
 * Reuses cleanupOldEventLogs_IO which handles age-based + count-based retention
 * via RuntimeConfig keys (EVENT_LOG_MAX_AGE_DAYS, EVENT_LOG_MAX_RECORDS).
 *
 * No advisory lock needed: cleanup targets the AppLogs DB (separate from main),
 * and deleteMany on already-deleted records is a no-op. Concurrent instances
 * running simultaneously just produce redundant 0-delete operations.
 *
 */

import { TIME } from '@kernel/application/constants.config';
import {
  defineScheduledJob,
  unwrapJobResult,
} from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { cleanupOldEventLogs_IO } from './operations/admin-logs.operations';

export const eventLogCleanupJob = defineScheduledJob({
  name: 'event-log-cleanup',
  wakesOnTick: true,
  intervalMs: TIME.MS_PER_DAY,
  run: async () => {
    const data = unwrapJobResult(
      'event-log-cleanup',
      await cleanupOldEventLogs_IO({})
    );

    if (data.deleted > 0) {
      reportIssueBackend({
        namespace: 'eventLogCleanupInterceptor',
        message: `Deleted ${data.deleted} old event log records`,
        payload: { deleted: data.deleted },
        mode: 'info',
      });
    }
  },
});
