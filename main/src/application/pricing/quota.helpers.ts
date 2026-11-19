import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PLAN_TIER_ORDER } from '@kernel/domain/pricing/pricing-policy';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';

export type QuotaFeature = 'gallery' | 'clients' | 'pinned' | 'staff';

export type QuotaUpgradeRoute =
  | { kind: 'pay'; planId: PricingPlan }
  | { kind: 'contact'; href: typeof ROUTES_FRONT.CONTACT };

/** Scale is contact-only; it must never be sent into the self-serve checkout funnel. */
export function getQuotaUpgradeRoute(planId: PricingPlan): QuotaUpgradeRoute {
  return planId === PricingPlanValue.SCALE
    ? { kind: 'contact', href: ROUTES_FRONT.CONTACT }
    : { kind: 'pay', planId };
}

export type QuotaSnapshot =
  | { state: 'unknown' }
  | { state: 'unlimited'; count: number }
  | {
      state: 'available' | 'one_remaining' | 'exhausted';
      count: number;
      limit: number;
      remaining: number;
    };

type PlanQuotaKey =
  | 'max_gallery_records'
  | 'max_paired_clients'
  | 'max_pinned_records'
  | 'max_staff_members';

const QUOTA_LIMIT_KEY: Record<QuotaFeature, PlanQuotaKey> = {
  gallery: 'max_gallery_records',
  clients: 'max_paired_clients',
  pinned: 'max_pinned_records',
  staff: 'max_staff_members',
};

const isCount = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Unknown input stays unknown; only the kernel's -1 sentinel means unlimited. */
export function resolveQuotaSnapshot(
  count: number | null | undefined,
  limit: number | null | undefined
): QuotaSnapshot {
  if (
    !isCount(count) ||
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < -1
  ) {
    return { state: 'unknown' };
  }

  if (limit === -1) {
    return { state: 'unlimited', count };
  }

  const remaining = Math.max(0, limit - count);
  return {
    state:
      remaining === 0
        ? 'exhausted'
        : remaining === 1
          ? 'one_remaining'
          : 'available',
    count,
    limit,
    remaining,
  };
}

/** First higher tier with a larger quota or the feature unlocked. */
export function getLowestEligibleUpgradePlan(
  feature: QuotaFeature,
  currentPlan: PricingPlan
): PricingPlan | null {
  const currentIndex = PLAN_TIER_ORDER.indexOf(currentPlan);
  if (currentIndex < 0) {
    return null;
  }

  const limitKey = QUOTA_LIMIT_KEY[feature];
  const currentConfig = PRICING_POLICY.utils.getPlanConfig(currentPlan);
  const currentLimit = currentConfig[limitKey];
  if (currentLimit === -1) {
    return null;
  }

  return (
    PLAN_TIER_ORDER.slice(currentIndex + 1).find(plan => {
      const candidate = PRICING_POLICY.utils.getPlanConfig(plan);
      if (feature === 'staff' && !candidate.can_use_staff_accounts) {
        return false;
      }
      const candidateLimit = candidate[limitKey];
      return candidateLimit === -1 || candidateLimit > currentLimit;
    }) ?? null
  );
}

type PlanLimitErrorData = {
  planType: PricingPlan | 'PLATFORM';
};

const isPlanLimitErrorData = (data: unknown): data is PlanLimitErrorData => {
  if (data === null || typeof data !== 'object' || !('planType' in data)) {
    return false;
  }
  const planType: unknown = data.planType;
  return (
    planType === 'PLATFORM' ||
    Object.values(PricingPlanValue).some(plan => plan === planType)
  );
};

/**
 * Translate an authoritative backend limit response into the attempted feature.
 * Pairing's PLATFORM cap belongs to the client account and never maps to an
 * upgrade offer for the stylist.
 */
export function getQuotaFailureFeature(
  feature: QuotaFeature,
  event: string,
  data: unknown
): QuotaFeature | null {
  if (
    feature === 'pinned' &&
    event === APP_EVENTS.INFO.GALLERY.GALLERY_PIN_LIMIT_REACHED
  ) {
    return 'pinned';
  }

  if (event !== APP_EVENTS.INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO) {
    return null;
  }
  if (!isPlanLimitErrorData(data) || data.planType === 'PLATFORM') {
    return null;
  }
  return feature;
}
