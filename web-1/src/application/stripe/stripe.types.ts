// Stripe-related types used across multiple files

import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type {
  PaymentStatus,
  AccountStatus,
  SubscriptionStatus,
} from '@kernel/models/db_models.generated.dto';

/**
 * Marker zakresu aplikacji na koncie Stripe. Nie zakładamy, że obiekty na koncie
 * należą do tej aplikacji: każdą sesję nailfolio stemplujemy `metadata.projectId`
 * tym markerem, każde zapytanie jest scope'owane tą metadatą, a webhook router
 * pomija eventy i obiekty bez tego stempla (inaczej emitowałby FAŁSZYWY critical alert).
 */
export const STRIPE_PROJECT_ID = 'nailfolio' as const;

export type CheckoutMetadata = {
  planId?: string;
  userEmail?: string;
  projectId?: string;
};

/**
 * Parameters for SSOT updateAccountPlanStatus function.
 * Used by all Stripe handlers to ensure consistent updates and audit logging.
 */
export type UpdateAccountPlanStatusParams = {
  accountId: string;
  pricingPlan: PricingPlan;
  paymentStatus: PaymentStatus;
  accountStatus: AccountStatus;
  subscriptionStatus: SubscriptionStatus;
  subscriptionId: string | null;
  stripeCustomerId?: string; // Optional - only set in checkout flow
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  currentPeriodEnd: Date | null;
  // BUG-002: Stripe = jedyny właściciel pól czasowych. Undefined => zapis null (defer do Stripe).
  accountExpirationDate?: Date | null;
  upcomingPaymentDate?: Date | null;
  oldPricingPlan?: PricingPlan; // Optional - if undefined, skip audit log
  source?: 'stripe' | 'dev_panel' | 'sync';
  createdByUserId?: string;
  // Out-of-order webhook guard: created-time of the Stripe EVENT driving this write
  // (event.created). When set (webhook path) the write is gated — skipped if a NEWER
  // event already landed (last_stripe_event_at > this). Absent for authoritative
  // non-webhook callers (login-sync / dunning), which always apply.
  stripeEventAt?: Date;
};
