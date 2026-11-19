import { DB_CLIENT } from '@app/db/db.client';
import { isP2002 } from '@app/db/prisma-error';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from './adapters/stripe.adapter';
import { adoptConcurrentWinnerCustomer } from './customer-race.utils';
import { normalizeEmail } from '@app/email-handler/email.utils';
import { retryStripeOperation } from './stripe-retry.utils';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { dispatchCriticalAlert } from './webhooks/stripe-webhooks.utils';
import {
  enqueueSubscriptionCancelReconcile,
  resolveSubscriptionCancelReconcile,
} from './cancel-reconcile/stripe-cancel-reconcile.queue';
import {
  isAlreadyCanceledAttempt,
  type CancelReconcileFlavor,
} from './cancel-reconcile/stripe-cancel-reconcile.resolver';
import { STRIPE_PROJECT_ID } from './stripe.types';

export const getOrCreateStripeCustomer = async ({
  userEmail,
  accountId,
}: {
  userEmail: string;
  accountId: string;
}): Promise<string> => {
  const stripe = getStripe();

  // Normalize email using SSOT function
  const normalizedEmail = normalizeEmail(userEmail);

  // 1. Check if we already have a stripeCustomerId for this account
  const account = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { account_id: accountId },
    select: { stripe_customer_id: true },
  });

  if (account?.stripe_customer_id) {
    return account.stripe_customer_id;
  }

  // 2. Search Stripe by normalized email (retry on transient failures).
  // DECISION: we do not assume every customer on the Stripe account belongs to this application, so
  // email is NOT a safe reuse key. Reuse ONLY a customer marked as ours (metadata.projectId ===
  // STRIPE_PROJECT_ID), parity with price scoping (isScopedToNailfolio) and sessions. limit:100
  // (not 1) finds OUR customer among the results for this email.
  const listResult = await retryStripeOperation({
    fn: () => stripe.customers.list({ email: normalizedEmail, limit: 100 }),
    namespace: 'STRIPE_CUSTOMER_LIST',
    payload: { accountId, email: normalizedEmail },
  });

  if (!listResult.ok) {
    const lastAttempt = listResult.attempts[listResult.attempts.length - 1];
    throw new Error(
      lastAttempt?.errorMessage ??
        `Stripe customers.list failed after ${listResult.attempts.length} attempts`
    );
  }

  const ownCustomer = listResult.value.data.find(
    candidate => candidate.metadata?.projectId === STRIPE_PROJECT_ID
  );

  if (ownCustomer) {
    const stripeCustomerId = ownCustomer.id;

    // Sync it to our DB with P2002 handling
    try {
      await DB_CLIENT.use.stylistAccount.update({
        where: { account_id: accountId },
        data: { stripe_customer_id: stripeCustomerId },
      });
    } catch (error) {
      // DECISION: P2002 is detected STRUCTURALLY (isP2002), never with
      // `instanceof Prisma.PrismaClientKnownRequestError`: instanceof is FALSE under Turbopack
      // (duplicated class identity), which would skip this race fallback (another process already
      // set stripe_customer_id) and throw a 500. See @app/db/prisma-error.ts.
      if (isP2002(error)) {
        reportIssueBackend({
          namespace: 'STRIPE_CUSTOMER_RACE_CONDITION',
          message:
            'Duplicate stripeCustomerId detected (race condition), using existing',
          payload: { accountId, attemptedCustomerId: stripeCustomerId },
          mode: 'warn',
        });
        // by-email reuse links an EXISTING Stripe customer → no orphan to delete.
        const winner = await adoptConcurrentWinnerCustomer({
          accountId,
          orphanToDelete: null,
        });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }

    return stripeCustomerId;
  }

  // 3. Create new customer in Stripe with normalized email (retry on transient failures)
  const createResult = await retryStripeOperation({
    fn: () =>
      stripe.customers.create({
        email: normalizedEmail,
        // projectId stamp = SSOT scope marker on the Stripe account; it lets
        // the by-email reuse above pick OUR customer and never an unscoped one.
        metadata: {
          accountId: accountId.toString(),
          projectId: STRIPE_PROJECT_ID,
        },
      }),
    namespace: 'STRIPE_CUSTOMER_CREATE',
    payload: { accountId, email: normalizedEmail },
  });

  if (!createResult.ok) {
    const lastAttempt = createResult.attempts[createResult.attempts.length - 1];
    throw new Error(
      lastAttempt?.errorMessage ??
        `Stripe customers.create failed after ${createResult.attempts.length} attempts`
    );
  }

  const customer = createResult.value;

  // 4. Link the new customer to our DB with a compare-and-set on the NULL slot.
  // DECISION: compare-and-set (`updateMany WHERE stripe_customer_id IS NULL`) instead of an
  // unconditional `update WHERE account_id` closes the concurrent-mint race: two parallel
  // get-or-create calls for the SAME account both read null and create customers A and B, and a
  // plain update would SILENTLY overwrite the first (same row, no P2002), orphaning A (live in
  // Stripe, unknown to the DB, so a subscription landing on it becomes an untracked ghost). With
  // the CAS only the first writer wins (count===1); the loser (count===0) adopts the winner's id
  // and deletes its own orphan, like the P2002 branch. P2002 stays as a belt for a cross-row id
  // collision.
  try {
    const { count } = await DB_CLIENT.use.stylistAccount.updateMany({
      where: { account_id: accountId, stripe_customer_id: null },
      data: { stripe_customer_id: customer.id },
    });

    if (count === 0) {
      // Lost the race — another concurrent get-or-create already linked a
      // customer to this account; our freshly-created one is an orphan to clean.
      reportIssueBackend({
        namespace: 'STRIPE_CUSTOMER_RACE_CONDITION',
        message:
          'Concurrent mint won the account slot — adopting existing customer and cleaning up orphan',
        payload: { accountId, orphanCustomerId: customer.id },
        mode: 'warn',
      });
      const winner = await adoptConcurrentWinnerCustomer({
        accountId,
        orphanToDelete: customer.id,
      });
      if (winner) {
        return winner;
      }
      // count===0 with no id set means the account row is gone — surface it.
      throw new Error(
        `Failed to link Stripe customer: account ${accountId} not found`
      );
    }

    reportIssueBackend({
      namespace: 'STRIPE_CUSTOMER',
      message: 'New Stripe customer created',
      payload: { accountId, customerId: customer.id, email: normalizedEmail },
      mode: 'info',
    });

    return customer.id;
  } catch (error) {
    // DECISION: P2002 is detected STRUCTURALLY (isP2002), never with `instanceof`: it is FALSE
    // under Turbopack (duplicated class identity), which would skip this fallback
    // (another process created the customer) and throw a 500. See @app/db/prisma-error.ts.
    const isUniqueConstraintViolation = isP2002(error);

    if (isUniqueConstraintViolation) {
      reportIssueBackend({
        namespace: 'STRIPE_CUSTOMER_RACE_CONDITION',
        message:
          'Duplicate stripeCustomerId detected, using existing and cleaning up orphaned customer',
        payload: { accountId, newCustomerId: customer.id },
        mode: 'warn',
      });
      const winner = await adoptConcurrentWinnerCustomer({
        accountId,
        orphanToDelete: customer.id,
      });
      if (winner) {
        return winner;
      }
    }
    throw error;
  }
};

