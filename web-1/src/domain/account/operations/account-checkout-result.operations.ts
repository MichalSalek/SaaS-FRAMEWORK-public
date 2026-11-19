import { z } from 'zod';
import type Stripe from 'stripe';
import { DB_CLIENT } from '@app/db/db.client';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import { getPlanIdFromPricingPlanValue } from '@app/stripe/stripe.config';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { USER_POLICY } from '@kernel/policies/user.policy';
import type {
  AccountStatus,
  PaymentStatus,
} from '@kernel/models/db_models.generated.dto';
import { attemptStore } from './checkout-attempt.database';
import {
  ownedSession,
  sessionCustomer,
  sessionSubscription,
  readPrepared,
} from './checkout-attempt.policy';
import type { CheckoutAttemptRow } from './checkout-attempt.types';

type Target = { planId: PricingPlan; billingPeriod: 'month' | 'year' };
export type CheckoutResult = {
  status: 'pending' | 'confirmed' | 'expired' | 'unknown';
  target: Target | null;
};
const UNKNOWN: CheckoutResult = { status: 'unknown', target: null };
const intentSchema = z.object({
  userId: z.string(),
  accountId: z.string(),
  planId: z.enum(PricingPlanValue),
  billingPeriod: z.enum(['month', 'year']),
});
type Account = {
  account_id: string;
  stripe_customer_id: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  pricing_plan: PricingPlan;
  account_status: AccountStatus;
  payment_status: PaymentStatus;
  current_period_end: Date | null;
  account_expiration_date: Date | null;
};
type Dependencies = {
  account(userId: string): Promise<Account | null>;
  attempt(accountId: string): Promise<CheckoutAttemptRow | null>;
  session(id: string): Promise<Stripe.Checkout.Session>;
  subscription(id: string): Promise<Stripe.Subscription>;
};
const sameAttempt = (a: CheckoutAttemptRow, b: CheckoutAttemptRow | null) =>
  b !== null &&
  a.account_id === b.account_id &&
  a.attempt_id === b.attempt_id &&
  a.stripe_session_id === b.stripe_session_id &&
  a.customer_id === b.customer_id &&
  b.phase !== 'expired' &&
  b.phase !== 'empty';

