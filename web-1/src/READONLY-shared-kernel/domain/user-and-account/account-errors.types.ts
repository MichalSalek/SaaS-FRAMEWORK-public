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

// Wybór Free gdy konto ma aktywną PŁATNĄ subskrypcję — downgrade idzie przez
// cancel/portal, NIE przez free-select (free-branch jest tylko dla braku subskrypcji).
export type CheckoutFreePlanConflictError = {
  type: 'CHECKOUT_FREE_PLAN_CONFLICT';
  accountId: string;
};

// plan-change paid->paid wymaga istniejącej subskrypcji (subscription_id != null).
export type PlanChangeNoSubscriptionError = {
  type: 'PLAN_CHANGE_NO_SUBSCRIPTION';
  accountId: string;
};

// Konto nie ma jeszcze Stripe Customera (stripe_customer_id = null), a operacja
// go wymaga — np. zapis danych do faktury VAT wysłany zanim panel checkout
// zamintował sesję. Stan PRZEJŚCIOWY i naprawialny po stronie klienta (odśwież
// panel / zamintuj sesję i powtórz), więc 409 zamiast opaque 500 — patrz DECISION
// przy CHECKOUT_CUSTOMER_NOT_READY w vat-invoice.operations.ts.
export type CheckoutCustomerNotReadyError = {
  type: 'CHECKOUT_CUSTOMER_NOT_READY';
  accountId: string;
};

export type AccountError =
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
  | CheckoutCustomerNotReadyError;

// Branding-light (BRANDING_VALUE_LADDER krok 1, 2026-07-11): edycja koloru
// akcentu profilu wymaga planu z can_brand_profile (Pro Marka+).
export type BrandingPlanLockedError = {
  type: 'BRANDING_PLAN_LOCKED';
  accountId: string;
};
