// DECISION (nie usuwaj tego komentarza):
// Sweep odpalany przez request interceptor (NIE external cron). Świadoma decyzja
// Korekta 2026-07-19: uptime monitor jest DB-free i NIE jest traffic floorem.
// Sweep planuje się dopiero po zaakceptowanym ruchu aplikacji, gdy DB już była potrzebna.
// Monitoring: "last sweep at" w admin /health; >48h = sygnał do oceny external crona.

/**
 * IMPERSONATION BACKUP CLEANUP INTERCEPTOR
 *
 * D23 (run 25): sweeps expired ImpersonationBackup rows.
 *
 * Runs once per 24h per instance. Fire-and-forget — doesn't block requests.
 * Triggered by HTTP middleware (every request checks the in-memory throttle).
 *
 * Most rows are deleted synchronously on switch-back; the interceptor is a
 * safety net for backups created when the admin never returned (browser
 * crash, tab close, instance restart).
 *
 * Throttle + timing + NEVER-throw catch = createSweepInterceptor (BDX W4.1).
 */

import { TIME } from '@kernel/application/constants.config';
import { createSweepInterceptor } from '@app/interceptors/create-sweep-interceptor';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { sweepExpiredImpersonationBackups } from './impersonation-backup.utils';

export const impersonationBackupCleanupInterceptor = createSweepInterceptor({
  name: 'impersonation-backup-cleanup',
  throttleMs: TIME.MS_PER_DAY,
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
