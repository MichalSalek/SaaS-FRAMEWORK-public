// DECISION (nie usuwaj tego komentarza):
// Sweep odpalany przez request interceptor (NIE external cron) — ten sam wzorzec co
// pozostałe cleanup-interceptory (event-log, exchange-code, impersonation-backup).
// Korekta 2026-07-19: DB-free uptime monitor NIE jest traffic floorem; sweep startuje
// dopiero po zaakceptowanym ruchu aplikacji, gdy DB już była potrzebna.
//
// Better Auth NIE czyści tabeli Session po wygaśnięciu — expiry sprawdza tylko przy
// odczycie, a każdy dev-login / smoke-test / impersonation mintuje nowy wiersz →
// tabela rośnie bez limitu (audyt 2026-07-11: test-stylist miał 616 sesji, 609
// wygasłych). Usunięcie WYGASŁEGO wiersza jest bezpieczne dla wszystkich
// konsumentów: BA odrzuca wygasłe sesje, switch-back impersonacji odrzuca wygasłą
// sesję powrotną (backup na wygasłej sesji jest już martwy), a
// getAllSessionsOfUser_IO filtruje `expires > now`.

/**
 * EXPIRED-SESSION CLEANUP INTERCEPTOR
 *
 * Sweeps Session rows past their `expires` timestamp (48h TTL —
 * SESSION_EXPIRES_IN_SECONDS in kernel auth.config). Live sessions are never
 * touched; the delete is idempotent, so redundant multi-instance runs are a
 * 0-affect no-op.
 *
 * Runs once per 24h per instance. Fire-and-forget — never blocks requests.
 * Throttle + timing + NEVER-throw catch = createSweepInterceptor (BDX W4.1).
 */

import { TIME } from '@kernel/application/constants.config';
import { createSweepInterceptor } from './create-sweep-interceptor';
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

export const expiredSessionCleanupInterceptor = createSweepInterceptor({
  name: 'expired-session-cleanup',
  throttleMs: TIME.MS_PER_DAY,
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
