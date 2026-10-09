// DECISION (nie usuwaj tego komentarza):
// Sweep odpalany przez request interceptor (NIE external cron) — ten sam wzorzec co
// pozostałe cleanup-interceptory (impersonation-backup, recovery-expiry). Korekta
// 2026-07-19: DB-free uptime monitor NIE jest traffic floorem; sweep startuje dopiero
// po zaakceptowanym ruchu aplikacji, gdy DB już była potrzebna.
//
// Scope = WYŁĄCZNIE prefix `xchg:`. NIE czyścimy całej tabeli Verification: magic-link
// i one-time-token plugin trzymają tam własne wpisy o innym cyklu życia, którymi
// zarządza Better Auth — sweep po `expiresAt < now` na całej tabeli mógłby kolidować
// z ich logiką. `xchg:` to nasz custom flow (BA nie auto-czyści), więc tylko on.

/**
 * EXCHANGE-CODE CLEANUP INTERCEPTOR
 *
 * Sweeps orphan `xchg:` Verification rows — exchange codes minted during an
 * OAuth/magic-link login that were never redeemed (tab closed between the 302
 * redirect and the SPA's XHR). Redeemed codes are burned synchronously on
 * exchange; this is the safety net for the abandoned ones.
 *
 * Runs once per 24h per instance. Fire-and-forget — never blocks requests.
 * Throttle + timing + NEVER-throw catch = createSweepInterceptor (BDX W4.1).
 */

import { TIME } from '@kernel/application/constants.config';
import { createSweepInterceptor } from '@app/interceptors/create-sweep-interceptor';
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

export const exchangeCodeCleanupInterceptor = createSweepInterceptor({
  name: 'exchange-code-cleanup',
  throttleMs: TIME.MS_PER_DAY,
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
