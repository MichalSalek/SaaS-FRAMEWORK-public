import type Stripe from 'stripe';
import type {
  CheckoutAttemptError,
  CheckoutAttemptIntent,
  CheckoutAttemptRow,
} from './checkout-attempt.types';
import { AttemptBusy, attemptBudget } from './checkout-attempt.policy';

export class PreparationFailure extends Error {
  constructor(readonly failure: CheckoutAttemptError) {
    super('Checkout preparation failed');
  }
}
export type Context = {
  intent: CheckoutAttemptIntent;
  owner: string;
  options: () => Stripe.RequestOptions;
};
export const fence = (row: CheckoutAttemptRow, ctx: Context) => {
  if (!row.attempt_id) {
    throw new AttemptBusy('Missing attempt generation');
  }
  return {
    accountId: ctx.intent.accountId,
    owner: ctx.owner,
    attemptId: row.attempt_id,
  };
};
export const required = (
  row: CheckoutAttemptRow | null
): CheckoutAttemptRow => {
  if (!row) {
    throw new AttemptBusy('Lease lost');
  }
  return row;
};

export function context(
  intent: CheckoutAttemptIntent,
  owner: string,
  row: CheckoutAttemptRow
): Context {
  return { intent, owner, options: attemptBudget(row) };
}
