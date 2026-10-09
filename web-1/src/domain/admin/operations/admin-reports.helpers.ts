import { DB_CLIENT } from '@app/db/db.client';
import type {
  GrowthDataPoint,
  TopStylist,
} from '@kernel/models/admin/admin.dto';
import { QUERY_LIMITS } from '@kernel/domain/admin/admin.config';
import type { PricingPlanPrice } from '@kernel/models/pricing/pricing.dto';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import {
  type PricingPlan,
  PricingPlanValue,
} from '@kernel/domain/pricing/pricing.config';

export type PeriodBoundaries = {
  periodStart: Date;
  periodEnd: Date;
  prevPeriodStart: Date;
  prevPeriodEnd: Date;
  sevenDaysAgo: Date;
  thirtyDaysAgo: Date;
};

export const calculatePeriodBoundaries = (
  periodDays: number
): PeriodBoundaries => {
  const now = new Date();
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const periodStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - periodDays
    )
  );
  const prevPeriodEnd = periodStart;
  const prevPeriodStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - periodDays * 2
    )
  );
  const sevenDaysAgo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7)
  );
  const thirtyDaysAgo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30)
  );
  return {
    periodStart,
    periodEnd,
    prevPeriodStart,
    prevPeriodEnd,
    sevenDaysAgo,
    thirtyDaysAgo,
  };
};

export type FunnelMetrics = {
  totalRegsCurrent: number;
  activeAccountsCurrent: number;
  paidAccountsCurrent: number;
  totalRegsPrev: number;
  activeAccountsPrev: number;
  paidAccountsPrev: number;
};

export const queryFunnelMetrics = async (
  periodStart: Date,
  periodEnd: Date,
  prevPeriodStart: Date,
  prevPeriodEnd: Date
): Promise<FunnelMetrics> => {
  const [
    totalRegsCurrent,
    activeAccountsCurrent,
    paidAccountsCurrent,
    totalRegsPrev,
    activeAccountsPrev,
    paidAccountsPrev,
  ] = await Promise.all([
    DB_CLIENT.use.user.count({
      where: { createdAt: { gte: periodStart, lt: periodEnd } },
    }),
    DB_CLIENT.use.stylistAccount.count({
      where: { created_at: { gte: periodStart, lt: periodEnd } },
    }),
    DB_CLIENT.use.stylistAccount.count({
      where: {
        created_at: { gte: periodStart, lt: periodEnd },
        pricing_plan: { not: PricingPlanValue.FREE },
      },
    }),
    DB_CLIENT.use.user.count({
      where: { createdAt: { gte: prevPeriodStart, lt: prevPeriodEnd } },
    }),
    DB_CLIENT.use.stylistAccount.count({
      where: { created_at: { gte: prevPeriodStart, lt: prevPeriodEnd } },
    }),
    DB_CLIENT.use.stylistAccount.count({
      where: {
        created_at: { gte: prevPeriodStart, lt: prevPeriodEnd },
        pricing_plan: { not: PricingPlanValue.FREE },
      },
    }),
  ]);
  return {
    totalRegsCurrent,
    activeAccountsCurrent,
    paidAccountsCurrent,
    totalRegsPrev,
    activeAccountsPrev,
    paidAccountsPrev,
  };
};

export type RetentionMetrics = {
  active7d: number;
  active30d: number;
  totalUsers: number;
};

export const queryRetentionMetrics = async (
  sevenDaysAgo: Date,
  thirtyDaysAgo: Date
): Promise<RetentionMetrics> => {
  const [active7dResult, active30dResult, totalUsers] = await Promise.all([
    DB_CLIENT.useAppLogs.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT user_id) as count
      FROM "AppLogRecord"
      WHERE created_at >= ${sevenDaysAgo}
      AND user_id IS NOT NULL
    `,
    DB_CLIENT.useAppLogs.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT user_id) as count
      FROM "AppLogRecord"
      WHERE created_at >= ${thirtyDaysAgo}
      AND user_id IS NOT NULL
    `,
    DB_CLIENT.use.user.count(),
  ]);
  return {
    active7d: Number(active7dResult[0].count),
    active30d: Number(active30dResult[0].count),
    totalUsers,
  };
};

export const queryRevenueMetrics = () =>
  DB_CLIENT.use.stylistAccount.groupBy({
    by: ['pricing_plan'],
    where: { account_status: AccountStatusValue.ACTIVE },
    _count: { _all: true },
  });

