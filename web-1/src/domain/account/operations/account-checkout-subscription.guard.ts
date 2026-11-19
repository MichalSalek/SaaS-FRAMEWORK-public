import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';

/** Existing subscriptions must be recovered or managed, never duplicated by checkout. */
export async function guardNewSubscription_IO(userId: string) {
  let account;
  try {
    const user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: {
        stylist_account: {
          select: {
            account_id: true,
            subscription_id: true,
            subscription_status: true,
          },
        },
      },
    });
    account = user?.stylist_account;
  } catch (error) {
    return databaseFailure('createCheckoutSession:fetchAccount', error);
  }
  if (!account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND' as const, accountId: userId });
  }
  if (
    account.subscription_id &&
    !['CANCELED', 'INCOMPLETE_EXPIRED'].includes(
      account.subscription_status ?? ''
    )
  ) {
    return failure({
      type: 'CHECKOUT_FREE_PLAN_CONFLICT' as const,
      accountId: account.account_id,
    });
  }
  return success({ accountId: account.account_id });
}
