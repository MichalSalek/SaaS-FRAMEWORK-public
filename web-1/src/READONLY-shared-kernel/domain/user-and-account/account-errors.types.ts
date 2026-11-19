export type AccountVanityUrlTakenError = {
  type: 'ACCOUNT_VANITY_URL_TAKEN';
  vanityUrl: string;
};

export type AccountVanityUrlReservedError = {
  type: 'ACCOUNT_VANITY_URL_RESERVED';
  vanityUrl: string;
};

export type AccountTrialAlreadyUsedError = {
  type: 'ACCOUNT_TRIAL_ALREADY_USED';
  accountId: string;
};

export type AccountTrialNotEligibleError = {
  type: 'ACCOUNT_TRIAL_NOT_ELIGIBLE';
  accountId: string;
  reason: string;
};

export type AccountStripeError = {
  type: 'ACCOUNT_STRIPE_ERROR';
  operation: string;
  stripeError: string;
};

// ── SPE (Stripe Plan Choice + Embedded Payments) ──────────────────────────────
export type CheckoutPlanNotFoundError = {
  type: 'CHECKOUT_PLAN_NOT_FOUND';
  planId: string;
};

export type CheckoutPriceResolveError = {
  type: 'CHECKOUT_PRICE_RESOLVE_FAILED';
  planId: string;
  billingPeriod: string;
};

// Legacy error name retained for compatibility. An existing subscription uses
// invoice/portal or plan-change recovery, never Free selection or a second paid mint.
export type CheckoutFreePlanConflictError = {
  type: 'CHECKOUT_FREE_PLAN_CONFLICT';
  accountId: string;
};

// plan-change paid->paid wymaga istniejącej subskrypcji (subscription_id != null).
export type PlanChangeNoSubscriptionError = {
  type: 'PLAN_CHANGE_NO_SUBSCRIPTION';
  accountId: string;
};

// The account has no Stripe Customer yet (stripe_customer_id = null) and the operation
// needs one, e.g. VAT invoice details saved before the checkout panel minted its session.
// The state is TRANSIENT and recoverable on the client (refresh the panel / mint the
// session and retry), so 409 instead of an opaque 500; see the DECISION at
// CHECKOUT_CUSTOMER_NOT_READY in `web-1/src/application/stripe/vat-invoice.operations.ts`.
export type CheckoutCustomerNotReadyError = {
  type: 'CHECKOUT_CUSTOMER_NOT_READY';
  accountId: string;
};

export type CheckoutAttemptBusyError = {
  type: 'CHECKOUT_ATTEMPT_BUSY';
  accountId: string;
  retryAfterSeconds: number;
};

export type CheckoutTermsChangedError = {
  type: 'CHECKOUT_TERMS_CHANGED';
  trialDays: number;
};

export type AccountError =
  | CheckoutTermsChangedError
  | PlanChangeQuoteStaleError
  | AccountVanityUrlTakenError
  | AccountVanityUrlReservedError
  | BrandingPlanLockedError
  | AccountTrialAlreadyUsedError
  | AccountTrialNotEligibleError
  | AccountStripeError
  | CheckoutPlanNotFoundError
  | CheckoutPriceResolveError
  | CheckoutFreePlanConflictError
  | PlanChangeNoSubscriptionError
  | CheckoutCustomerNotReadyError
  | CheckoutAttemptBusyError;

export type PlanChangeQuoteStaleError = {
  type: 'PLAN_CHANGE_QUOTE_STALE';
  reason: 'expired' | 'changed' | 'invalid' | 'canceling';
};

// Branding-light (BRANDING_VALUE_LADDER krok 1, 2026-07-11): edycja koloru
// akcentu profilu wymaga planu z can_brand_profile (Pro Marka+).
export type BrandingPlanLockedError = {
  type: 'BRANDING_PLAN_LOCKED';
  accountId: string;
};