// DECISION: see web-1/src/application/stripe/cancel-reconcile/stripe-cancel-reconcile.resolver.ts
// (Stripe "already canceled" counts as success). One classifier for every cancel path:
// isAlreadyCanceledAttempt.

export async function cancelStripeSubscriptionIfExists(
  userId: string,
  {
    reconcileFlavor = 'deletion',
  }: { reconcileFlavor?: CancelReconcileFlavor } = {}
): Promise<void> {
  try {
    const account = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { created_by_user_id: userId },
      select: {
        subscription_id: true,
        account_id: true,
        stripe_customer_id: true,
      },
    });

    if (!account?.subscription_id) {
      return;
    }

    const stripe = getStripe();
    const subscriptionId = account.subscription_id;
    const cancelResult = await retryStripeOperation({
      fn: () => stripe.subscriptions.cancel(subscriptionId),
      namespace: 'STRIPE_SUBSCRIPTION_CANCEL_ON_USER_DELETE',
      payload: {
        userId,
        accountId: account.account_id,
        subscriptionId,
      },
    });

    if (cancelResult.ok) {
      // DECISION: `message` is CONSTANT, identifiers live only in `payload`. The log throttle key
      // is `namespace::message` (log-rate-limiter.ts), so interpolating userId/subscriptionId
      // gave a unique key per call and the bucket never filled, leaving the throttle dead exactly
      // where it is needed (a bulk downgrade pushes up to 100 accounts through here from one admin
      // click). No information is lost. This is an 'info' path, so on production it is written only
      // with VERBOSE_LOG_MODE.
      reportIssueBackend({
        namespace: 'cancelStripeSubscriptionIfExists',
        message: 'Stripe subscription cancelled on user delete',
        payload: {
          userId,
          accountId: account.account_id,
          subscriptionId,
          attemptsCount: cancelResult.attempts.length,
        },
        mode: 'info',
      });
      await resolveSubscriptionCancelReconcile({
        subscriptionId,
        userId,
        flavor: reconcileFlavor,
      });
      return;
    }

    const lastAttempt = cancelResult.attempts[cancelResult.attempts.length - 1];
    if (isAlreadyCanceledAttempt(lastAttempt)) {
      reportIssueBackend({
        namespace: 'cancelStripeSubscriptionIfExists',
        message:
          'Stripe subscription already canceled — treating user-delete cancel as idempotently complete',
        payload: {
          userId,
          accountId: account.account_id,
          subscriptionId,
          lastErrorCode: lastAttempt?.errorCode,
          lastErrorStatus: lastAttempt?.errorStatus,
          attempts: cancelResult.attempts,
        },
        mode: 'info',
      });
      await resolveSubscriptionCancelReconcile({
        subscriptionId,
        userId,
        flavor: reconcileFlavor,
      });
      return;
    }

    // All retries exhausted (or permanent error). User deletion
    // will proceed but the subscription is still active in Stripe. Two nets:
    // (1) dead-letter reconcile entry below — the background sweep keeps retrying
    //     the cancel with backoff (stripe-cancel-reconcile.operations.ts, writers in stripe-cancel-reconcile.queue.ts);
    // (2) immediate operator alert — manual Stripe Dashboard cancel remains the
    //     terminal fallback if the sweep also exhausts its budget.
    await enqueueSubscriptionCancelReconcile({
      subscriptionId,
      userId,
      flavor: reconcileFlavor,
      reason:
        lastAttempt?.errorMessage ??
        'Stripe cancel failed after retries (no error message captured)',
    });

    reportIssueBackend({
      namespace: APP_EVENTS.INFO.ACCOUNT.STRIPE_SUBSCRIPTION_CANCEL_FAILED,
      message: `Failed to cancel Stripe subscription for user ${userId} after retries — manual cancel required`,
      payload: {
        userId,
        accountId: account.account_id,
        subscriptionId,
        stripeCustomerId: account.stripe_customer_id,
        attemptsCount: cancelResult.attempts.length,
        lastErrorCode: lastAttempt?.errorCode,
        lastErrorStatus: lastAttempt?.errorStatus,
        lastErrorMessage: lastAttempt?.errorMessage,
        attempts: cancelResult.attempts,
      },
      mode: 'error',
    });

    dispatchCriticalAlert({
      context: 'STRIPE_SUBSCRIPTION_CANCEL_ON_USER_DELETE',
      diagnostic: {
        userId,
        accountId: account.account_id,
        subscriptionId,
      },
      alert: {
        alertTitle:
          'Stripe Subscription Cancel Failed on User Delete — Manual Cancel Required',
        alertMessage:
          'A user account was deleted but the linked Stripe subscription could not be cancelled programmatically after retries. ' +
          'The subscription is still active and will continue billing. Please cancel it manually in the Stripe Dashboard immediately ' +
          'to prevent ghost double-billing.',
        details: {
          userId,
          accountId: account.account_id,
          subscriptionId,
          stripeCustomerId: account.stripe_customer_id,
          attemptsCount: cancelResult.attempts.length,
          lastErrorCode: lastAttempt?.errorCode,
          lastErrorStatus: lastAttempt?.errorStatus,
          lastErrorMessage: lastAttempt?.errorMessage,
          attempts: cancelResult.attempts,
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    // Defensive guard — retryStripeOperation already converts Stripe errors to
    // a discriminated result, so this only fires on truly unexpected runtime
    // failures (e.g. adapter init throws, DB lookup fails). Must not propagate
    // because callers rely on void return for best-effort cancel semantics.
    reportIssueBackend({
      namespace: APP_EVENTS.INFO.ACCOUNT.STRIPE_SUBSCRIPTION_CANCEL_FAILED,
      message: `Unexpected error during cancelStripeSubscriptionIfExists for user ${userId} — proceeding with deletion`,
      payload: {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      mode: 'error',
    });

    dispatchCriticalAlert({
      context: 'STRIPE_SUBSCRIPTION_CANCEL_ON_USER_DELETE_UNEXPECTED',
      diagnostic: { userId },
      alert: {
        alertTitle:
          'Stripe Subscription Cancel Threw Unexpected Error on User Delete',
        alertMessage:
          'cancelStripeSubscriptionIfExists hit an unexpected runtime error (not a Stripe API error). ' +
          'User deletion proceeded but any linked Stripe subscription may still be active. ' +
          'Please inspect the audit log and cancel any active subscription manually in Stripe Dashboard.',
        details: {
          userId,
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        },
      },
    });
  }
}

export const updateStripeCustomerEmail = async ({
  stripeCustomerId,
  newEmail,
}: {
  stripeCustomerId: string;
  newEmail: string;
}): Promise<void> => {
  const stripe = getStripe();
  const normalizedEmail = normalizeEmail(newEmail);

  const result = await retryStripeOperation({
    fn: () =>
      stripe.customers.update(stripeCustomerId, { email: normalizedEmail }),
    namespace: 'STRIPE_CUSTOMER_UPDATE',
    payload: { stripeCustomerId, newEmail: normalizedEmail },
  });

  if (!result.ok) {
    const lastAttempt = result.attempts[result.attempts.length - 1];
    const nonRetryable = lastAttempt?.retryable === false;
    reportIssueBackend({
      namespace: 'STRIPE_CUSTOMER_UPDATE_ERROR',
      message: nonRetryable
        ? 'Stripe customer email update failed with non-retryable error'
        : `Failed to update Stripe customer email after ${result.attempts.length} attempts`,
      payload: {
        stripeCustomerId,
        newEmail: normalizedEmail,
        attempts: result.attempts,
      },
      mode: 'error',
    });
    throw new Error(
      lastAttempt?.errorMessage ??
        `Stripe customer.update failed after ${result.attempts.length} attempts`
    );
  }

  reportIssueBackend({
    namespace: 'STRIPE_CUSTOMER_UPDATE',
    message: 'Stripe customer email updated',
    payload: { stripeCustomerId, newEmail: normalizedEmail },
    mode: 'info',
  });
};
