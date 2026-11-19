import type { PricingPlan } from '../pricing/pricing.config';
import type {
  BillingCurrency,
  CountryCode,
} from '../localization/country.config';

/**
 * Plan choice + payment contract. SSOT of the request/response shape for `account/checkout-session`
 * and `account/plan-change`, reused by `ACCOUNT_DTO_API_V1` (models/account) and the zod validators
 * (policies/validation/account.validation).
 *
 * DECISION: the response is a discriminated union on `mode`; the front does an exhaustive switch.
 *  - `free_selected`     FREE chosen, ZERO Stripe (no customer/session/card).
 *  - `checkout_elements` embedded Payment Element rendered INSIDE the app; `clientSecret` comes from
 *                        a Checkout Session with `ui_mode:'custom'` ('elements' does not exist in the
 *                        installed SDK; see account-embedded-checkout.operations.ts).
 *  - `hosted_fallback`   controlled redirect to hosted Stripe Checkout (behind a flag, when embedded
 *                        is off or down).
 */

export type BillingPeriod = 'month' | 'year';

export type CheckoutSessionRequest = {
  /** Terms shown before a new checkout; never a client-selected trial duration. */
  expectedTrialDays?: number;
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  /** Fixed currency of this checkout; the actual address is collected separately. */
  currency?: BillingCurrency;
  /** Optional market/address hint, never proof of the payer's actual country. */
  billingCountry?: CountryCode;
  source?: string;
  /**
   * Human-readable promotion code from a lifecycle email (`?promo=`).
   * Invalid or expired codes do not fail checkout; the response sets
   * `promoRejected` and the session is minted at full price.
   */
  promo?: string;
};

export type CheckoutSessionResponse =
  | { mode: 'free_selected' }
  | {
      mode: 'checkout_elements';
      trialDays?: number;
      clientSecret: string;
      checkoutSessionId: string;
      returnUrl: string;
      billingAddressRequired?: boolean;
      /** Present only when the request carried a promo the server refused. */
      promoRejected?: boolean;
    }
  | {
      mode: 'hosted_fallback';
      trialDays?: number;
      url: string;
      checkoutSessionId: string;
      billingAddressRequired?: boolean;
      promoRejected?: boolean;
    };

export type PlanChangeRequest = {
  targetPlanId: PricingPlan;
  billingPeriod: BillingPeriod;
  /** New clients confirm a server-owned preview; older clients keep their existing flow. */
  quoteId?: string;
};

export type PlanChangePreviewResponse = {
  quoteId: string;
  expiresAt: string;
  amountDue: number;
  total: number;
  taxAmount: number | null;
  currency: string;
  billingPeriod: BillingPeriod;
  trialEndsAt: string | null;
  cancelAt: string | null;
  /** Fixed gross catalog amount for the selected period and quantity, before discounts/balance. */
  regularAmount?: number | null;
  /** Known next billing boundary from the target preview; null when cancelled or unavailable. */
  nextBillingAt?: string | null;
};

export type PlanChangeResponse =
  | { status: 'completed' }
  | { status: 'requires_action'; clientSecret: string }
  | { status: 'payment_failed'; reason?: string };

/**
 * Faktura VAT — dane firmowe kupującego (opcjonalny subform w checkoutcie).
 *
 * DECISION: see ../stripe/stripe.config.ts (VAT included in subscription prices). This request is OPTIONAL:
 * sent only when the buyer enables "Faktura na firmę" and wants an invoice with their own NIP and
 * address. A B2C buyer still gets a VAT invoice (without NIP), so no request does not mean no VAT.
 * DECISION: (owner) the buyer's country is independent of the seller's
 * country and the UI language. Typed business IDs are validated by Stripe.
 */
export type VatInvoiceDetailsRequest = {
  companyName: string;
  /** Legacy Polish NIP. New clients send a typed business tax ID instead. */
  nip?: string;
  country?: CountryCode;
  taxId?: { type: string; value: string } | null;
  addressLine1: string;
  addressLine2?: string;
  addressCity: string;
  addressPostalCode: string;
  addressState?: string;
};

export type VatInvoiceDetailsResponse = { ok: true };
