import { randomUUID } from 'node:crypto';
import {
  success,
  failure,
  type OperationResult,
} from '@kernel/application/result.types';
import type {
  CheckoutAttemptError,
  CheckoutAttemptIntent,
  CheckoutAttemptResult,
  PrepareCheckout,
} from './checkout-attempt.types';
import {
  attemptStore as store,
  readOwnedAccount,
  AttemptDatabaseFailure,
} from './checkout-attempt.database';
import { AttemptBusy, AttemptSubscribed } from './checkout-attempt.policy';
import {
  assertNoScopedSubscription,
  reconcileLegacySessions,
} from './checkout-attempt.provider';
import { retireExisting, runFlow } from './checkout-attempt.flow';
import { context, PreparationFailure } from './checkout-attempt.context';

function resultError(error: unknown, accountId: string): CheckoutAttemptError {
  if (error instanceof AttemptDatabaseFailure) {
    return { type: 'DATABASE_ERROR', operation: 'checkoutAttempt' };
  }
  if (error instanceof PreparationFailure) {
    return error.failure;
  }
  if (error instanceof AttemptSubscribed) {
    return { type: 'CHECKOUT_FREE_PLAN_CONFLICT', accountId };
  }
  if (error instanceof AttemptBusy) {
    return { type: 'CHECKOUT_ATTEMPT_BUSY', accountId, retryAfterSeconds: 5 };
  }
  return {
    type: 'ACCOUNT_STRIPE_ERROR',
    operation: 'checkoutAttempt',
    stripeError: 'Checkout reconciliation failed',
  };
}
function guardSubscription(
  account: NonNullable<Awaited<ReturnType<typeof readOwnedAccount>>>
): void {
  if (
    account.subscription_id &&
    (account.subscription_status === null ||
      !['CANCELED', 'INCOMPLETE_EXPIRED'].includes(account.subscription_status))
  ) {
    throw new AttemptSubscribed('Existing account subscription');
  }
}

export async function runCheckoutAttempt_IO({
  intent,
  prepare,
}: {
  intent: CheckoutAttemptIntent;
  prepare: PrepareCheckout;
}): Promise<OperationResult<CheckoutAttemptResult, CheckoutAttemptError>> {
  let owner: string | null = null;
  try {
    const account = await readOwnedAccount(intent.userId, intent.accountId);
    if (!account) {
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: intent.accountId,
      });
    }
    guardSubscription(account);
    const token = randomUUID();
    const row = await store.claim(intent.accountId, token);
    if (!row) {
      throw new AttemptBusy('Lease held');
    }
    owner = token;
    const ctx = context(intent, token, row);
    if (row.customer_id && row.customer_id !== account.stripe_customer_id) {
      throw new AttemptBusy('Customer mismatch');
    }
    if (account.stripe_customer_id) {
      await assertNoScopedSubscription(
        account.stripe_customer_id,
        intent,
        ctx.options
      );
    }
    return success(await runFlow(row, ctx, prepare));
  } catch (error) {
    return failure(resultError(error, intent.accountId));
  } finally {
    if (owner) {
      await store.release(intent.accountId, owner).catch(() => undefined);
    }
  }
}

type RetireInput = {
  userId: string;
  accountId?: string;
  commit?: (fence: {
    accountId: string;
    owner: string;
  }) => Promise<OperationResult<unknown, CheckoutAttemptError>>;
};
export async function retireCheckoutAttempt_IO({
  userId,
  accountId,
  commit,
}: RetireInput): Promise<OperationResult<void, CheckoutAttemptError>> {
  let owner: string | null = null;
  let id = accountId ?? '';
  try {
    const account = await readOwnedAccount(userId, accountId);
    if (!account) {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: id });
    }
    id = account.account_id;
    guardSubscription(account);
    const token = randomUUID();
    const row = await store.claim(id, token);
    if (!row) {
      throw new AttemptBusy('Lease held');
    }
    owner = token;
    // Provider helpers only inspect accountId; no price or user intent is synthesized.
    const scope = { accountId: id } as CheckoutAttemptIntent;
    const ctx = context(scope, token, row);
    if (row.customer_id && row.customer_id !== account.stripe_customer_id) {
      throw new AttemptBusy('Customer mismatch');
    }
    if (account.stripe_customer_id) {
      await assertNoScopedSubscription(
        account.stripe_customer_id,
        scope,
        ctx.options
      );
    }
    await retireExisting(row, ctx);
    if (account.stripe_customer_id) {
      await reconcileLegacySessions(
        account.stripe_customer_id,
        scope,
        '',
        ctx.options
      );
    }
    if (commit) {
      const result = await commit({ accountId: id, owner: token });
      if (!result.success) {
        return failure(result.error);
      }
    }
    return success(undefined);
  } catch (error) {
    return failure(resultError(error, id));
  } finally {
    if (owner) {
      await store.release(id, owner).catch(() => undefined);
    }
  }
}
