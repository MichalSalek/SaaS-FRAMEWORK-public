import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PLAN_TIER_ORDER } from '@kernel/domain/pricing/pricing-policy';
import {
  PRICING_POLICY,
  isUnlimitedLimit,
  type PlanConfigType,
} from '@kernel/policies/pricing.policy';

/** next-intl namespace the catalog keys live under (loaded by every page that shows plans). */
export const PLAN_FEATURE_NAMESPACE = 'account.plan';

export type PlanFeatureValue =
  | { readonly kind: 'absent' }
  | { readonly kind: 'included' }
  | { readonly kind: 'limited'; readonly count: number }
  | { readonly kind: 'unlimited' };

export type PlanFeatureKind = PlanFeatureValue['kind'];

const ABSENT: PlanFeatureValue = { kind: 'absent' };
const INCLUDED: PlanFeatureValue = { kind: 'included' };
const UNLIMITED: PlanFeatureValue = { kind: 'unlimited' };

const flag = (enabled: boolean): PlanFeatureValue =>
  enabled ? INCLUDED : ABSENT;

/** A kernel limit: -1 = unlimited, 0 = not in the plan, N = up to N. */
const limit = (n: number): PlanFeatureValue => {
  if (isUnlimitedLimit(n)) {
    return UNLIMITED;
  }
  return n > 0 ? { kind: 'limited', count: n } : ABSENT;
};

// DECISION: Scale is the contract plan. The kernel has no capability flag for what the contract
// adds (custom work, response time, a named onboarding lead): Stripe sells no Scale price and
// checkout refuses it (stripe.config `PLAN_ID_MAP`), so the plan is agreed by contact. These lines
// are therefore keyed to the plan identity, in this one place.
const isContractPlan = (plan: PricingPlan): boolean =>
  plan === PricingPlanValue.SCALE;

interface PlanFeatureDefinition {
  /** Value per plan, derived from the kernel config. */
  readonly value: (
    limits: PlanConfigType,
    plan: PricingPlan
  ) => PlanFeatureValue;
  /**
   * The capability belongs to the salon OWNER (team accounts, the salon page).
   * A member who inherits Studio through a salon does not get it on her account.
   */
  readonly ownerOnly?: boolean;
  /** Row in the `/pricing` comparison table (`catalog.<id>.label`). */
  readonly inTable?: boolean;
  /** The table cell words the value (`cellLimited` / `cellUnlimited`) instead of a bare number / ∞. */
  readonly cellWords?: readonly ('limited' | 'unlimited')[];
}

/*
 * Order = listing order on every surface and the tie-break of highlights.
 * Limits first, then the salon layer, then the contract, then the rest.
 */
const DEFINITIONS = {
  gallery: { value: l => limit(l.max_gallery_records), inTable: true },
  clients: { value: l => limit(l.max_paired_clients), inTable: true },
  // DECISION: the team count is ALL accounts of the salon, the owner's included
  // (`max_staff_members` counts only the invited members: 9 → "up to 10 accounts"). Every sales
  // sentence counts that way.
  team: {
    value: l => {
      if (!l.can_use_staff_accounts) {
        return ABSENT;
      }
      return isUnlimitedLimit(l.max_staff_members)
        ? UNLIMITED
        : { kind: 'limited', count: l.max_staff_members + 1 };
    },
    ownerOnly: true,
    inTable: true,
    cellWords: ['unlimited'],
  },
  sharedSalonGallery: {
    value: l => flag(l.can_have_shared_salon_gallery),
    inTable: true,
  },
  salonProfile: {
    value: l => flag(l.can_have_salon_profile),
    ownerOnly: true,
    inTable: true,
  },
  memberPlan: { value: l => flag(l.can_use_staff_accounts) },
  customFeatures: { value: (_l, plan) => flag(isContractPlan(plan)) },
  multiLocation: { value: (_l, plan) => flag(isContractPlan(plan)) },
  responseTime: { value: (_l, plan) => flag(isContractPlan(plan)) },
  onboardingLead: { value: (_l, plan) => flag(isContractPlan(plan)) },
  setupHelp: { value: (_l, plan) => flag(isContractPlan(plan)) },
  history: {
    value: l => limit(l.history_retention_days),
    inTable: true,
    cellWords: ['limited', 'unlimited'],
  },
  brandColor: { value: l => flag(l.can_brand_profile), inTable: true },
  // DECISION: the watermark has no kernel flag; the backend draws it exactly when the effective
  // plan is FREE (`gallery-public.operations.ts`, `showWatermark`). Same predicate here.
  noWatermark: {
    value: (_l, plan) => flag(plan !== PricingPlanValue.FREE),
    inTable: true,
  },
  clientInsights: {
    value: l => flag(l.can_view_client_insights),
    inTable: true,
  },
  pinned: { value: l => limit(l.max_pinned_records), inTable: true },
  // A stylist's public profile is part of every plan (no kernel flag gates it).
  publicProfile: { value: () => INCLUDED, inTable: true },
  qrSession: { value: l => flag(l.can_use_session_share), inTable: true },
} as const satisfies Record<string, PlanFeatureDefinition>;

