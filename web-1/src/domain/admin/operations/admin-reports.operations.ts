import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type {
  ADMIN_DTO_API_V1,
  MetricWithChange,
} from '@kernel/models/admin/admin.dto';
import { REPORT_PERIODS } from '@kernel/domain/admin/reports.config';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { createCache } from '@app/cache/cache.utils';
import { CACHE_TTL } from '@kernel/domain/admin/admin.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { fetchPricingPlans } from '@app/stripe/pricing.operations';
import {
  calculatePeriodBoundaries,
  processGrowthData,
  processRevenueBreakdown,
  processTopStylists,
  queryChurnMetrics,
  queryFunnelMetrics,
  queryGrowthMetrics,
  queryRetentionMetrics,
  queryRevenueMetrics,
  queryTopStylists,
} from './admin-reports.helpers';

type ReportsRequest = ADMIN_DTO_API_V1['ADMIN_GET_REPORTS']['REQUEST'];
type ReportsResponse = ADMIN_DTO_API_V1['ADMIN_GET_REPORTS']['RESPONSE'];

type ReportsError = AdminInsufficientPermissionsError | DatabaseError;

const reportsCache = createCache<ReportsResponse>(CACHE_TTL.REPORTS);

const makeMetricWithChange = (
  current: number,
  previous: number
): MetricWithChange => ({
  current,
  previous,
  change_percent:
    previous === 0 ? null : Math.round(((current - previous) / previous) * 100),
});

export const adminGetReports_IO = async ({
  currentUser,
  params,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  params: ReportsRequest;
}): Promise<OperationResult<ReportsResponse, ReportsError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const { period } = params;

    const cacheKey = `reports_${period}`;
    const cached = reportsCache.get(cacheKey);
    if (cached) {
      return success(cached);
    }

    const periodDays = REPORT_PERIODS[period].days;
    const {
      periodStart,
      periodEnd,
      prevPeriodStart,
      prevPeriodEnd,
      sevenDaysAgo,
      thirtyDaysAgo,
    } = calculatePeriodBoundaries(periodDays);

    const [
      funnel,
      retention,
      revenueByPlan,
      dailyGrowthRaw,
      topStylistsRaw,
      churn,
      pricingPlans,
    ] = await Promise.all([
      queryFunnelMetrics(
        periodStart,
        periodEnd,
        prevPeriodStart,
        prevPeriodEnd
      ),
      queryRetentionMetrics(sevenDaysAgo, thirtyDaysAgo),
      queryRevenueMetrics(),
      queryGrowthMetrics(periodStart, periodEnd),
      queryTopStylists(),
      queryChurnMetrics(periodStart, periodEnd, prevPeriodStart, prevPeriodEnd),
      // Stripe = SSOT cen (B37). fetchPricingPlans jest cached + fail-safe
      // (zwraca fallback z null cenami, nigdy nie rzuca) → bezpieczne w Promise.all.
      fetchPricingPlans(),
    ]);

    const { revenueCounts, mrrEstimate } = processRevenueBreakdown(
      revenueByPlan,
      pricingPlans.plans
    );
    const growthData = processGrowthData(dailyGrowthRaw);
    const topStylists = processTopStylists(topStylistsRaw);

    const conversionToActive =
      funnel.totalRegsCurrent === 0
        ? 0
        : Math.round(
            (funnel.activeAccountsCurrent / funnel.totalRegsCurrent) * 100
          );
    const conversionToPaid =
      funnel.activeAccountsCurrent === 0
        ? 0
        : Math.round(
            (funnel.paidAccountsCurrent / funnel.activeAccountsCurrent) * 100
          );

    // Cap percentages at 100 — defensive against arithmetic anomalies (e.g.
    // active count exceeding totalUsers if cohort definitions ever drift).
    const retention7d =
      retention.totalUsers === 0
        ? 0
        : Math.min(
            100,
            Math.round((retention.active7d / retention.totalUsers) * 100)
          );
    const retention30d =
      retention.totalUsers === 0
        ? 0
        : Math.min(
            100,
            Math.round((retention.active30d / retention.totalUsers) * 100)
          );

    const response: ReportsResponse = {
      period,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      funnel: {
        total_registrations: makeMetricWithChange(
          funnel.totalRegsCurrent,
          funnel.totalRegsPrev
        ),
        active_accounts: makeMetricWithChange(
          funnel.activeAccountsCurrent,
          funnel.activeAccountsPrev
        ),
        paid_accounts: makeMetricWithChange(
          funnel.paidAccountsCurrent,
          funnel.paidAccountsPrev
        ),
        conversion_to_active_percent: conversionToActive,
        conversion_to_paid_percent: conversionToPaid,
      },
      retention: {
        active_7d: retention.active7d,
        active_30d: retention.active30d,
        total_users: retention.totalUsers,
        retention_7d_percent: retention7d,
        retention_30d_percent: retention30d,
      },
      revenue: {
        users_free: revenueCounts.FREE,
        users_pro: revenueCounts.PRO,
        users_pro_plus: revenueCounts.PRO_PLUS,
        users_studio: revenueCounts.STUDIO,
        users_scale: revenueCounts.SCALE,
        mrr_estimate: mrrEstimate,
      },
      growth: {
        new_users_per_day: growthData,
      },
      top_stylists: topStylists,
      churn: {
        disabled_in_period: makeMetricWithChange(
          churn.disabledCurrent,
          churn.disabledPrev
        ),
        deleted_in_period: makeMetricWithChange(
          churn.deletedCurrent,
          churn.deletedPrev
        ),
      },
      cached_at: new Date().toISOString(),
    };

    reportsCache.set(cacheKey, response);

    return success(response);
  } catch (error) {
    return databaseFailure('adminGetReports', error);
  }
};
