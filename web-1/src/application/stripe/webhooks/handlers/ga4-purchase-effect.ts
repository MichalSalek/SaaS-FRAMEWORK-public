import type Stripe from 'stripe';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import type { StripeWebhookEffect } from '@app/stripe/webhooks/stripe-effects.types';
import { sendGA4Purchase } from '@app/analytics/ga4-measurement';

/**
 * Efekt post-commit raportujący przychód do GA4, albo `null` gdy ta faktura
 * nie nadaje się do raportowania.
 *
 * Cztery bramki, każda z powodu:
 *
 * 1. **Snapshot metadanych subskrypcji.** `invoice.parent.subscription_details.metadata`
 *    to niezmienna migawka z chwili finalizacji faktury — jedyne miejsce, gdzie
 *    mamy plan i okres ROZLICZONY TĄ FAKTURĄ. `account.pricing_plan` to bieżący
 *    stan konta i przy spóźnionej fakturze po zmianie planu pokazałby zły produkt.
 * 2. **Stempel projektu.** Sprawdzenie samego klienta (wyżej) odsiewa klientów
 *    spoza zakresu aplikacji, ale nie niestemplowaną fakturę wystawioną ręcznie
 *    na naszego klienta. `projectId` domyka to pozytywnie.
 * 3. **Faktura w pełni opłacona i BEZ korekt z salda klienta.** Saldo kredytowe
 *    obniża kwotę do zapłaty, więc `amount_paid === amount_due` nadal przechodzi,
 *    ale wpłata przestaje odpowiadać wartości towaru: przy 100 zł netto + 23 zł
 *    VAT i 20 zł kredytu klient płaci 103 zł, a naiwne odjęcie dałoby 3 zł
 *    podatku zamiast 23. Dlatego odrzucamy faktury z niezerowym saldem
 *    początkowym, a podatek bierzemy z `total_taxes` Stripe'a, nie z odejmowania.
 * 4. **Zero złotych to nie zakup.** Faktura trialowa na 0 zł dorzuciłaby
 *    kupującego bez przychodu i zaniżyła średnią wartość zamówienia.
 *
 * VAT: ceny w tym produkcie są NETTO, a Stripe dokłada 23% (patrz
 * `account-stripe.operations.ts`). GA4 rozdziela przychód od podatku, więc
 * `value` idzie bez VAT-u, a podatek osobnym polem. Wysłanie `amount_paid`
 * zawyżałoby przychód o niemal jedną czwartą.
 */
export const buildGA4PurchaseEffect = (
  invoice: Stripe.Invoice
): StripeWebhookEffect | null => {
  const subscriptionDetails =
    invoice.parent?.type === 'subscription_details'
      ? invoice.parent.subscription_details
      : null;
  const metadata = subscriptionDetails?.metadata ?? null;

  if (!metadata || metadata.projectId !== STRIPE_PROJECT_ID) {
    return null;
  }

  const amountPaid = invoice.amount_paid;
  const netValue = invoice.total_excluding_tax;

  if (
    amountPaid <= 0 ||
    netValue === null ||
    amountPaid !== invoice.amount_due
  ) {
    return null;
  }

  const currency = invoice.currency.toUpperCase();
  const tax = Math.max(0, amountPaid - netValue);
  const transactionId = invoice.id;

  if (!transactionId) {
    return null;
  }

  const gaClientId = metadata.gaClientId;
  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer?.id ?? undefined);

  return async () => {
    await sendGA4Purchase({
      transactionId,
      // `/100` jest poprawne dla PLN; produkt nalicza wyłącznie w złotych.
      value: netValue / 100,
      tax: tax / 100,
      currency,
      planId: metadata.planId ?? 'UNKNOWN',
      billingPeriod: metadata.billingPeriod ?? 'unknown',
      billingReason: invoice.billing_reason ?? 'unknown',
      ...(gaClientId ? { clientId: gaClientId } : {}),
      ...(customerId ? { customerId } : {}),
    });
  };
};
