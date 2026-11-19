import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import type { OperationResult } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { attemptStore } from './checkout-attempt.database';
import { AttemptBusy, attemptBudget } from './checkout-attempt.policy';
import { stale, type PlanChangeFailure } from './plan-change-quote.operations';

export type PlanChangeLease = {
  accountId: string;
  options: () => Stripe.RequestOptions;
  live: () => Promise<boolean>;
};

/** Coordinate all local plan changes with checkout and Free using the account's durable lease. */
export async function withPlanChangeLease_IO<T>(
  accountId: string,
  run: (
    lease: PlanChangeLease
  ) => Promise<OperationResult<T, PlanChangeFailure>>
): Promise<OperationResult<T, PlanChangeFailure>> {
  const owner = randomUUID();
  let claimed = false;
  try {
    const row = await attemptStore.claim(accountId, owner);
    if (!row) {
      return stale('changed');
    }
    claimed = true;
    return await run({
      accountId,
      options: attemptBudget(row),
      live: async () => {
        const current = await attemptStore.read(accountId);
        return Boolean(
          current &&
          current.lease_owner === owner &&
          current.lease_expires_at &&
          current.lease_expires_at > current.db_now
        );
      },
    });
  } catch (error) {
    if (error instanceof AttemptBusy) {
      return stale('changed');
    }
    return databaseFailure('changePaidPlan:lease', error);
  } finally {
    if (claimed) {
      await attemptStore.release(accountId, owner).catch(() => undefined);
    }
  }
}
