import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type {
  CheckoutAttemptResult,
  CheckoutAttemptRow,
  PrepareCheckout,
} from './checkout-attempt.types';
import { attemptStore as store } from './checkout-attempt.database';
import {
  AttemptBusy,
  AttemptSubscribed,
  attemptFingerprint,
  ownedSession,
  readPrepared,
  sessionSubscription,
} from './checkout-attempt.policy';
import {
  assertNoScopedSubscription,
  assertSessionSubscriptionTerminal,
  expireOwnedSession,
  findAttemptSession,
  reconcileLegacySessions,
} from './checkout-attempt.provider';
import { freezeAttempt } from './checkout-attempt.freeze';
import { fence, required, type Context } from './checkout-attempt.context';

async function live(
  row: CheckoutAttemptRow,
  ctx: Context
): Promise<CheckoutAttemptRow> {
  const fresh = required(await store.read(row.account_id));
  if (
    fresh.lease_owner !== ctx.owner ||
    !fresh.lease_expires_at ||
    fresh.lease_expires_at <= fresh.db_now ||
    fresh.attempt_id !== row.attempt_id
  ) {
    throw new AttemptBusy('Lease lost');
  }
  return fresh;
}
async function mark(
  row: CheckoutAttemptRow,
  ctx: Context,
  session: Stripe.Checkout.Session,
  phase: 'open' | 'completed' | 'expired'
) {
  return required(
    await store.session({
      ...fence(row, ctx),
      sessionId: session.id,
      subscriptionId: sessionSubscription(session),
      phase,
    })
  );
}
async function retireRow(
  row: CheckoutAttemptRow,
  ctx: Context
): Promise<CheckoutAttemptRow> {
  return required(await store.expire(fence(row, ctx)));
}
async function handleSession(
  row: CheckoutAttemptRow,
  ctx: Context,
  session: Stripe.Checkout.Session,
  sameIntent: boolean
): Promise<{ row: CheckoutAttemptRow; result?: CheckoutAttemptResult }> {
  if (session.status === 'complete') {
    try {
      await assertSessionSubscriptionTerminal(session, ctx.options);
    } catch (error) {
      if (error instanceof AttemptSubscribed) {
        await mark(row, ctx, session, 'completed');
      }
      throw error;
    }
    return { row: await retireRow(row, ctx) };
  }
  if (session.status === 'expired') {
    await assertSessionSubscriptionTerminal(session, ctx.options);
    return { row: await retireRow(row, ctx) };
  }
  if (session.status !== 'open') {
    throw new AttemptBusy('Unknown session state');
  }
  if (sameIntent) {
    const prepared = readPrepared(row);
    await mark(row, ctx, session, 'open');
    return {
      row,
      result: {
        session,
        meta: prepared.meta,
        trialDays: prepared.params.subscription_data?.trial_period_days ?? 0,
      },
    };
  }
  if (!row.customer_id) {
    throw new AttemptBusy('Missing customer');
  }
  await expireOwnedSession(session, ctx.intent, row.customer_id, ctx.options);
  return { row: await retireRow(row, ctx) };
}

// Provider failures remain visible, without logging messages, request bodies or secrets.
function reportUncertain(error: unknown, row: CheckoutAttemptRow): void {
  const details =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const safe = (value: unknown) =>
    typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)
      ? value
      : undefined;
  const status =
    typeof details.statusCode === 'number' &&
    Number.isInteger(details.statusCode) &&
    details.statusCode >= 400 &&
    details.statusCode <= 599
      ? details.statusCode
      : undefined;
  reportIssueBackend({
    namespace: 'CHECKOUT_ATTEMPT_CREATE_UNCERTAIN',
    message: 'Checkout provider create outcome is uncertain',
    payload: {
      accountId: row.account_id,
      attemptId: row.attempt_id,
      type: safe(details.type),
      code: safe(details.code),
      status,
    },
    mode: 'error',
  });
}
async function createStored(
  row: CheckoutAttemptRow,
  ctx: Context
): Promise<Stripe.Checkout.Session> {
  const frozen = readPrepared(row);
  const fresh = await live(row, ctx);
  if (
    !fresh.expires_at ||
    fresh.db_now >= fresh.expires_at ||
    !fresh.attempt_id ||
    !fresh.customer_id
  ) {
    throw new AttemptBusy('Checkout deadline elapsed');
  }
  const options = {
    ...ctx.options(),
    idempotencyKey: `nf-checkout-${fresh.attempt_id}`,
  };
  let session: Stripe.Checkout.Session | null;
  try {
    session = await getStripe().checkout.sessions.create(
      frozen.params,
      options
    );
  } catch (error) {
    reportUncertain(error, fresh);
    session = await findAttemptSession(fresh, ctx.intent, ctx.options);
    if (!session) {
      throw new AttemptBusy('Unknown create outcome');
    }
  }
  if (
    !ownedSession(session, ctx.intent, fresh.customer_id) ||
    session.metadata?.attemptId !== fresh.attempt_id
  ) {
    throw new AttemptBusy('Unverified created session');
  }
  return session;
}

