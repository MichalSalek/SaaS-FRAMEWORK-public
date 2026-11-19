// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic jobs).
//
// Better Auth does not purge the Session table after expiry (it checks expiry only on read), and
// every dev-login / smoke test / impersonation mints a new row, so the table grows unbounded.
// Deleting an EXPIRED row is safe for every consumer: BA rejects expired sessions, impersonation
// switch-back rejects an expired return session, and getAllSessionsOfUser_IO filters
// `expires > now`.

/**
 * EXPIRED-SESSION CLEANUP JOB
 *
 * Sweeps Session rows past their `expires` timestamp (48h TTL —
 * SESSION_EXPIRES_IN_SECONDS in kernel auth.config). Live sessions are never
 * touched; a repeated delete matches 0 rows, so redundant multi-instance runs
 * are a no-op (no test pins this).
 *
 * Due every 24h (durable lease in JobLease, one run per interval across processes). Fire-and-forget — never blocks requests.
 */

import { TIME } from '@kernel/application/constants.config';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { DB_CLIENT } from '@app/db/db.client';

/** Delete Session rows past their expiry. Returns the deleted count. */
export const sweepExpiredSessions = async (): Promise<{
  deleted: number;
}> => {
  const { count } = await DB_CLIENT.use.session.deleteMany({
    where: {
      expires: { lt: new Date() },
    },
  });
  return { deleted: count };
};

export const expiredSessionCleanupJob = defineScheduledJob({
  name: 'expired-session-cleanup',
  wakesOnTick: true,
  intervalMs: TIME.MS_PER_DAY,
  run: async () => {
    const { deleted } = await sweepExpiredSessions();

    if (deleted > 0) {
      reportIssueBackend({
        namespace: 'expiredSessionCleanupInterceptor',
        message: `Deleted ${deleted} expired session rows`,
        payload: { deleted },
        mode: 'info',
      });
    }
  },
});
