import type { Prisma } from '../../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { normalizeEmail } from '@app/email-handler/email.utils';

/**
 * Projection shared by every "resolve the user behind a Stripe event" lookup below.
 * The three resolvers (by email, by customer id, by client_reference_id) feed the SAME
 * checkout-handler code path, so their shapes must stay identical — kept as one const
 * because a field added to only two of the three shows up as `undefined` at whichever
 * call site happened not to be updated.
 */
const USER_WITH_ACCOUNT_SELECT = {
  id: true,
  email: true,
  stylist_account: {
    select: {
      account_id: true,
      pricing_plan: true,
      stripe_customer_id: true,
      subscription_id: true,
      created_by_user_id: true,
    },
  },
} as const;

/**
 * Find account by Stripe customer ID.
 *
 * `tx` — when called from inside the webhook `$transaction` (D1), the read MUST
 * go through the transaction client so the snapshot is consistent with the
 * writes committed in the same tx (no read-skew vs a concurrent webhook).
 */
export const findAccountByCustomerId = async (
  customerId: string,
  tx?: Prisma.TransactionClient
) => {
  // stripe_customer_id has a @unique constraint — use findUnique for clearer
  // intent and slightly better query plan.
  const account = await (tx ?? DB_CLIENT.use).stylistAccount.findUnique({
    where: { stripe_customer_id: customerId },
    select: {
      account_id: true,
      created_by_user_id: true,
      created_at: true,
      pricing_plan: true,
      account_status: true,
      subscription_id: true,
      payment_status: true,
      subscription_status: true,
      cancel_at_period_end: true,
      cancel_at: true,
      current_period_end: true,
    },
  });

  if (!account) {
    reportIssueBackend({
      namespace: 'STRIPE_ACCOUNT_LOOKUP',
      message: 'Account not found for customer',
      payload: { customerId },
      mode: 'error',
    });
  }

  return account;
};

/**
 * Find user by email (normalized, case-insensitive).
 *
 * `tx` — when called from inside the webhook `$transaction`, the read MUST go
 * through the transaction client so the `subscription_id` snapshot used for
 * duplicate-subscription detection reflects a concurrent checkout serialized by
 * the per-account advisory lock (parity with `findAccountByCustomerId`).
 */
export const findUserByEmail = async (
  email: string,
  tx?: Prisma.TransactionClient
) => {
  const normalized = normalizeEmail(email);
  return (tx ?? DB_CLIENT.use).user.findUnique({
    where: { email: normalized },
    select: USER_WITH_ACCOUNT_SELECT,
  });
};

/**
 * Find user (with resolved stylist account) by the account's Stripe customer ID.
 *
 * Mirrors `findUserByEmail`'s select shape but filters on the account's
 * `stripe_customer_id` (@unique) via the 1:1 user↔stylist_account relation.
 * Used as a resolution fallback in the checkout webhook: `session.customer` maps
 * 1:1 to the account, so a session missing both `client_reference_id` and
 * `customer_email` is still resolvable without a false CRITICAL alert.
 *
 * `tx` — threaded so the read stays consistent with the per-account advisory-lock
 * serialization (parity with `findUserByEmail`).
 */
export const findUserByStripeCustomerId = async (
  customerId: string,
  tx?: Prisma.TransactionClient
) => {
  return (tx ?? DB_CLIENT.use).user.findFirst({
    where: { stylist_account: { stripe_customer_id: customerId } },
    select: USER_WITH_ACCOUNT_SELECT,
  });
};

/**
 * Find user by client reference ID or email fallback.
 *
 * `tx` — see `findUserByEmail`: the webhook passes its tx client so the read is
 * consistent with the per-account advisory-lock serialization (a concurrent
 * checkout's committed `subscription_id` is visible before duplicate detection).
 */
export const findUserByReferenceOrEmail = async ({
  clientReferenceId,
  customerEmail,
  tx,
}: {
  clientReferenceId: string | null;
  customerEmail: string | null;
  tx?: Prisma.TransactionClient;
}) => {
  if (clientReferenceId) {
    const userId = clientReferenceId;
    if (userId.length > 0) {
      const user = await (tx ?? DB_CLIENT.use).user.findUnique({
        where: { id: userId },
        select: USER_WITH_ACCOUNT_SELECT,
      });

      if (user) {
        return user;
      }
    }
  }

  if (customerEmail) {
    return findUserByEmail(customerEmail, tx);
  }

  return null;
};
