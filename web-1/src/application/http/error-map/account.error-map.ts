// Account, branding and checkout errors (kernel `AccountError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { AccountError } from '@kernel/domain/user-and-account/account-errors.types';
import {
  respondBadRequest,
  respondConflict,
  respondForbidden,
} from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';
import { respondOpaqueFailure } from './shared.responders';

export const accountErrorMap = {
  ACCOUNT_VANITY_URL_TAKEN: (res, error) =>
    respondBadRequest(res, APP_EVENTS.INFO.ACCOUNT.VANITY_URL_ALREADY_EXISTS, {
      vanityUrl: error.vanityUrl,
    }),

  ACCOUNT_VANITY_URL_RESERVED: (res, error) =>
    respondBadRequest(res, APP_EVENTS.INFO.ACCOUNT.VANITY_URL_RESERVED, {
      vanityUrl: error.vanityUrl,
    }),

  // Branding-light: editing the accent colour needs a plan with can_brand_profile.
  BRANDING_PLAN_LOCKED: (res, error) =>
    respondForbidden(res, { accountId: error.accountId }),

  ACCOUNT_TRIAL_ALREADY_USED: (res, error) =>
    respondBadRequest(res, APP_EVENTS.INFO.ACCOUNT.TRIAL_ALREADY_USED, {
      accountId: error.accountId,
    }),

  ACCOUNT_TRIAL_NOT_ELIGIBLE: (res, error) =>
    respondBadRequest(res, APP_EVENTS.INFO.ACCOUNT.TRIAL_NOT_ELIGIBLE, {
      accountId: error.accountId,
      reason: error.reason,
    }),

  // stripeError holds Stripe-internal messages (customer ids, API key info): opaque 500.
  ACCOUNT_STRIPE_ERROR: respondOpaqueFailure,

  CHECKOUT_ATTEMPT_BUSY: (res, error) => {
    res.setHeader('Retry-After', String(error.retryAfterSeconds));
    return respondConflict(res, APP_EVENTS.INFO.ACCOUNT.CHECKOUT_ATTEMPT_BUSY, {
      retryAfterSeconds: error.retryAfterSeconds,
    });
  },

  CHECKOUT_TERMS_CHANGED: (res, error) =>
    respondConflict(res, APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED, {
      field: 'expectedTrialDays',
      code: 'CHECKOUT_TERMS_CHANGED',
      trialDays: error.trialDays,
    }),

  CHECKOUT_PLAN_NOT_FOUND: (res, error) =>
    // 400: the requested plan has no self-serve Stripe checkout (unknown plan, FREE/SCALE, or a
    // missing product). planId echoed (safe, non-PII).
    respondBadRequest(res, APP_EVENTS.INFO.ACCOUNT.CANNOT_MAKE_PAYMENT, {
      planId: error.planId,
    }),

  // Stripe price lookup failed (transient or configuration): opaque 500 like ACCOUNT_STRIPE_ERROR.
  CHECKOUT_PRICE_RESOLVE_FAILED: respondOpaqueFailure,

  CHECKOUT_FREE_PLAN_CONFLICT: (res, error) =>
    // 400: Free selected while an active PAID subscription exists; a downgrade goes through the
    // portal or a cancellation, not the free-select branch.
    respondBadRequest(res, APP_EVENTS.INFO.ACCOUNT.CANNOT_CHANGE_PRICING_PLAN, {
      accountId: error.accountId,
    }),

  PLAN_CHANGE_NO_SUBSCRIPTION: (res, error) =>
    // 400: a paid->paid plan change requires an existing subscription.
    respondBadRequest(res, APP_EVENTS.INFO.ACCOUNT.CANNOT_CHANGE_PRICING_PLAN, {
      accountId: error.accountId,
    }),

  // 409: the preview the client is confirming is expired, belongs to someone
  // else, or no longer matches the subscription. No new info event: the
  // client copies the reason locally.
  PLAN_CHANGE_QUOTE_STALE: (res, error) =>
    respondConflict(res, APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED, {
      field: 'quoteId',
      reason: error.reason,
    }),

  CHECKOUT_CUSTOMER_NOT_READY: (res, error) =>
    // 409: the account has no Stripe Customer yet (checkout session not minted). A TRANSIENT state
    // the client can repair (refresh the panel and retry), so NOT the opaque 500 of the "Stripe
    // outage" group: the client must tell "try again in a moment" from a real provider failure.
    // The invariant itself is reported to the operator where it is detected
    // (vat-invoice.operations.ts).
    respondConflict(res, APP_EVENTS.INFO.ACCOUNT.CANNOT_MAKE_PAYMENT, {
      accountId: error.accountId,
    }),
} satisfies ErrorResponderMap<OwnErrors<AccountError>>;