export type PlanFeatureId = keyof typeof DEFINITIONS;

export const PLAN_FEATURE_IDS = Object.freeze(
  Object.keys(DEFINITIONS) as PlanFeatureId[]
);

const definitionOf = (id: PlanFeatureId): PlanFeatureDefinition =>
  DEFINITIONS[id];

export const isOwnerOnlyPlanFeature = (id: PlanFeatureId): boolean =>
  definitionOf(id).ownerOnly === true;

export function planFeatureValue(
  id: PlanFeatureId,
  plan: PricingPlan
): PlanFeatureValue {
  return definitionOf(id).value(PRICING_POLICY.utils.getPlanConfig(plan), plan);
}

export interface PlanFeatureLine {
  readonly id: PlanFeatureId;
  readonly key: string;
  readonly params?: { readonly count: number };
}

/** Key of the bullet for a present value; `null` for an absent one. */
export function planFeatureLineKey(
  id: PlanFeatureId,
  kind: PlanFeatureKind
): string | null {
  return kind === 'absent' ? null : `catalog.${id}.${kind}`;
}

const toLine = (
  id: PlanFeatureId,
  value: PlanFeatureValue
): PlanFeatureLine | null => {
  const key = planFeatureLineKey(id, value.kind);
  if (key === null) {
    return null;
  }
  return value.kind === 'limited'
    ? { id, key, params: { count: value.count } }
    : { id, key };
};

export interface ResolvePlanFeaturesOptions {
  /** Feature ids a surface shows elsewhere (the `/pricing` card has its own pinned line). */
  readonly exclude?: readonly PlanFeatureId[];
  /**
   * `false` drops owner-only lines: the plan comes from a salon membership,
   * not from the account's own salon plan. Default `true`.
   */
  readonly includeOwnerOnly?: boolean;
}

/** Full, ordered feature list of a plan. */
export function resolvePlanFeatures(
  plan: PricingPlan,
  options: ResolvePlanFeaturesOptions = {}
): PlanFeatureLine[] {
  const { exclude = [], includeOwnerOnly = true } = options;
  return PLAN_FEATURE_IDS.filter(
    id =>
      !exclude.includes(id) && (includeOwnerOnly || !isOwnerOnlyPlanFeature(id))
  )
    .map(id => toLine(id, planFeatureValue(id, plan)))
    .filter((line): line is PlanFeatureLine => line !== null);
}

const sameValue = (a: PlanFeatureValue, b: PlanFeatureValue): boolean =>
  a.kind === b.kind &&
  (a.kind !== 'limited' || (b.kind === 'limited' && a.count === b.count));

/**
 * The `n` lines a short preview shows: what THIS plan adds over the next cheaper
 * one first (catalog order), then the shared lines. A preview stays a projection
 * of the full list, it only reorders and cuts it.
 */
