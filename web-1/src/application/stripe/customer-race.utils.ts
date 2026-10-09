import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from './adapters/stripe.adapter';

/**
 * Concurrent-race fallback for `getOrCreateStripeCustomer`: another parallel
 * get-or-create for the SAME account already linked a customer, so we adopt its
 * id and — when we minted a throwaway customer in the meantime — delete that
 * orphan (best-effort, non-blocking). Returns the winner's id, or null when the
 * account row has no customer set (account gone → caller surfaces it).
 *
 * DECISION (nie usuwaj tego komentarza): shared by all three race branches in
 * getOrCreateStripeCustomer (by-email-reuse P2002, create CAS-miss, create P2002)
 * so orphan cleanup + winner-adoption live in ONE place (was copy-pasted 3×).
 * Extracted to a sibling to keep customer.operations under the max-lines ceiling.
 */
export const adoptConcurrentWinnerCustomer = async ({
  accountId,
  orphanToDelete,
}: {
  accountId: string;
  orphanToDelete: string | null;
}): Promise<string | null> => {
  const refreshed = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { account_id: accountId },
    select: { stripe_customer_id: true },
  });
  if (!refreshed?.stripe_customer_id) {
    return null;
  }
  if (orphanToDelete && orphanToDelete !== refreshed.stripe_customer_id) {
    try {
      await getStripe().customers.del(orphanToDelete);
      reportIssueBackend({
        namespace: 'STRIPE_CUSTOMER_CLEANUP',
        message: 'Deleted orphaned Stripe customer after concurrent-mint race',
        payload: {
          deletedCustomerId: orphanToDelete,
          activeCustomerId: refreshed.stripe_customer_id,
        },
        mode: 'info',
      });
    } catch (delError) {
      reportIssueBackend({
        namespace: 'STRIPE_CUSTOMER_CLEANUP_ERROR',
        message: 'Failed to delete orphaned customer (non-critical)',
        payload: { customerId: orphanToDelete, error: delError },
        mode: 'error',
      });
    }
  }
  return refreshed.stripe_customer_id;
};
