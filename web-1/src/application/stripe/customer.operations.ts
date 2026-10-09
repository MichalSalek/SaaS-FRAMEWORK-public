import { DB_CLIENT } from '@app/db/db.client';
import { isP2002 } from '@app/db/prisma-error';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from './adapters/stripe.adapter';
import { adoptConcurrentWinnerCustomer } from './customer-race.utils';
import { normalizeEmail } from '@app/email-handler/email.utils';
import {
  retryStripeOperation,
  type StripeRetryAttempt,
} from './stripe-retry.utils';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { dispatchCriticalAlert } from './webhooks/stripe-webhooks.utils';
import { enqueueSubscriptionCancelReconcile } from './cancel-reconcile/stripe-cancel-reconcile.operations';
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
  // DECISION (nie usuwaj tego komentarza): nie zakładamy, że customer na koncie
  // Stripe należy do tej aplikacji. Email NIE jest bezpiecznym kluczem reuse. Reużywamy
  // WYŁĄCZNIE customera oznaczonego jako nasz (metadata.projectId === STRIPE_PROJECT_ID),
  // tak samo jak przy cenach (isScopedToNailfolio) i sesjach.
  // limit:100 (nie 1), by znaleźć naszego customera wśród wyników dla tego emaila.
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
      // DECISION (nie usuwaj tego komentarza): P2002 wykrywany STRUKTURALNIE (isP2002), NIE
      // `instanceof Prisma.PrismaClientKnownRequestError` — instanceof zwraca FALSE pod
      // Turbopack (zdublowane tożsamości klasy) → ten race-condition fallback (inny proces
      // ustawił stripe_customer_id) byłby przeskoczony i rzucony jako 500. Graceful handling
      // - another process may have set it already. Rationale: @app/db/prisma-error.ts.
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
  // DECISION (nie usuwaj tego komentarza):
  // CAS (`updateMany WHERE stripe_customer_id IS NULL`) instead of an unconditional
  // `update WHERE account_id` closes the concurrent-mint race: two parallel
  // get-or-create for the SAME account both read stripe_customer_id=null, both
  // create a customer (customer_A, customer_B) and, with a plain update, the
  // second SILENTLY overwrites the first (same row, different value → NO P2002),
  // orphaning customer_A (live in Stripe, unknown to DB → syncAccountWithStripe
  // never sees it, so a subscription that lands on it becomes an untracked ghost).
  // The CAS makes only the FIRST writer win (count===1); the loser (count===0)
  // adopts the winner's id and deletes its own orphan — same cleanup the P2002
  // branch already does. P2002 can still fire if the fresh id collides cross-row
  // (practically impossible for a just-created customer) → kept as a belt.
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
    // DECISION (nie usuwaj tego komentarza): P2002 wykrywany STRUKTURALNIE (isP2002), NIE
    // `instanceof Prisma.PrismaClientKnownRequestError` — instanceof zwraca FALSE pod
    // Turbopack (zdublowane tożsamości klasy) → ten idempotentny fallback (inny proces
    // utworzył customera) byłby przeskoczony i rzucony jako 500. Rationale: @app/db/prisma-error.ts.
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

/**
 * Treat Stripe "already canceled" responses as idempotent success.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Stripe surfaces "already cancelled" in two shapes:
 *   - 404 `resource_missing` — subscription doesn't exist (already deleted or
 *     never propagated to the live key).
 *   - 400 with message containing "canceled"/"cancelled" — subscription exists
 *     but is in terminal canceled state and refuses further mutations.
 * Both indicate the desired end-state (no further billing) is already met, so
 * we record an idempotent-success audit row and skip the operator alert.
 * Mirrors the helper used in `checkout-auto-cancel.utils.ts`.
 */
const isAlreadyCanceledOutcome = (
  attempt: StripeRetryAttempt | undefined
): boolean => {
  if (!attempt) {
    return false;
  }
  if (attempt.errorCode === 'resource_missing') {
    return true;
  }
  const msg = attempt.errorMessage?.toLowerCase() ?? '';
  if (typeof attempt.errorStatus === 'number' && attempt.errorStatus !== 400) {
    return false;
  }
  return (
    msg.includes('has been canceled') ||
    msg.includes('has been cancelled') ||
    msg.includes('already canceled') ||
    msg.includes('already cancelled')
  );
};

/**
 * Cancel an account's active Stripe subscription before user deletion.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Best-effort by contract — callers (deleteSelfUser_IO, confirmDeleteSelf_IO,
 * adminDeleteUserAny_IO) do NOT block deletion on cancel failure
 * to avoid trapping the user in an undeletable state if Stripe is degraded.
 * To compensate we:
 *   1. Retry transient failures via `retryStripeOperation` (3 attempts, 7s max
 *      backoff) so single-flap Stripe outages do not silently leak active subs.
 *   2. Treat 404 `resource_missing` / "already canceled" responses as success
 *      (the desired end-state — no double billing — is already met).
 *   3. On final non-idempotent failure enqueue a dead-letter reconcile entry
 *      (enqueueSubscriptionCancelReconcile) — a background sweep keeps retrying
 *      the cancel with exponential backoff (bounded; alerts again on exhaustion).
 *   4. ALSO dispatch `dispatchCriticalAlert` immediately with operator-actionable
 *      details (userId, subscriptionId, attempts trace) — manual Stripe Dashboard
 *      cancel is the terminal fallback against ghost double-billing.
 * Must not throw — orchestrators rely on void return.
 */
export async function cancelStripeSubscriptionIfExists(
  userId: string
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
      // DECISION (nie usuwaj tego komentarza): `message` jest STAŁE, identyfikatory
      // siedzą wyłącznie w `payload`. Klucz dławika logów to `namespace::message`
      // (log-rate-limiter.ts), więc wstrzyknięcie userId/subscriptionId do komunikatu
      // dawało unikalny klucz na każde wywołanie i kubełek nigdy się nie zapełniał —
      // dławik był martwy dokładnie tam, gdzie jest potrzebny (zbiorowy downgrade
      // przepuszcza tędy do 100 kont z jednego kliknięcia admina). Zero utraty
      // informacji: oba identyfikatory były i są w payloadzie. Ta ścieżka to tryb
      // 'info', więc na produkcji i tak zapisuje się tylko przy włączonym
      // VERBOSE_LOG_MODE — po tej zmianie także wtedy się skleja.
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
      return;
    }

    const lastAttempt = cancelResult.attempts[cancelResult.attempts.length - 1];
    if (isAlreadyCanceledOutcome(lastAttempt)) {
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
      return;
    }

    // All retries exhausted (or permanent non-idempotent error). User deletion
    // will proceed but the subscription is still active in Stripe. Two nets:
    // (1) dead-letter reconcile entry below — the background sweep keeps retrying
    //     the cancel with backoff (stripe-cancel-reconcile.operations.ts);
    // (2) immediate operator alert — manual Stripe Dashboard cancel remains the
    //     terminal fallback if the sweep also exhausts its budget.
    await enqueueSubscriptionCancelReconcile({
      subscriptionId,
      userId,
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
