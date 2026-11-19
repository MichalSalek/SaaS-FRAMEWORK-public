import type Stripe from 'stripe';
import { TIME } from '@kernel/application/constants.config';
import type { Prisma } from '../../../prisma/js-client';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import type {
  BillingCurrency,
  CountryCode,
} from '@kernel/domain/localization/country.config';
import type {
  AccountStripeError,
  CheckoutPlanNotFoundError,
  CheckoutPriceResolveError,
  CheckoutFreePlanConflictError,
  CheckoutAttemptBusyError,
  CheckoutTermsChangedError,
} from '@kernel/domain/user-and-account/account-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';

export const CHECKOUT_ATTEMPT_LEASE_MS = 60_000;
export const CHECKOUT_ATTEMPT_SESSION_MS =
  24 * TIME.MS_PER_HOUR - 2 * TIME.MS_PER_MINUTE;
export const CHECKOUT_ATTEMPT_REQUEST_MS = 8_000;

export type CheckoutAttemptIntent = {
  userId: string;
  accountId: string;
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  currency: BillingCurrency;
  billingCountry?: CountryCode;
  automaticTax: boolean;
  mode: 'custom' | 'hosted';
  source?: string;
  promo?: string;
  expectedTrialDays?: number;
};
export type CheckoutPreparedMeta = {
  returnUrl: string;
  billingAddressRequired: boolean;
  promoRejected: boolean;
};
export type PreparedCheckout = {
  params: Stripe.Checkout.SessionCreateParams;
  meta: CheckoutPreparedMeta;
};
export type CheckoutAttemptError =
  | AccountStripeError
  | CheckoutPlanNotFoundError
  | CheckoutPriceResolveError
  | CheckoutFreePlanConflictError
  | CheckoutAttemptBusyError
  | CheckoutTermsChangedError
  | AccountNotFoundError
  | DatabaseError
  | ValidationError;
export type PrepareCheckout = () => Promise<
  OperationResult<PreparedCheckout, CheckoutAttemptError>
>;
export type CheckoutAttemptResult = {
  session: Stripe.Checkout.Session;
  meta: CheckoutPreparedMeta;
  trialDays: number;
};
export type CheckoutAttemptPhase =
  'empty' | 'preparing' | 'open' | 'completed' | 'expired';
export type CheckoutAttemptRow = {
  account_id: string;
  attempt_id: string | null;
  intent_fingerprint: string | null;
  intent: Prisma.JsonValue | null;
  stripe_params: Prisma.JsonValue | null;
  response_meta: Prisma.JsonValue | null;
  stripe_session_id: string | null;
  stripe_subscription_id: string | null;
  customer_id: string | null;
  phase: CheckoutAttemptPhase;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** Database clock returned by each store statement, not a persisted column. */
  db_now: Date;
};

export type AttemptFence = {
  accountId: string;
  owner: string;
  attemptId: string;
};
export interface CheckoutAttemptStore {
  read(accountId: string): Promise<CheckoutAttemptRow | null>;
  claim(accountId: string, owner: string): Promise<CheckoutAttemptRow | null>;
  start(input: {
    accountId: string;
    owner: string;
    attemptId: string;
    fingerprint: string;
    intentJson: string;
  }): Promise<CheckoutAttemptRow | null>;
  prepared(
    input: AttemptFence & {
      paramsJson: string;
      metaJson: string;
      customerId: string;
    }
  ): Promise<CheckoutAttemptRow | null>;
  session(
    input: AttemptFence & {
      sessionId: string | null;
      subscriptionId: string | null;
      phase: 'open' | 'completed' | 'expired';
    }
  ): Promise<CheckoutAttemptRow | null>;
  expire(input: AttemptFence): Promise<CheckoutAttemptRow | null>;
  release(accountId: string, owner: string): Promise<void>;
}
