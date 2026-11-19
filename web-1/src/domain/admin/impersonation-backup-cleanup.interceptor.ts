// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic jobs).

/**
 * IMPERSONATION BACKUP CLEANUP JOB
 *
 * D23 (run 25): sweeps expired ImpersonationBackup rows.
 *
 * Due every 24h (durable lease in JobLease, one run per interval across processes). Fire-and-forget — doesn't block requests.
 *
 * Most rows are deleted synchronously on switch-back; the interceptor is a
 * safety net for backups created when the admin never returned (browser
 * crash, tab close, instance restart).
 *
 */

import { TIME } from '@kernel/application/constants.config';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { sweepExpiredImpersonationBackups } from './impersonation-backup.utils';

export const impersonationBackupCleanupJob = defineScheduledJob({
  name: 'impersonation-backup-cleanup',
  wakesOnTick: true,
  intervalMs: TIME.MS_PER_DAY,
  run: async () => {
    const { deleted } = await sweepExpiredImpersonationBackups();

    if (deleted > 0) {
      reportIssueBackend({
        namespace: 'impersonationBackupCleanupInterceptor',
        message: `Deleted ${deleted} expired impersonation backup rows`,
        payload: { deleted },
        mode: 'info',
      });
    }
  },
});
