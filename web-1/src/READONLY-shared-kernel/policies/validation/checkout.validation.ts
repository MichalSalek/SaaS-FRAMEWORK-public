import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ACCOUNT_DTO_API_V1 } from '../../models/account/account.dto';
import { PricingPlanValue } from '../../domain/pricing/pricing.config';
import { VALIDATION_LENGTHS } from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

// Checkout and plan change (SPE). Split out of account.validation.ts, which sits
// on a max-lines ratchet: the payment request shapes grow on their own (promo
// code, S122) and are not account profile data.

const V = VALIDATION_MESSAGES;

// ── checkoutSession (SPE) ──────────────────────────────────────────────────
// planId = PricingPlan (Free|Pro|Pro+|Studio|Scale); billingPeriod month|year;
// source opcjonalny (np. 'pricing'|'onboarding'|'account-pay'). Free-branch i
// dobór produktu Stripe rozstrzyga backend — walidator pilnuje tylko kształtu.
const checkoutSessionSchema = z.object({
  planId: z.enum(PricingPlanValue, { error: V.payment.invalidPlan }),
  billingPeriod: z.enum(['month', 'year'], {
    error: V.payment.invalidBillingPeriod,
  }),
  // source ląduje 1:1 w Stripe Checkout Session metadata (cap 500 zn./wartość).
  // Bound < cap zamyka self-DoS przez surowy POST (frontend wysyła krótki enum:
  // 'onboarding'|'account-pay'|'pricing'); nadmiarowy string → opaque 500 z Stripe.
  source: z
    .string()
    .max(VALIDATION_LENGTHS.CHECKOUT_SOURCE_MAX, V.payment.invalidSource)
    .optional(),
  promo: z
    .string()
    .trim()
    .max(VALIDATION_LENGTHS.CHECKOUT_PROMO_MAX, V.payment.invalidPromo)
    .regex(/^[A-Za-z0-9-]+$/, V.payment.invalidPromo)
    .optional(),
});

// ── planChange (SPE) ───────────────────────────────────────────────────────
// Zmiana planu paid->paid; targetPlanId = PricingPlan, billingPeriod month|year.
const planChangeSchema = z.object({
  targetPlanId: z.enum(PricingPlanValue, { error: V.payment.invalidPlan }),
  billingPeriod: z.enum(['month', 'year'], {
    error: V.payment.invalidBillingPeriod,
  }),
});

export const checkoutValidators = {
  checkoutSession: (data: unknown) => zodValidate(checkoutSessionSchema, data),
  planChange: (data: unknown) => zodValidate(planChangeSchema, data),
} as const;

// Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation).
export type CheckoutRequestSchemaBindings = {
  checkoutSession: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof checkoutSessionSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['REQUEST']
    >
  >;
  planChange: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof planChangeSchema>,
      ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['REQUEST']
    >
  >;
};
