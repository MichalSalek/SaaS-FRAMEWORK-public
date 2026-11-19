import type Stripe from 'stripe';
import { acquireAdvisoryXactLock } from '@app/db/lock-rows';
import { findAccountByCustomerId } from '@app/stripe/webhooks/stripe-webhooks.db';
import { extractCustomerId } from '@app/stripe/webhooks/stripe-webhooks.utils';
import type { Prisma } from '../../../../prisma/js-client';
import { lockUserRow } from '@app/db/lock-rows';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { buildCriticalAlertEffect } from '@app/stripe/webhooks/stripe-webhooks.utils';
import type { StripeWebhookEffect } from '@app/stripe/webhooks/stripe-effects.types';

type Attempt = {
  attempt_id: string | null;
  phase: string;
  stripe_session_id: string | null;
  stripe_subscription_id: string | null;
};

/** Keep the generation stable until the webhook transaction's plan write commits. */
export async function acceptsCheckoutAttempt({
  tx,
  userId,
  accountId,
  attemptId,
  sessionId,
  subscriptionId,
  subscriptionEvent,
}: {
  tx: Prisma.TransactionClient | undefined;
  userId: string;
  accountId: string;
  attemptId: string;
  sessionId?: string;
  subscriptionId?: string;
  subscriptionEvent?: boolean;
}): Promise<boolean> {
  if (!tx) {
    throw new Error('Tagged Stripe event requires a database transaction');
  }
  if (!(await lockUserRow(tx, userId))) {
    return false;
  }
  // lock-discipline-allow: global order User -> CheckoutAttempt -> StylistAccount
  const rows = await tx.$queryRaw<
    Attempt[]
  >`SELECT attempt_id::text, phase, stripe_session_id, stripe_subscription_id FROM "CheckoutAttempt" WHERE account_id = ${accountId} FOR SHARE`;
  const row = rows[0];
  // Only when no authoritative generation exists may the canonical subscription identify a legacy recovery event.
  if (subscriptionEvent && subscriptionId && (!row || !row.attempt_id)) {
    const account = await tx.stylistAccount.findUnique({
      where: { account_id: accountId },
      select: { subscription_id: true },
    });
    return account?.subscription_id === subscriptionId;
  }
  return (
    Boolean(row) &&
    row?.attempt_id === attemptId &&
    row.phase !== 'expired' &&
    row.phase !== 'empty' &&
    (!sessionId ||
      !row.stripe_session_id ||
      row.stripe_session_id === sessionId) &&
    (!subscriptionId ||
      !row.stripe_subscription_id ||
      row.stripe_subscription_id === subscriptionId)
  );
}

/** Surface a potentially paid unexpected event without disclosing customer or session data. */
export function reportUnexpectedAttempt(
  accountId: string,
  active: boolean
): StripeWebhookEffect[] {
  reportIssueBackend({
    namespace: 'STRIPE_UNEXPECTED_CHECKOUT_ATTEMPT',
    message: 'Stripe event did not match the current checkout attempt',
    payload: { accountId },
    mode: active ? 'error' : 'warn',
  });
  if (!active) {
    return [];
  }
  return [
    buildCriticalAlertEffect({
      context: 'STRIPE_UNEXPECTED_CHECKOUT_ATTEMPT',
      alert: {
        alertTitle: 'Nieoczekiwana aktywna subskrypcja',
        alertMessage:
          'Aktywne zdarzenie płatności nie pasuje do bieżącej próby. Sprawdź konto ręcznie; plan i subskrypcje nie zostały zmienione.',
        details: { accountId },
      },
    }),
  ];
}

export async function acceptsSubscriptionEvent({
  tx,
  accountId,
  userId,
  subscription,
  effects,
}: {
  tx: Prisma.TransactionClient | undefined;
  accountId: string;
  userId: string;
  subscription: Stripe.Subscription;
  effects: StripeWebhookEffect[];
}): Promise<boolean> {
  const attemptId = subscription.metadata?.attemptId;
  if (!attemptId) {
    return true;
  }
  if (!tx) {
    throw new Error('Tagged Stripe event requires a database transaction');
  }
  let accepted =
    subscription.metadata.accountId === accountId &&
    (await acceptsCheckoutAttempt({
      tx,
      accountId,
      userId,
      attemptId,
      subscriptionId: subscription.id,
      subscriptionEvent: true,
    }));
  if (accepted) {
    const current = await tx.stylistAccount.findUnique({
      where: { account_id: accountId },
      select: { subscription_id: true, subscription_status: true },
    });
    if (
      current?.subscription_id &&
      current.subscription_id !== subscription.id &&
      current.subscription_status !== 'CANCELED' &&
      current.subscription_status !== 'INCOMPLETE_EXPIRED'
    ) {
      accepted = false;
    }
  }
  if (!accepted) {
    effects.push(
      ...reportUnexpectedAttempt(
        accountId,
        ['active', 'trialing', 'past_due'].includes(subscription.status)
      )
    );
  }
  return accepted;
}

