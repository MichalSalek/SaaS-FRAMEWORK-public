import { DB_CLIENT } from '@app/db/db.client';
import {
  SubscriptionStatusValue,
  AccountStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

const SEVEN_DAYS_MS = 7 * TIME.MS_PER_DAY;

/**
 * Daily sweep from current_period_end, not account_expiration_date.
 * updateMany matches only rows still in the source state, so a repeat run changes nothing.
 * Test: web-1/src/domain/account/operations/account-expiry-sweep.operation.test.ts
 * (where-clause shape; not two overlapping runs).
 * DECISION: EXPIRING requires cancel_at_period_end. Without it a healthy auto-renew
 * matched in its last 7 days and left the directory until the renewal webhook.
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
