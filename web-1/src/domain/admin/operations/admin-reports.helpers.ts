import { Prisma } from '../../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import type {
  GrowthDataPoint,
  TopStylist,
} from '@kernel/models/admin/admin.dto';
import { QUERY_LIMITS } from '@kernel/domain/admin/admin.config';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import {
  type PricingPlan,
  PricingPlanValue,
} from '@kernel/domain/pricing/pricing.config';
import {
  currentFinancialSubscriberSql,
  financialInvoiceProofCtes,
} from './financial-invoice-proof';

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
    countConvertedAccountsCreatedInWindow(periodStart, periodEnd),
    DB_CLIENT.use.user.count({
      where: { createdAt: { gte: prevPeriodStart, lt: prevPeriodEnd } },
    }),
    DB_CLIENT.use.stylistAccount.count({
      where: { created_at: { gte: prevPeriodStart, lt: prevPeriodEnd } },
    }),
    countConvertedAccountsCreatedInWindow(prevPeriodStart, prevPeriodEnd),
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

const countConvertedAccountsCreatedInWindow = async (
  windowStart: Date,
  windowEnd: Date
): Promise<number> => {
  // Cohort stays "account created in the window". The sale must already be on
  // the ledger before the window closes; a later invoice does not rewrite it.
  const rows = await DB_CLIENT.use.$queryRaw<[{ count: bigint }]>(Prisma.sql`
    WITH ${financialInvoiceProofCtes(windowEnd)}
    SELECT COUNT(*)::bigint AS count
    FROM "StylistAccount" sa
    WHERE sa.created_at >= ${windowStart}
      AND sa.created_at < ${windowEnd}
      AND EXISTS (
        SELECT 1
        FROM fin_positive_accounts positive
        WHERE positive.account_id = sa.account_id
      )
  `);
  return Number(rows[0]?.count ?? 0);
};

export const queryRevenueMetrics = async (): Promise<
  Array<{ pricing_plan: PricingPlan; _count: { _all: number } }>
> => {
  const asOf = new Date();
  // FREE stays a census of active free accounts (it is not a sale). Every paid
  // bucket is a current financial subscriber, so trial, zero-invoice, canceled,
  // and admin-grant rows are excluded from paid subscription counts.
  const rows = await DB_CLIENT.use.$queryRaw<
    Array<{ pricing_plan: PricingPlan; count: bigint }>
  >(Prisma.sql`
    WITH ${financialInvoiceProofCtes(asOf)}
    SELECT sa.pricing_plan::text AS pricing_plan, COUNT(*)::bigint AS count
    FROM "StylistAccount" sa
    WHERE sa.account_status::text = ${AccountStatusValue.ACTIVE}
      AND (
        sa.pricing_plan::text = ${PricingPlanValue.FREE}
        OR (
          sa.pricing_plan::text <> ${PricingPlanValue.FREE}
          AND ${currentFinancialSubscriberSql}
        )
      )
    GROUP BY sa.pricing_plan
  `);
  return rows.map(row => ({
    pricing_plan: row.pricing_plan,
    _count: { _all: Number(row.count) },
  }));
};

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
    // Sorts on the denormalized cached_gallery_count (kept by the gallery create/delete and
    // moderation-delete paths) instead of a _count subquery.
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
      // DECISION: deletions in the period = User.deleted_at in the window, NOT DeletedUser rows. The
      // archive's created_at is the backup or 90-day MOVE time, so a backlog flush read as thousands
      // of deletions. Soft-delete keeps the user row for 90 days, so 7/30/90d windows still see them.
      DB_CLIENT.use.user.count({
        where: { deleted_at: { gte: periodStart, lt: periodEnd } },
      }),
      DB_CLIENT.use.user.count({
        where: { deleted_at: { gte: prevPeriodStart, lt: prevPeriodEnd } },
      }),
    ]);
  return { disabledCurrent, disabledPrev, deletedCurrent, deletedPrev };
};

export const processPlanCounts = (
  revenueByPlan: Array<{ pricing_plan: PricingPlan; _count: { _all: number } }>
): Record<PricingPlan, number> => {
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
  return revenueCounts;
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
