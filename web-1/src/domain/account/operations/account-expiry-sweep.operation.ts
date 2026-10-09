import { DB_CLIENT } from '@app/db/db.client';
import {
  SubscriptionStatusValue,
  AccountStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

const SEVEN_DAYS_MS = 7 * TIME.MS_PER_DAY;

/**
 * Daily account-status expiry sweep (BUG-001).
 *
 * Replaces the per-request write-on-read in user.interceptor.ts. Drives
 * EXPIRING/EXPIRED transitions from Stripe-sourced current_period_end (NOT the
 * stale admin estimate that was account_expiration_date). Two idempotent
 * updateMany calls — re-running on already-transitioned rows is a no-op.
 *
 * Called as a `safeStep` from email-lifecycle.orchestrator (errors isolated there).
 * Uses existing @@index([subscription_status]) on StylistAccount.
 *
 * - EXPIRING: subscription ACTIVE, scheduled to cancel (cancel_at_period_end)
 *   and current_period_end within next 7 days.
 * - EXPIRED:  subscription CANCELED and current_period_end already passed.
 *
 * DECISION (nie usuwaj tego komentarza):
 * EXPIRING wymaga `cancel_at_period_end: true`. Bez tego filtra KAŻDA zdrowa,
 * auto-odnawialna subskrypcja spełniała warunek w ostatnich 7 dniach każdego
 * okresu billingowego — a publiczna widoczność (STYLIST_PUBLICLY_VISIBLE w
 * account.config.ts) jest strictly-ACTIVE, więc płacąca stylistka znikała z
 * katalogu/profilu na ~23% życia konta (przywracał ją dopiero webhook
 * odnowienia). EXPIRING = konto REALNIE wygasające (anulowane, dobiega końca
 * okresu), nie „zbliża się odnowienie".
 */
export const sweepExpiringAndExpiredAccounts_IO = async (): Promise<{
  expiring: number;
  expired: number;
}> => {
  const now = new Date();
  const soon = new Date(now.getTime() + SEVEN_DAYS_MS);

  const expiringResult = await DB_CLIENT.use.stylistAccount.updateMany({
    where: {
      subscription_status: SubscriptionStatusValue.ACTIVE,
      cancel_at_period_end: true,
      current_period_end: { gte: now, lte: soon },
      account_status: {
        notIn: [
          AccountStatusValue.EXPIRING,
          AccountStatusValue.EXPIRED,
          AccountStatusValue.NOT_ACTIVE,
        ],
      },
    },
    data: { account_status: AccountStatusValue.EXPIRING },
  });

  const expiredResult = await DB_CLIENT.use.stylistAccount.updateMany({
    where: {
      subscription_status: SubscriptionStatusValue.CANCELED,
      current_period_end: { lt: now },
      account_status: {
        notIn: [AccountStatusValue.NOT_ACTIVE, AccountStatusValue.EXPIRED],
      },
    },
    data: { account_status: AccountStatusValue.EXPIRED },
  });

  if (expiringResult.count > 0 || expiredResult.count > 0) {
    reportIssueBackend({
      namespace: 'accountExpirySweep',
      message: `Account expiry sweep: ${expiringResult.count} EXPIRING, ${expiredResult.count} EXPIRED`,
      payload: {
        expiring: expiringResult.count,
        expired: expiredResult.count,
      },
      mode: 'info',
    });
  }

  return { expiring: expiringResult.count, expired: expiredResult.count };
};
