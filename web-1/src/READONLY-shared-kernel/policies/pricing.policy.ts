import type { PricingPlan } from '../domain/pricing/pricing.config';
import { PricingPlanValue } from '../domain/pricing/pricing.config';

import { isPricingPlanNarrower } from '../models/type_narrowing';

/**
 * PLATFORM LIMITS
 *
 * Platform limits independent of the pricing plan. They apply to CLIENT accounts (not stylists):
 * clients have no pricing plan and use the platform for free, so their limits are platform
 * constants, not per-plan.
 */
export const PLATFORM_LIMITS: { readonly MAX_PAIRED_STYLISTS: number } = {
  MAX_PAIRED_STYLISTS: 3,
};

/**
 * UNLIMITED LIMIT GUARD
 *
 * DECISION: `-1` in a limit column means "unlimited", not "zero" or "no data". A bare `=== -1` is
 * dangerous because every place that forgets the check turns "unlimited" into "limit minus one", a
 * block at zero records that hits only the most expensive plans, the ones tested least. The contract
 * was once repeated bare in this policy, across the frontend AND in the backend enforcement gates
 * (`gallery-create`, `gallery-pin`, `salon-staff-management`, `session-container-share`); migrating
 * only the display layer left untouched exactly the places that refuse an upload, a pin, a team seat
 * or a share. The predicate now lives in both layers.
 *
 * A named constant plus predicate gives one place to search (`isUnlimitedLimit`) and one place to
 * change should the contract ever move to `null`.
 */
export const UNLIMITED_LIMIT = -1;

/** `true` when the limit means "unlimited". See the DECISION at `UNLIMITED_LIMIT`. */
export const isUnlimitedLimit = (limit: number): boolean =>
  limit === UNLIMITED_LIMIT;

export const PRICING_LIMITS_SSOT = {
  FREE: {
    max_gallery_records: 5, // Demo plan: deliberately low limits
    max_pinned_records: 3, // Pinned Photos Differentiation: 3 → 10 → 15 → 30 → 50
    max_paired_clients: 2, // Demo plan: deliberately low limits
    can_use_session_share: true, // All plans
    can_use_multi_session: true, // All plans (login from several devices)
    can_have_salon_profile: false,
    can_have_shared_salon_gallery: false,
    can_use_staff_accounts: false, // Tylko Studio+
    can_view_history: false,
    can_view_client_insights: false,
    can_brand_profile: false,
    history_retention_days: 0,
    max_staff_members: 0,
  },
  PRO: {
    max_gallery_records: -1, // Unlimited
    max_pinned_records: 10, // Pinned Photos Differentiation: 3 → 10 → 15 → 30 → 50
    max_paired_clients: -1, // Unlimited
    can_use_session_share: true, // All plans
    can_use_multi_session: true, // All plans
    can_have_salon_profile: false,
    can_have_shared_salon_gallery: false,
    can_use_staff_accounts: false, // Tylko Studio+
    can_view_history: true,
    can_view_client_insights: true,
    can_brand_profile: false,
    history_retention_days: 90,
    max_staff_members: 0,
  },
  PRO_PLUS: {
    // DECISION: the former decoy is now the real middle tier "Pro Marka" (109 PLN, demanding solo
    // stylist): full client history from day one; branding elements (colour/logo/cover/vanity) arrive in
    // releases without a price change, see BRANDING_VALUE_LADDER.md (owner).
    max_gallery_records: -1, // Unlimited
    max_pinned_records: 15, // Pinned Photos Differentiation: 3 → 10 → 15 → 30 → 50
    max_paired_clients: -1, // Unlimited
    can_use_session_share: true, // All plans
    can_use_multi_session: true, // All plans
    can_have_salon_profile: false,
    can_have_shared_salon_gallery: false,
    can_use_staff_accounts: false, // Team = Studio+ (segmentation: 1 plan = 1 segment)
    can_view_history: true,
    can_view_client_insights: true,
    can_brand_profile: true,
    history_retention_days: -1, // Full history: the core value of Pro Marka (solo premium)
    max_staff_members: 0,
  },
  STUDIO: {
    max_gallery_records: -1, // Unlimited
    max_pinned_records: 30, // Pinned Photos Differentiation: 3 → 10 → 15 → 30 → 50
    max_paired_clients: -1, // Unlimited
    can_use_session_share: true, // All plans
    can_use_multi_session: true, // All plans
    can_have_salon_profile: true,
    can_have_shared_salon_gallery: true,
    can_use_staff_accounts: true, // Staff Accounts
    can_view_history: true,
    can_view_client_insights: true,
    can_brand_profile: true,
    history_retention_days: -1,
    // DECISION: Model B (owner): Studio includes ALL team accounts at a flat price, ZERO
    // per-seat surcharge. max_staff_members=9 (owner + 9 = fair-use cap of 10 accounts, anti-abuse, not
    // monetisation); teams over 10, chains and multi-location go to Scale (contact sales). Marginal seat
    // cost is under 5 zl/month (storage scales with photos and clients, not logins), and per-seat
    // taxed the core value (knowledge stays in the salon) and pushed account sharing. This reverses the
    // 2026-07-10 +35/seat decision. StylistAccount.paid_staff_seats stays in the schema (default 0, not
    // used as a pricing mechanism; the effective limit is still max_staff_members + paid_staff_seats).
    // Analysis: PRICING_PACKAGING.md §2.4.
    max_staff_members: 9,
  },
  SCALE: {
    max_gallery_records: -1, // Unlimited
    max_pinned_records: 50, // Pinned Photos Differentiation: 3 → 10 → 15 → 30 → 50
    max_paired_clients: -1, // Unlimited
    can_use_session_share: true, // All plans
    can_use_multi_session: true, // All plans
    can_have_salon_profile: true,
    can_have_shared_salon_gallery: true,
    can_use_staff_accounts: true, // Staff Accounts + Custom features
    can_view_history: true,
    can_view_client_insights: true,
    can_brand_profile: true,
    history_retention_days: -1,
    max_staff_members: -1, // Unlimited
  },
} as const;