export function planFeatureHighlights(
  plan: PricingPlan,
  n: number
): PlanFeatureLine[] {
  const tier = PLAN_TIER_ORDER.indexOf(plan);
  const cheaper = tier > 0 ? PLAN_TIER_ORDER[tier - 1] : undefined;
  const lines = resolvePlanFeatures(plan);
  if (cheaper === undefined) {
    return lines.slice(0, n);
  }
  const isOwn = (line: PlanFeatureLine): boolean =>
    !sameValue(
      planFeatureValue(line.id, plan),
      planFeatureValue(line.id, cheaper)
    );
  return [...lines.filter(isOwn), ...lines.filter(line => !isOwn(line))].slice(
    0,
    n
  );
}

/* ─── Comparison table ─── */

export interface PlanFeatureTableRow {
  readonly id: PlanFeatureId;
  readonly labelKey: string;
}

export const PLAN_FEATURE_TABLE_ROWS: readonly PlanFeatureTableRow[] =
  Object.freeze(
    PLAN_FEATURE_IDS.filter(id => definitionOf(id).inTable === true).map(
      id => ({ id, labelKey: `catalog.${id}.label` })
    )
  );

/** Cell of the comparison table: a check / cross, or a key with params, or a bare value. */
export type PlanFeatureCell =
  | { readonly kind: 'flag'; readonly included: boolean }
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'key';
      readonly key: string;
      readonly params?: { readonly count: number };
    };

export function planFeatureCell(
  id: PlanFeatureId,
  plan: PricingPlan
): PlanFeatureCell {
  const value = planFeatureValue(id, plan);
  const words = definitionOf(id).cellWords ?? [];
  switch (value.kind) {
    case 'absent':
      return { kind: 'flag', included: false };
    case 'included':
      return { kind: 'flag', included: true };
    case 'limited':
      return words.includes('limited')
        ? {
            kind: 'key',
            key: `catalog.${id}.cellLimited`,
            params: { count: value.count },
          }
        : { kind: 'text', text: String(value.count) };
    case 'unlimited':
      return words.includes('unlimited')
        ? { kind: 'key', key: `catalog.${id}.cellUnlimited` }
        : { kind: 'text', text: '∞' };
  }
}

/** Every key the catalog can ask for with today's kernel (the test checks them in pl/en/de). */
export function planFeatureKeysInUse(): string[] {
  const keys = new Set<string>();
  for (const plan of PLAN_TIER_ORDER) {
    for (const line of resolvePlanFeatures(plan)) {
      keys.add(line.key);
    }
    for (const row of PLAN_FEATURE_TABLE_ROWS) {
      keys.add(row.labelKey);
      const cell = planFeatureCell(row.id, plan);
      if (cell.kind === 'key') {
        keys.add(cell.key);
      }
    }
  }
  return [...keys].sort();
}

/* ─── Numbers in sentences outside the lists ─── */

/**
 * The count of a feature that MUST be limited in `plan` (a sentence such as
 * "Free Demo: up to {photos} photos" only reads with a number). Throws when the
 * kernel makes it absent or unlimited: the build or the test fails loudly
 * instead of a sentence promising a limit that no longer exists.
 */
export function planLimitCount(id: PlanFeatureId, plan: PricingPlan): number {
  const value = planFeatureValue(id, plan);
  if (value.kind !== 'limited') {
    throw new Error(
      `plan-features: ${id} on ${plan} is ${value.kind}, a sentence needs a number`
    );
  }
  return value.count;
}

/** Params of the Free Demo summary lines (`account.pay.heroMetaFree`, `taglineFree`). */
export const freePlanSummaryParams = (): {
  photos: number;
  clients: number;
  pins: number;
} => ({
  photos: planLimitCount('gallery', PricingPlanValue.FREE),
  clients: planLimitCount('clients', PricingPlanValue.FREE),
  pins: planLimitCount('pinned', PricingPlanValue.FREE),
});

/** Params of the /pricing card sentences (taglines, Studio anchoring note, Free footer). */
export const pricingCardCopyParams = (): {
  historyDays: number;
  teamAccounts: number;
  freePhotos: number;
} => ({
  historyDays: planLimitCount('history', PricingPlanValue.PRO),
  teamAccounts: planLimitCount('team', PricingPlanValue.STUDIO),
  freePhotos: planLimitCount('gallery', PricingPlanValue.FREE),
});
