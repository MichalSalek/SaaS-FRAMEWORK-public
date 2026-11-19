import { DB_CLIENT } from '@app/db/db.client';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import { VALIDATION_PAGINATION } from '@kernel/policies/validation.config';

/**
 * The portfolio size shown publicly: all works NOT hidden by moderation, counted from the DB.
 *
 * DECISION: the public work count (profile `gallery_records_count`, list `photo_count`, map `gallery_count`,
 * saved stylists) is the stylist's non-hidden works, with NO pin filter and NO plan ceiling. It is a true
 * fact about the portfolio: those works exist and a connected client sees all of them, also after a plan
 * downgrade. The profile does not overpromise because it says so: "Wyróżnione prace (N)" above the pinned
 * grid and "+ jeszcze M w pełnej galerii" (see StylistProfileGallery.organism.tsx). Cutting the number to
 * pinned works killed that teaser and understated real social proof. It is counted from the DB, not from
 * `cached_gallery_count` (which tracks the same visible set), so the public number is exact even when the
 * cache has drifted.
 */

// DECISION: ceiling for a hypothetical plan with `max_pinned_records: -1` ("unlimited", see
// canPinGalleryRecord). No plan has it today, but the value must NOT reach Prisma: `take: -1` means "count
// from the end", not "no limit". The value is the kernel's canonical public page ceiling.
const UNLIMITED_PLAN_PUBLIC_GALLERY_TAKE =
  VALIDATION_PAGINATION.LIMIT_MAX_BROWSE;

/** Sufit publicznej galerii dla planu = limit pinów (jedna władza nad liczbą). */
export const resolvePublicGalleryCeiling = (
  pricingPlan: PricingPlan
): number => {
  const planPinLimit =
    PRICING_POLICY.LIMITS[narrowPricingPlan(pricingPlan)].max_pinned_records;
  return planPinLimit < 0 ? UNLIMITED_PLAN_PUBLIC_GALLERY_TAKE : planPinLimit;
};

type PublicCountSubject = { account_id: string };

/** Non-hidden works: exactly what a connected client sees. */
const PUBLIC_PORTFOLIO_WHERE = { is_hidden: false } as const;

/**
 * Work counts for many accounts in ONE query (groupBy `created_by_account_id`), no N+1 on lists.
 * An account without works gets 0. Throws on a database error: the caller is inside its own `try`
 * and maps it like any other read.
 */
export const countPublicGalleryRecordsByAccount = async (
  accounts: readonly PublicCountSubject[]
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  if (accounts.length === 0) {
    return counts;
  }
  const accountIds = [...new Set(accounts.map(a => a.account_id))];
  const grouped = await DB_CLIENT.use.galleryRecord.groupBy({
    by: ['created_by_account_id'],
    where: {
      created_by_account_id: { in: accountIds },
      ...PUBLIC_PORTFOLIO_WHERE,
    },
    _count: { _all: true },
  });
  const byAccount = new Map(
    grouped.map(row => [row.created_by_account_id, row._count._all])
  );
  for (const account of accounts) {
    counts.set(account.account_id, byAccount.get(account.account_id) ?? 0);
  }
  return counts;
};

/** Wariant dla jednego konta (profil publiczny). */
export const countPublicGalleryRecords = async (
  account: PublicCountSubject
): Promise<number> =>
  DB_CLIENT.use.galleryRecord.count({
    where: {
      created_by_account_id: account.account_id,
      ...PUBLIC_PORTFOLIO_WHERE,
    },
  });
