// UI/features/admin/feature-flags.model.ts
// Pure reading of the feature-flag list: retirement status, category from the
// kernel SSOT, grouping and order. No React here (the page, the group and the
// row import it).

import {
  FEATURE_FLAG_CATEGORIES,
  type FeatureFlagKey,
} from '@kernel/domain/feature-flags/feature-flags.config';
import { TIME } from '@kernel/application/constants.config';
import type { FeatureFlagItem } from './hooks/useAdminFeatureFlags';

/* ─── Retirement ─── */

const RETIREMENT_WARN_DAYS = 30;

export type RetirementStatus =
  | { kind: 'overdue'; daysOverdue: number }
  | { kind: 'expiring'; daysLeft: number }
  | { kind: 'none' };

export function getRetirementStatus(
  expiresAt: string | null,
  now: number = Date.now()
): RetirementStatus {
  if (!expiresAt) {
    return { kind: 'none' };
  }
  const diffDays = Math.ceil(
    (new Date(expiresAt).getTime() - now) / TIME.MS_PER_DAY
  );
  if (diffDays < 0) {
    return { kind: 'overdue', daysOverdue: Math.abs(diffDays) };
  }
  if (diffDays <= RETIREMENT_WARN_DAYS) {
    return { kind: 'expiring', daysLeft: diffDays };
  }
  return { kind: 'none' };
}

export const isOverdue = (flag: FeatureFlagItem, now?: number): boolean =>
  getRetirementStatus(flag.expires_at ?? null, now).kind === 'overdue';

const RETIREMENT_ORDER: Record<RetirementStatus['kind'], number> = {
  overdue: 0,
  expiring: 1,
  none: 2,
};

/** Overdue first, then expiring, then alphabetical by key. */
function sortByRetirement(
  flags: readonly FeatureFlagItem[],
  now?: number
): FeatureFlagItem[] {
  const rank = (flag: FeatureFlagItem) =>
    RETIREMENT_ORDER[getRetirementStatus(flag.expires_at ?? null, now).kind];
  return [...flags].sort(
    (a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key)
  );
}

/* ─── Categories ─── */

export type FlagCategory = 'UI' | 'Backend' | 'Experimental';

export const FLAG_CATEGORIES: readonly FlagCategory[] = [
  'UI',
  'Backend',
  'Experimental',
];

const KERNEL_CATEGORY_TO_UI: Record<
  (typeof FEATURE_FLAG_CATEGORIES)[FeatureFlagKey],
  FlagCategory
> = {
  ui: 'UI',
  backend: 'Backend',
  experimental: 'Experimental',
};

function isKnownFlagKey(key: string): key is FeatureFlagKey {
  return key in FEATURE_FLAG_CATEGORIES;
}

/** Category from the kernel SSOT (FEATURE_FLAG_CATEGORIES); an unknown key (a
 *  stale DB row no longer in the kernel) falls back to Experimental. */
function getCategoryForKey(key: string): FlagCategory {
  return isKnownFlagKey(key)
    ? KERNEL_CATEGORY_TO_UI[FEATURE_FLAG_CATEGORIES[key]]
    : 'Experimental';
}

export function groupFlags(
  flags: readonly FeatureFlagItem[],
  now?: number
): Record<FlagCategory, FeatureFlagItem[]> {
  const groups: Record<FlagCategory, FeatureFlagItem[]> = {
    UI: [],
    Backend: [],
    Experimental: [],
  };
  for (const flag of flags) {
    groups[getCategoryForKey(flag.key)].push(flag);
  }
  for (const category of FLAG_CATEGORIES) {
    groups[category] = sortByRetirement(groups[category], now);
  }
  return groups;
}
