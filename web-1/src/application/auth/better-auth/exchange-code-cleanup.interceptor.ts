// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic jobs).
//
// DECISION: scope is ONLY the `xchg:` prefix, never the whole Verification table: magic-link and the
// one-time-token plugin keep their own rows there with their own lifecycle managed by Better Auth,
// and a table-wide `expiresAt < now` sweep could collide with their logic. `xchg:` is our custom
// flow (Better Auth does not clean it), so only it.

/**
 * EXCHANGE-CODE CLEANUP JOB
 *
 * Sweeps orphan `xchg:` Verification rows — exchange codes minted during an
 * OAuth/magic-link login that were never redeemed (tab closed between the 302
 * redirect and the SPA's XHR). Redeemed codes are burned synchronously on
 * exchange; this is the safety net for the abandoned ones.
 *
 * Due every 24h (durable lease in JobLease, one run per interval across processes). Fire-and-forget — never blocks requests.
 */

import { TIME } from '@kernel/application/constants.config';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { DB_CLIENT } from '@app/db/db.client';
import { EXCHANGE_CODE_PREFIX } from './auth-token-bridge';

/** Delete expired, never-redeemed exchange-code rows. Returns the deleted count. */
export const sweepExpiredExchangeCodes = async (): Promise<{
  deleted: number;
}> => {
  const { count } = await DB_CLIENT.use.verification.deleteMany({
    where: {
      identifier: { startsWith: EXCHANGE_CODE_PREFIX },
      expiresAt: { lt: new Date() },
    },
  });
  return { deleted: count };
};

export const exchangeCodeCleanupJob = defineScheduledJob({
  name: 'exchange-code-cleanup',
  wakesOnTick: true,
  intervalMs: TIME.MS_PER_DAY,
  run: async () => {
    const { deleted } = await sweepExpiredExchangeCodes();

    if (deleted > 0) {
      reportIssueBackend({
        namespace: 'exchangeCodeCleanupInterceptor',
        message: `Deleted ${deleted} expired exchange-code rows`,
        payload: { deleted },
        mode: 'info',
      });
    }
  },
});