export const queryGrowthMetrics = (periodStart: Date, periodEnd: Date) =>
  DB_CLIENT.use.$queryRaw<Array<{ date: Date; count: bigint }>>`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM "users"
    WHERE created_at >= ${periodStart}
    AND created_at < ${periodEnd}
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

export const queryTopStylists = () =>
  DB_CLIENT.use.stylistAccount.findMany({
    where: { account_status: AccountStatusValue.ACTIVE },
    // DECISION (nie usuwaj tego komentarza):
    // Order + select use denormalized cached_gallery_count instead of _count: { gallery_record }
    // (D7+DD3-D1 run 24). Eliminates subquery during sort — Postgres can use a plain B-tree
    // index on cached_gallery_count if added later. Source maintained atomically by
    // createGalleryRecord_IO / deleteGalleryRecord_IO / moderation DELETE path.
    orderBy: { cached_gallery_count: 'desc' },
    take: QUERY_LIMITS.TOP_ITEMS,
    select: {
      account_id: true,
      display_name: true,
      pricing_plan: true,
      cached_gallery_count: true,
    },
  });

export type ChurnMetrics = {
  disabledCurrent: number;
  disabledPrev: number;
  deletedCurrent: number;
  deletedPrev: number;
};

export const queryChurnMetrics = async (
  periodStart: Date,
  periodEnd: Date,
  prevPeriodStart: Date,
  prevPeriodEnd: Date
): Promise<ChurnMetrics> => {
  const [disabledCurrent, disabledPrev, deletedCurrent, deletedPrev] =
    await Promise.all([
      DB_CLIENT.use.user.count({
        where: {
          is_active: false,
          disabled_at: { gte: periodStart, lt: periodEnd },
        },
      }),
      DB_CLIENT.use.user.count({
        where: {
          is_active: false,
          disabled_at: { gte: prevPeriodStart, lt: prevPeriodEnd },
        },
      }),
      // DECISION (nie usuwaj tego komentarza):
      // "Usunięci w okresie" = User.deleted_at in the window, NOT a count of
      // DeletedUser rows. Archive created_at is the insert time of the backup
      // or of the 90-day MOVE, so a backlog flush reads as thousands of
      // deletions against a couple hundred live accounts. Model A keeps the
      // user row for the 90-day recovery window, so a 7/30/90d report still
      // sees the accounts that actually left in that window.
      DB_CLIENT.use.user.count({
        where: { deleted_at: { gte: periodStart, lt: periodEnd } },
      }),
      DB_CLIENT.use.user.count({
        where: { deleted_at: { gte: prevPeriodStart, lt: prevPeriodEnd } },
      }),
    ]);
  return { disabledCurrent, disabledPrev, deletedCurrent, deletedPrev };
};

export type RevenueBreakdown = {
  revenueCounts: {
    FREE: number;
    PRO: number;
    PRO_PLUS: number;
    STUDIO: number;
    SCALE: number;
  };
  mrrEstimate: number;
};

export const processRevenueBreakdown = (
  revenueByPlan: Array<{ pricing_plan: PricingPlan; _count: { _all: number } }>,
  planPrices: readonly PricingPlanPrice[]
): RevenueBreakdown => {
  const revenueCounts: Record<PricingPlan, number> = {
    [PricingPlanValue.FREE]: 0,
    [PricingPlanValue.PRO]: 0,
    [PricingPlanValue.PRO_PLUS]: 0,
    [PricingPlanValue.STUDIO]: 0,
    [PricingPlanValue.SCALE]: 0,
  };
  revenueByPlan.forEach(item => {
    revenueCounts[item.pricing_plan] = item._count._all;
  });
  // DECISION (nie usuwaj tego komentarza):
  // Stripe = JEDYNE SSOT cen (B37). MRR liczony z live cen Stripe (monthly_price
  // w groszach → PLN: /100), NIE z hardcoded stałej. Gdy Stripe niedostępny,
  // fetchPricingPlans zwraca monthly_price=null → plan kontrybuuje 0 (estymata
  // zaniżona zamiast dryfującej). mrrEstimate to szacunek (count × cena miesięczna
  // list price), ignoruje annual/zniżki/proration — pełny MRR z billingu Stripe.
  // SCALE wchodzi do sumy: ma realny Stripe price-id (PLAN_ID_MAP.SCALE) i może
  // mieć realne subskrypcje (przydzielane via contact-sales / admin); na LP jest
  // contact-only (isContact), ale to fakt prezentacyjny, nie billingowy. Gdy
  // Stripe nie zwraca ceny SCALE — kontrybuuje 0 jak każdy inny plan.
  const monthlyPlnByPlan = new Map<PricingPlan, number>(
    planPrices.map(p => [
      p.plan_id,
      p.monthly_price != null ? p.monthly_price / 100 : 0,
    ])
  );
  const priceOf = (plan: PricingPlan): number =>
    monthlyPlnByPlan.get(plan) ?? 0;
  const mrrEstimate =
    revenueCounts[PricingPlanValue.PRO] * priceOf(PricingPlanValue.PRO) +
    revenueCounts[PricingPlanValue.PRO_PLUS] *
      priceOf(PricingPlanValue.PRO_PLUS) +
    revenueCounts[PricingPlanValue.STUDIO] * priceOf(PricingPlanValue.STUDIO) +
    revenueCounts[PricingPlanValue.SCALE] * priceOf(PricingPlanValue.SCALE);
  return { revenueCounts, mrrEstimate };
};

export const processGrowthData = (
  dailyGrowthRaw: Array<{ date: Date; count: bigint }>
): GrowthDataPoint[] =>
  dailyGrowthRaw.map(row => ({
    // ISO 8601 always contains 'T', so [0] (the date part) is always present;
    // `?? ''` only satisfies noUncheckedIndexedAccess without a non-null assertion.
    date: row.date.toISOString().split('T')[0] ?? '',
    count: Number(row.count),
  }));

export const processTopStylists = (
  topStylistsRaw: Array<{
    account_id: string;
    display_name: string | null;
    pricing_plan: PricingPlan;
    cached_gallery_count: number;
  }>
): TopStylist[] =>
  topStylistsRaw.map(s => ({
    account_id: s.account_id,
    display_name: s.display_name,
    gallery_record_count: s.cached_gallery_count,
    pricing_plan: s.pricing_plan,
  }));