export async function retireExisting(
  row: CheckoutAttemptRow,
  ctx: Context
): Promise<CheckoutAttemptRow> {
  if (row.phase === 'empty' || row.phase === 'expired') {
    return row;
  }
  if (!row.attempt_id) {
    throw new AttemptBusy('Missing generation');
  }
  const session = await findAttemptSession(row, ctx.intent, ctx.options);
  if (session) {
    if (!row.customer_id) {
      throw new AttemptBusy('Missing customer');
    }
    if (session.status === 'complete') {
      try {
        await assertSessionSubscriptionTerminal(session, ctx.options);
      } catch (error) {
        if (error instanceof AttemptSubscribed) {
          await mark(row, ctx, session, 'completed');
        }
        throw error;
      }
    } else {
      await expireOwnedSession(
        session,
        ctx.intent,
        row.customer_id,
        ctx.options
      );
    }
  } else if (
    row.stripe_params !== null &&
    row.expires_at &&
    (await live(row, ctx)).db_now < row.expires_at
  ) {
    throw new AttemptBusy('Unknown create outcome');
  }
  return retireRow(row, ctx);
}

export async function runFlow(
  initial: CheckoutAttemptRow,
  ctx: Context,
  prepare: PrepareCheckout
): Promise<CheckoutAttemptResult> {
  let row = initial;
  const fingerprint = attemptFingerprint(ctx.intent);
  if (row.phase !== 'empty' && row.phase !== 'expired') {
    const session = await findAttemptSession(row, ctx.intent, ctx.options);
    if (session) {
      const handled = await handleSession(
        row,
        ctx,
        session,
        row.intent_fingerprint === fingerprint
      );
      if (handled.result) {
        return handled.result;
      }
      row = handled.row;
    } else if (row.phase === 'completed') {
      throw new AttemptSubscribed('Completed checkout');
    } else if (
      row.stripe_params !== null &&
      row.expires_at &&
      (await live(row, ctx)).db_now >= row.expires_at
    ) {
      row = await retireRow(row, ctx);
    } else if (
      row.intent_fingerprint !== fingerprint &&
      row.stripe_params !== null
    ) {
      if (!row.customer_id) {
        throw new AttemptBusy('Missing customer');
      }
      await reconcileLegacySessions(
        row.customer_id,
        ctx.intent,
        row.attempt_id ?? '',
        ctx.options
      );
      const found = await findAttemptSession(row, ctx.intent, ctx.options);
      const previous = found ?? (await createStored(row, ctx));
      await handleSession(row, ctx, previous, false);
      throw new AttemptBusy('Previous checkout retired; retry selection');
    } else if (row.intent_fingerprint !== fingerprint) {
      row = await retireRow(row, ctx);
    }
  }
  if (row.phase === 'empty' || row.phase === 'expired') {
    row = required(
      await store.start({
        accountId: ctx.intent.accountId,
        owner: ctx.owner,
        attemptId: randomUUID(),
        fingerprint,
        intentJson: JSON.stringify(ctx.intent),
      })
    );
  }
  if (row.stripe_params === null) {
    row = await freezeAttempt(row, ctx, prepare);
  }
  readPrepared(row);
  if (!row.customer_id) {
    throw new AttemptBusy('Missing customer');
  }
  const customer = row.customer_id;
  await assertNoScopedSubscription(customer, ctx.intent, ctx.options);
  await reconcileLegacySessions(
    row.customer_id,
    ctx.intent,
    row.attempt_id ?? '',
    ctx.options
  );
  const recovered = await findAttemptSession(row, ctx.intent, ctx.options);
  if (recovered) {
    const handled = await handleSession(row, ctx, recovered, true);
    if (handled.result) {
      return handled.result;
    }
    throw new AttemptBusy('Session expired during reconciliation');
  }
  const session = await createStored(row, ctx);
  const handled = await handleSession(row, ctx, session, true);
  if (!handled.result) {
    throw new AttemptBusy('Checkout session not open');
  }
  return handled.result;
}
