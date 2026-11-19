import { ENV_VARS } from '@app/environment/environment.config';

const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const REQUEST_TIMEOUT_MS = 5_000;

export interface GA4PurchaseParams {
  /** Stripe invoice id, stable across retries, so it serves as `transaction_id`. */
  transactionId: string;
  /** Item value WITHOUT tax, in major units (zloty, not grosze). */
  value: number;
  /** Tax amount, separate: GA4 splits revenue from tax. */
  tax: number;
  /** ISO 4217, upper case. */
  currency: string;
  /** Plan from the subscription metadata snapshot on the invoice. */
  planId: string;
  /** 'month' | 'year': the same amount means something else for each. */
  billingPeriod: string;
  /**
   * Stripe billing reason (`subscription_create`, `subscription_cycle`,
   * `subscription_update`...). Without it a new customer and a renewal are
   * both just `purchase` in the report.
   */
  billingReason: string;
  /**
   * Browser GA4 `client_id`, carried through the subscription metadata.
   * Without it Measurement Protocol invents a ghost user and the purchase
   * attaches to nobody who browsed the site earlier.
   */
  clientId?: string | undefined;
  /**
   * Stripe customer id, the identity fallback when `clientId` is missing.
   * STABLE across renewals, unlike the invoice id, which changes monthly and
   * would turn one subscriber into a new user on every instalment.
   */
  customerId?: string | undefined;
}

/**
 * Send `purchase` to GA4. Never throws: the caller is a post-commit effect and
 * a rejected promise in `runAfterResponse` reaches the global unhandled
 * rejection handler.
 */
export async function sendGA4Purchase(
  params: GA4PurchaseParams
): Promise<void> {
  try {
    const measurementId = ENV_VARS.GA4_MEASUREMENT_ID;
    const apiSecret = ENV_VARS.GA4_API_SECRET;
    if (!measurementId || !apiSecret) {
      return;
    }

    // Fallback order matters. Without a browser identity use the Stripe
    // CUSTOMER id: it is stable for the whole subscription, so twelve
    // instalments are one user. The invoice id changes monthly (last resort).
    const clientId =
      params.clientId ?? params.customerId ?? params.transactionId;

    const body = {
      client_id: clientId,
      events: [
        {
          name: 'purchase',
          params: {
            transaction_id: params.transactionId,
            currency: params.currency,
            value: params.value,
            tax: params.tax,
            plan_id: params.planId,
            billing_period: params.billingPeriod,
            billing_reason: params.billingReason,
            items: [
              {
                item_id: params.planId,
                item_name: `Nailfolio ${params.planId} (${params.billingPeriod})`,
                item_category: 'subscription',
                price: params.value,
                quantity: 1,
              },
            ],
          },
        },
      ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      await fetch(
        `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Analytics must never touch payment fulfilment: a lost event costs a
    // report row, a thrown exception would cost the webhook acknowledgement.
  }
}