// NOTE: Import type only (avoid circular dependency)
export type PlanConfigType = {
  plan_id: string;
  max_gallery_records: number;
  max_pinned_records: number;
  max_paired_clients: number;
  can_use_session_share: boolean;
  can_use_multi_session: boolean;
  can_have_salon_profile: boolean;
  can_have_shared_salon_gallery: boolean;
  can_use_staff_accounts: boolean;
  can_view_history: boolean;
  /** Aggregated inspiration tags (colours, traits, nail length) in paid plans. */
  can_view_client_insights: boolean;
  /** Branding-light: the profile accent colour. */
  can_brand_profile: boolean;
  history_retention_days: number;
  max_staff_members: number;
};

export type PRICING_POLICY_TYPE = {
  LIMITS: typeof PRICING_LIMITS_SSOT;
  PLATFORM_LIMITS: typeof PLATFORM_LIMITS;
  utils: {
    PRICING_PLAN_VALUE_TYPE_NARROWER: (
      maybePricingPlanValue: unknown
    ) => maybePricingPlanValue is PricingPlan;

    // Quota checks (per-plan — STYLIST limits)
    canCreateGalleryRecord: (
      config: PlanConfigType,
      currentCount: number
    ) => boolean;
    canPairClient: (config: PlanConfigType, currentCount: number) => boolean;
    canPinGalleryRecord: (
      config: PlanConfigType,
      currentPinnedCount: number
    ) => boolean;

    // Quota checks (platform — CLIENT limits)
    canPairStylist: (currentCount: number) => boolean;

    // Feature flags
    canUseSessionShare: (config: PlanConfigType) => boolean;
    canUseMultiSession: (config: PlanConfigType) => boolean;
    canUseStaffAccounts: (config: PlanConfigType) => boolean;
    canViewHistory: (config: PlanConfigType) => boolean;
    getHistoryRetentionDays: (config: PlanConfigType) => number;

    // Get config for plan
    getPlanConfig: (plan: PricingPlan) => PlanConfigType;
  };
};

export const PRICING_POLICY: PRICING_POLICY_TYPE = {
  LIMITS: PRICING_LIMITS_SSOT,
  PLATFORM_LIMITS,

  utils: {
    PRICING_PLAN_VALUE_TYPE_NARROWER: (
      maybePricingPlanValue
    ): maybePricingPlanValue is PricingPlan => {
      return isPricingPlanNarrower(maybePricingPlanValue);
    },

    // Quota checks (per-plan — STYLIST limits)

    canCreateGalleryRecord: (
      config: PlanConfigType,
      currentCount: number
    ): boolean => {
      return (
        isUnlimitedLimit(config.max_gallery_records) ||
        currentCount < config.max_gallery_records
      );
    },

    canPairClient: (config: PlanConfigType, currentCount: number): boolean => {
      return (
        isUnlimitedLimit(config.max_paired_clients) ||
        currentCount < config.max_paired_clients
      );
    },

    canPinGalleryRecord: (
      config: PlanConfigType,
      currentPinnedCount: number
    ): boolean => {
      return (
        isUnlimitedLimit(config.max_pinned_records) ||
        currentPinnedCount < config.max_pinned_records
      );
    },

    // Quota checks (platform — CLIENT limits)

    canPairStylist: (currentCount: number): boolean => {
      return (
        isUnlimitedLimit(PLATFORM_LIMITS.MAX_PAIRED_STYLISTS) ||
        currentCount < PLATFORM_LIMITS.MAX_PAIRED_STYLISTS
      );
    },

    // Feature flags

    canUseSessionShare: (config: PlanConfigType): boolean => {
      return config.can_use_session_share;
    },

    canUseMultiSession: (config: PlanConfigType): boolean => {
      return config.can_use_multi_session;
    },

    canUseStaffAccounts: (config: PlanConfigType): boolean => {
      return config.can_use_staff_accounts;
    },

    canViewHistory: (config: PlanConfigType): boolean => {
      return config.can_view_history;
    },

    getHistoryRetentionDays: (config: PlanConfigType): number => {
      return config.history_retention_days;
    },

    // Get config for plan (direct access — 4 tiers = 4 keys)
    // DECISION: unknown plan falls back to FREE (fail-safe) without logging: this shared policy is also
    // imported by the frontend (`main/src/UI/**`), which has no reportIssueBackend; degradation is
    // observed by the backend caller. Recognition goes through `isPricingPlanNarrower` (same predicate
    // as `narrowPricingPlan`), NOT the `in` operator: `in` walks the prototype chain and answered yes
    // for 'constructor', 'toString', '__proto__', so the spread returned a config with every limit
    // `undefined` instead of the FREE fallback.
    getPlanConfig: (plan: PricingPlan): PlanConfigType => {
      const key: keyof typeof PRICING_LIMITS_SSOT = isPricingPlanNarrower(plan)
        ? plan
        : 'FREE';
      return { plan_id: plan, ...PRICING_LIMITS_SSOT[key] };
    },
  },
} as const;

/**
 * Narrow a DB string to PricingPlan with FREE fallback.
 * Use instead of `value as PricingPlan` unsafe casts.
 */
// DECISION: see getPlanConfig above (unknown plan falls back to FREE, no logging in shared policy).
export const narrowPricingPlan = (value: string): PricingPlan =>
  isPricingPlanNarrower(value) ? value : PricingPlanValue.FREE;