/** Read only already-present data. The item price wins over subscription metadata. */
function localPlanId(
  subscription: Stripe.Subscription,
  prefetchedPlanId: string | null | undefined
): string | undefined {
  if (typeof prefetchedPlanId === 'string' && prefetchedPlanId.length > 0) {
    return prefetchedPlanId;
  }
  if (prefetchedPlanId === null && !subscription.metadata?.attemptId) {
    return undefined;
  }
  if (
    subscription.metadata?.attemptId &&
    !Array.isArray(subscription.items?.data)
  ) {
    throw new Error('Tagged subscription event requires subscription items');
  }
  const price = subscription.items?.data?.[0]?.price;
  if (price) {
    const product = price.product;
    const productPlan =
      typeof product === 'object' && product !== null && 'metadata' in product
        ? product.metadata?.planId
        : undefined;
    const plan = productPlan || price.metadata?.planId;
    if (plan) {
      return plan;
    }
  } else if (subscription.metadata?.planId) {
    return subscription.metadata.planId;
  }
  if (subscription.metadata?.attemptId) {
    throw new Error(
      'Tagged subscription event requires prefetched or expanded plan data'
    );
  }
  return undefined;
}

/** Gate the created fan-in before its separate trial timestamp write. */
export async function guardSubscriptionCreated({
  tx,
  subscription,
  prefetchedPlanId,
}: {
  tx: Prisma.TransactionClient | undefined;
  subscription: Stripe.Subscription;
  prefetchedPlanId: string | null | undefined;
}): Promise<{
  planId: string | null | undefined;
  rejected: StripeWebhookEffect[] | null;
}> {
  if (!subscription.metadata?.attemptId) {
    return { planId: prefetchedPlanId, rejected: null };
  }
  if (!tx) {
    throw new Error('Tagged Stripe event requires a database transaction');
  }
  const customer = extractCustomerId({ customer: subscription.customer });
  if (!customer) {
    return { planId: prefetchedPlanId, rejected: [] };
  }
  await acquireAdvisoryXactLock(tx, customer);
  const account = await findAccountByCustomerId(customer, tx);
  if (!account) {
    return { planId: prefetchedPlanId, rejected: [] };
  }
  const planId = localPlanId(subscription, prefetchedPlanId) ?? null;
  const effects: StripeWebhookEffect[] = [];
  const ok = await acceptsSubscriptionEvent({
    tx,
    accountId: account.account_id,
    userId: account.created_by_user_id,
    subscription,
    effects,
  });
  return { planId, rejected: ok ? null : effects };
}

export async function guardUpdatedSubscription({
  tx,
  customerId,
  prefetchedPlanId,
  subscription,
  effects,
}: {
  tx: Prisma.TransactionClient | undefined;
  customerId: string;
  prefetchedPlanId: string | null | undefined;
  subscription: Stripe.Subscription;
  effects: StripeWebhookEffect[];
}) {
  const account = await findAccountByCustomerId(customerId, tx);
  if (!account) {
    return null;
  }
  const extractedPlanId = localPlanId(subscription, prefetchedPlanId);
  if (
    !(await acceptsSubscriptionEvent({
      tx,
      accountId: account.account_id,
      userId: account.created_by_user_id,
      subscription,
      effects,
    }))
  ) {
    return null;
  }
  if (!subscription.metadata?.attemptId) {
    return { account, extractedPlanId };
  }
  const refreshed = await findAccountByCustomerId(customerId, tx);
  if (!refreshed || refreshed.account_id !== account.account_id) {
    throw new Error('Subscription account changed while locking');
  }
  return { account: refreshed, extractedPlanId };
}
