import { DB_CLIENT } from '@app/db/db.client';
import type { CheckoutAttemptStore } from './checkout-attempt.types';
import { prismaCheckoutAttemptStore } from './checkout-attempt.store';
import { AttemptBusy } from './checkout-attempt.policy';

/** Preserve the failing layer without returning database error text or query parameters. */
export class AttemptDatabaseFailure extends Error {}
export async function attemptDatabase<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    throw new AttemptDatabaseFailure('Checkout database operation failed');
  }
}
export const attemptStore: CheckoutAttemptStore = {
  read: accountId =>
    attemptDatabase(() => prismaCheckoutAttemptStore.read(accountId)),
  claim: (accountId, owner) =>
    attemptDatabase(() => prismaCheckoutAttemptStore.claim(accountId, owner)),
  start: input =>
    attemptDatabase(() => prismaCheckoutAttemptStore.start(input)),
  prepared: input =>
    attemptDatabase(() => prismaCheckoutAttemptStore.prepared(input)),
  session: input =>
    attemptDatabase(() => prismaCheckoutAttemptStore.session(input)),
  expire: input =>
    attemptDatabase(() => prismaCheckoutAttemptStore.expire(input)),
  release: (accountId, owner) =>
    attemptDatabase(() => prismaCheckoutAttemptStore.release(accountId, owner)),
};

export const readOwnedAccount = (userId: string, accountId?: string) =>
  attemptDatabase(() =>
    DB_CLIENT.use.stylistAccount.findFirst({
      where: {
        created_by_user_id: userId,
        ...(accountId ? { account_id: accountId } : {}),
      },
      select: {
        account_id: true,
        stripe_customer_id: true,
        subscription_id: true,
        subscription_status: true,
        trial_started_at: true,
        payment_status: true,
      },
    })
  );

/** Recover provider history only while the account and customer still match; never overwrite history. */
export async function recoverProviderTrial(
  userId: string,
  accountId: string,
  customerId: string,
  trial: { startedAt: Date; endsAt: Date | null }
): Promise<void> {
  await attemptDatabase(
    () => DB_CLIENT.use.$executeRaw`
    UPDATE "StylistAccount"
    SET trial_started_at = (${trial.startedAt}::timestamptz AT TIME ZONE 'UTC'),
        trial_ends_at = COALESCE(trial_ends_at, (${trial.endsAt}::timestamptz AT TIME ZONE 'UTC'))
    WHERE account_id = ${accountId} AND created_by_user_id = ${userId}
      AND stripe_customer_id = ${customerId} AND trial_started_at IS NULL
  `
  );
  const account = await readOwnedAccount(userId, accountId);
  if (
    !account ||
    account.stripe_customer_id !== customerId ||
    !account.trial_started_at
  ) {
    throw new AttemptBusy('Account changed during provider trial recovery');
  }
}
