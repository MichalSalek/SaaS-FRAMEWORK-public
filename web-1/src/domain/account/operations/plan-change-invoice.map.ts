import type Stripe from 'stripe';
import type { PlanChangeResponse } from '@kernel/domain/user-and-account/account-checkout.types';

/**
 * Mapuje stan latest_invoice (po subscriptions.update / retrieve) na PlanChangeResponse.
 *
 * DECISION: classify by amount_remaining/amount_due plus confirmation_secret, not only by
 * `status !== 'paid'`. No invoice or amount <= 0 (downgrade, credit) = `completed`; unpaid with a
 * secret = SCA `requires_action`; unpaid without one (hard decline) = `payment_failed`, never a
 * false green `completed`.
 */
export const mapLatestInvoiceToPlanChange = (
  latestInvoice: Stripe.Subscription['latest_invoice']
): PlanChangeResponse => {
  // Brak faktury = zmiana bez platnosci (downgrade/credit/$0) -> completed.
  if (latestInvoice == null) {
    return { status: 'completed' };
  }
  // String = niezexpandowana faktura. Nie powinno wystapic (retrieve/update ZAWSZE
  // expanduja latest_invoice.confirmation_secret), ale defensywnie NIE zwracamy
  // 'completed' dla nieznanego stanu (falszywy zielony sukces) — payment_failed,
  // by front pokazal blad zamiast udawac sukces na nierozpoznanej fakturze.
  if (typeof latestInvoice === 'string') {
    return { status: 'payment_failed', reason: 'invoice_unexpanded' };
  }
  const amountRemaining =
    latestInvoice.amount_remaining ?? latestInvoice.amount_due ?? 0;
  if (latestInvoice.status === 'paid' || amountRemaining <= 0) {
    return { status: 'completed' };
  }
  const clientSecret = latestInvoice.confirmation_secret?.client_secret;
  if (clientSecret != null) {
    return { status: 'requires_action', clientSecret };
  }
  const status = latestInvoice.status;
  return status != null
    ? { status: 'payment_failed', reason: status }
    : { status: 'payment_failed' };
};
