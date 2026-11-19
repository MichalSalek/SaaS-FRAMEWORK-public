import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type Stripe from 'stripe';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import {
  CHECKOUT_ATTEMPT_REQUEST_MS,
  type CheckoutAttemptIntent,
  type CheckoutAttemptRow,
} from './checkout-attempt.types';

export class AttemptBusy extends Error {}
export class AttemptSubscribed extends Error {}

export const attemptFingerprint = (intent: CheckoutAttemptIntent): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        intent.accountId,
        intent.userId,
        intent.planId,
        intent.billingPeriod,
        intent.currency,
        intent.billingCountry ?? null,
        intent.mode,
        intent.automaticTax,
        intent.source ?? null,
        intent.promo?.trim() ?? null,
      ])
    )
    .digest('hex');

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Only our own preparation callback writes this JSON; validate the provider boundary on recovery.
const storedParams = z.custom<Stripe.Checkout.SessionCreateParams>(value => {
  if (
    !object(value) ||
    value.mode !== 'subscription' ||
    typeof value.customer !== 'string' ||
    !object(value.metadata) ||
    value.metadata.projectId !== STRIPE_PROJECT_ID ||
    typeof value.metadata.accountId !== 'string' ||
    typeof value.metadata.attemptId !== 'string' ||
    !Number.isSafeInteger(value.expires_at) ||
    !Array.isArray(value.line_items) ||
    value.line_items.length !== 1
  ) {
    return false;
  }
  const item: unknown = value.line_items[0];
  return (
    object(item) &&
    typeof item.price === 'string' &&
    item.quantity === 1 &&
    object(value.subscription_data) &&
    object(value.subscription_data.metadata) &&
    value.subscription_data.metadata.attemptId === value.metadata.attemptId &&
    value.subscription_data.metadata.accountId === value.metadata.accountId &&
    value.subscription_data.metadata.projectId === STRIPE_PROJECT_ID
  );
});
const metaSchema = z.object({
  returnUrl: z.string(),
  billingAddressRequired: z.boolean(),
  promoRejected: z.boolean(),
});

export const readPrepared = (row: CheckoutAttemptRow) => {
  const params = storedParams.safeParse(row.stripe_params);
  const meta = metaSchema.safeParse(row.response_meta);
  if (
    !params.success ||
    !meta.success ||
    params.data.metadata?.attemptId !== row.attempt_id ||
    params.data.metadata.accountId !== row.account_id ||
    params.data.customer !== row.customer_id ||
    !row.expires_at ||
    params.data.expires_at !== Math.floor(row.expires_at.getTime() / 1000)
  ) {
    throw new AttemptBusy('Unverified stored checkout');
  }
  return { params: params.data, meta: meta.data };
};

/** Remaining time uses a monotonic clock; every write is independently fenced by PostgreSQL now(). */
export function attemptBudget(
  row: CheckoutAttemptRow
): () => Stripe.RequestOptions {
  const start = performance.now();
  const available =
    (row.lease_expires_at?.getTime() ?? 0) - row.db_now.getTime();
  return () => {
    const remaining = available - (performance.now() - start) - 250;
    if (remaining < 100) {
      throw new AttemptBusy('Lease elapsed');
    }
    return {
      timeout: Math.min(CHECKOUT_ATTEMPT_REQUEST_MS, Math.floor(remaining)),
      maxNetworkRetries: 0,
    };
  };
}

export const sessionCustomer = (
  session: Stripe.Checkout.Session
): string | null =>
  typeof session.customer === 'string'
    ? session.customer
    : (session.customer?.id ?? null);
export const sessionSubscription = (
  session: Stripe.Checkout.Session
): string | null =>
  typeof session.subscription === 'string'
    ? session.subscription
    : (session.subscription?.id ?? null);
export const terminalSubscription = (status: string): boolean =>
  status === 'canceled' || status === 'incomplete_expired';

export function ownedSession(
  session: Stripe.Checkout.Session,
  intent: Pick<CheckoutAttemptIntent, 'accountId'>,
  customerId: string
): boolean {
  return (
    session.mode === 'subscription' &&
    sessionCustomer(session) === customerId &&
    session.metadata?.projectId === STRIPE_PROJECT_ID &&
    session.metadata.accountId === intent.accountId
  );
}