/** Read-only: a provider failure or a changed generation can never prove a purchase. */
export async function readCheckoutResult(
  userId: string,
  sessionId: string,
  deps: Dependencies
): Promise<CheckoutResult> {
  try {
    const account = await deps.account(userId);
    if (!account) {
      return UNKNOWN;
    }
    const row = await deps.attempt(account.account_id);
    if (
      !row?.attempt_id ||
      !row.customer_id ||
      row.customer_id !== account.stripe_customer_id ||
      row.stripe_session_id !== sessionId ||
      row.phase === 'empty'
    ) {
      return UNKNOWN;
    }
    const intent = intentSchema.safeParse(row.intent);
    if (
      !intent.success ||
      intent.data.userId !== userId ||
      intent.data.accountId !== account.account_id ||
      intent.data.planId === PricingPlanValue.FREE
    ) {
      return UNKNOWN;
    }
    const { params } = readPrepared(row);
    const expectedStripePlan = getPlanIdFromPricingPlanValue(
      intent.data.planId
    );
    const expectedPrice = params.line_items?.[0]?.price;
    if (
      !expectedPrice ||
      params.client_reference_id !== userId ||
      params.metadata?.planId !== expectedStripePlan ||
      params.metadata.billingPeriod !== intent.data.billingPeriod ||
      params.subscription_data?.metadata?.planId !== expectedStripePlan ||
      params.subscription_data.metadata.billingPeriod !==
        intent.data.billingPeriod
    ) {
      return UNKNOWN;
    }
    const session = await deps.session(sessionId);
    if (
      session.id !== sessionId ||
      !ownedSession(
        session,
        { accountId: account.account_id },
        row.customer_id
      ) ||
      session.metadata?.attemptId !== row.attempt_id ||
      session.metadata.planId !== expectedStripePlan ||
      session.metadata.billingPeriod !== intent.data.billingPeriod ||
      session.client_reference_id !== userId
    ) {
      return UNKNOWN;
    }
    const target: Target = {
      planId: intent.data.planId,
      billingPeriod: intent.data.billingPeriod,
    };
    if (row.phase === 'expired' && session.status !== 'expired') {
      return UNKNOWN;
    }
    if (session.status === 'expired') {
      const fresh = await deps.attempt(account.account_id);
      return fresh?.attempt_id === row.attempt_id &&
        fresh.stripe_session_id === sessionId &&
        fresh.customer_id === row.customer_id
        ? { status: 'expired', target }
        : UNKNOWN;
    }
    if (session.status !== 'complete') {
      return sameAttempt(row, await deps.attempt(account.account_id))
        ? { status: 'pending', target }
        : UNKNOWN;
    }
    if (
      session.payment_status !== 'paid' &&
      session.payment_status !== 'no_payment_required'
    ) {
      return sameAttempt(row, await deps.attempt(account.account_id))
        ? { status: 'pending', target }
        : UNKNOWN;
    }
    const subscriptionId = sessionSubscription(session);
    if (!subscriptionId) {
      return sameAttempt(row, await deps.attempt(account.account_id))
        ? { status: 'pending', target }
        : UNKNOWN;
    }
    const subscription = await deps.subscription(subscriptionId);
    const subscriptionCustomer =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id;
    if (
      subscription.id !== subscriptionId ||
      subscriptionCustomer !== row.customer_id ||
      subscription.metadata.projectId !== STRIPE_PROJECT_ID ||
      subscription.metadata.accountId !== account.account_id ||
      subscription.metadata.attemptId !== row.attempt_id ||
      subscription.metadata.planId !== expectedStripePlan ||
      subscription.metadata.billingPeriod !== intent.data.billingPeriod ||
      subscription.items.data.length !== 1 ||
      subscription.items.data[0]?.price.id !== expectedPrice ||
      sessionCustomer(session) !== row.customer_id
    ) {
      return UNKNOWN;
    }
    const freshAccount = await deps.account(userId);
    const fresh = await deps.attempt(account.account_id);
    if (
      !sameAttempt(row, fresh) ||
      !freshAccount ||
      freshAccount.account_id !== account.account_id ||
      freshAccount.stripe_customer_id !== row.customer_id
    ) {
      return UNKNOWN;
    }
    const confirmed =
      freshAccount.subscription_id === subscription.id &&
      freshAccount.pricing_plan === target.planId &&
      USER_POLICY.utils.IS_ACCOUNT_STATUS_ACTIVE(freshAccount.account_status) &&
      freshAccount.payment_status === 'PAID' &&
      freshAccount.current_period_end !== null &&
      freshAccount.current_period_end.getTime() > Date.now() &&
      (freshAccount.account_expiration_date === null ||
        freshAccount.account_expiration_date.getTime() > Date.now()) &&
      ['ACTIVE', 'TRIALING'].includes(freshAccount.subscription_status ?? '') &&
      ['active', 'trialing'].includes(subscription.status) &&
      subscription.items.data[0]?.price.recurring?.interval ===
        target.billingPeriod &&
      (!fresh?.stripe_subscription_id ||
        fresh.stripe_subscription_id === subscription.id);
    return { status: confirmed ? 'confirmed' : 'pending', target };
  } catch {
    return UNKNOWN;
  }
}

export function getCheckoutResult_IO(
  userId: string,
  sessionId: string
): Promise<CheckoutResult> {
  return readCheckoutResult(userId, sessionId, {
    account: id =>
      DB_CLIENT.use.stylistAccount.findFirst({
        where: { created_by_user_id: id, created_by_user: { is_active: true } },
        select: {
          account_id: true,
          stripe_customer_id: true,
          subscription_id: true,
          subscription_status: true,
          pricing_plan: true,
          account_status: true,
          payment_status: true,
          current_period_end: true,
          account_expiration_date: true,
        },
      }),
    attempt: accountId => attemptStore.read(accountId),
    session: id =>
      getStripe().checkout.sessions.retrieve(
        id,
        {},
        { timeout: 8000, maxNetworkRetries: 0 }
      ),
    subscription: id =>
      getStripe().subscriptions.retrieve(
        id,
        {},
        { timeout: 8000, maxNetworkRetries: 0 }
      ),
  });
}
