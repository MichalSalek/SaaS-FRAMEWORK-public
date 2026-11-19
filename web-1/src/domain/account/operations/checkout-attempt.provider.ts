import type Stripe from 'stripe';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import { isScopedToNailfolio } from '@app/stripe/stripe.config';
import type {
  CheckoutAttemptIntent,
  CheckoutAttemptRow,
} from './checkout-attempt.types';
type AccountScope = Pick<CheckoutAttemptIntent, 'accountId'>;
import {
  AttemptBusy,
  AttemptSubscribed,
  ownedSession,
  sessionSubscription,
  terminalSubscription,
} from './checkout-attempt.policy';

type Options = () => Stripe.RequestOptions;
const MAX_PAGES = 10;

async function sessions(customer: string, options: Options, status?: 'open') {
  const found: Stripe.Checkout.Session[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await getStripe().checkout.sessions.list(
      {
        customer,
        limit: 100,
        ...(status && { status }),
        ...(cursor && { starting_after: cursor }),
      },
      options()
    );
    found.push(...result.data);
    if (!result.has_more) {
      return found;
    }
    cursor = result.data.at(-1)?.id;
    if (!cursor) {
      break;
    }
  }
  throw new AttemptBusy('Session reconciliation incomplete');
}

export async function assertNoScopedSubscription(
  customer: string,
  intent: AccountScope,
  options: Options
): Promise<{ startedAt: Date; endsAt: Date | null } | null> {
  let trial: { startedAt: Date; endsAt: Date | null } | null = null;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await getStripe().subscriptions.list(
      {
        customer,
        status: 'all',
        limit: 100,
        ...(cursor && { starting_after: cursor }),
      },
      options()
    );
    for (const sub of result.data) {
      const subCustomer =
        typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
      if (
        subCustomer !== customer ||
        sub.metadata.projectId !== STRIPE_PROJECT_ID ||
        sub.metadata.accountId !== intent.accountId ||
        !isScopedToNailfolio(sub.metadata.planId)
      ) {
        continue;
      }
      if (!terminalSubscription(sub.status)) {
        throw new AttemptSubscribed('Existing provider subscription');
      }
      if (sub.trial_start !== null && sub.trial_start !== undefined) {
        const start = sub.trial_start;
        if (
          !Number.isSafeInteger(start) ||
          start <= 0 ||
          !Number.isFinite(new Date(start * 1000).getTime())
        ) {
          throw new AttemptBusy('Invalid provider trial start');
        }
        const end = sub.trial_end;
        if (
          end != null &&
          (!Number.isSafeInteger(end) ||
            end < start ||
            !Number.isFinite(new Date(end * 1000).getTime()))
        ) {
          throw new AttemptBusy('Invalid provider trial end');
        }
        if (!trial || start * 1000 < trial.startedAt.getTime()) {
          trial = {
            startedAt: new Date(start * 1000),
            endsAt: end == null ? null : new Date(end * 1000),
          };
        }
      }
    }
    if (!result.has_more) {
      return trial;
    }
    cursor = result.data.at(-1)?.id;
    if (!cursor) {
      break;
    }
  }
  throw new AttemptBusy('Subscription reconciliation incomplete');
}

export async function findAttemptSession(
  row: CheckoutAttemptRow,
  intent: AccountScope,
  options: Options
): Promise<Stripe.Checkout.Session | null> {
  if (!row.customer_id) {
    return null;
  }
  if (row.stripe_session_id) {
    const session = await getStripe().checkout.sessions.retrieve(
      row.stripe_session_id,
      {},
      options()
    );
    if (
      !ownedSession(session, intent, row.customer_id) ||
      session.metadata?.attemptId !== row.attempt_id
    ) {
      throw new AttemptBusy('Unverified session owner');
    }
    return session;
  }
  const matches = (await sessions(row.customer_id, options)).filter(
    session =>
      ownedSession(session, intent, row.customer_id ?? '') &&
      session.metadata?.attemptId === row.attempt_id
  );
  if (matches.length > 1) {
    throw new AttemptBusy('Ambiguous attempt sessions');
  }
  return matches[0] ?? null;
}

export async function assertSessionSubscriptionTerminal(
  session: Stripe.Checkout.Session,
  options: Options
): Promise<void> {
  const id = sessionSubscription(session);
  if (!id) {
    if (session.status === 'complete') {
      throw new AttemptSubscribed('Completed session awaiting subscription');
    }
    return;
  }
  const subscription = await getStripe().subscriptions.retrieve(
    id,
    {},
    options()
  );
  if (!terminalSubscription(subscription.status)) {
    throw new AttemptSubscribed('Existing subscription');
  }
}

export async function expireOwnedSession(
  session: Stripe.Checkout.Session,
  intent: AccountScope,
  customer: string,
  options: Options
): Promise<Stripe.Checkout.Session> {
  if (!ownedSession(session, intent, customer)) {
    throw new AttemptBusy('Unverified session owner');
  }
  await assertSessionSubscriptionTerminal(session, options);
  if (session.status === 'expired') {
    return session;
  }
  if (session.status !== 'open') {
    throw new AttemptSubscribed('Completed session');
  }
  try {
    await getStripe().checkout.sessions.expire(session.id, {}, options());
  } catch {
    // Expiry may lose to confirmation. Read the winner, never create on an ambiguous outcome.
  }
  const after = await getStripe().checkout.sessions.retrieve(
    session.id,
    {},
    options()
  );
  if (!ownedSession(after, intent, customer)) {
    throw new AttemptBusy('Unverified expiry response');
  }
  await assertSessionSubscriptionTerminal(after, options);
  if (after.status !== 'expired') {
    if (after.status === 'complete') {
      throw new AttemptSubscribed('Confirmation won expiry');
    }
    throw new AttemptBusy('Expiry not confirmed');
  }
  return after;
}

/** Bootstrap only sessions explicitly bound to this Nailfolio account; foreign/unmarked objects stay untouched. */
export async function reconcileLegacySessions(
  customer: string,
  intent: AccountScope,
  currentAttempt: string,
  options: Options
): Promise<void> {
  await assertNoScopedSubscription(customer, intent, options);
  const open = await sessions(customer, options, 'open');
  for (const session of open) {
    if (
      !ownedSession(session, intent, customer) ||
      session.metadata?.attemptId === currentAttempt
    ) {
      continue;
    }
    await expireOwnedSession(session, intent, customer, options);
  }
  await assertNoScopedSubscription(customer, intent, options);
}
