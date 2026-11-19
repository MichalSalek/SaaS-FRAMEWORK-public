import { Prisma } from '../../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { AccountType } from '@kernel/models/db_models.generated.dto';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { SystemRoleIdType } from '@kernel/models/db_models.manual.dto';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { CACHE_TTL, QUERY_LIMITS } from '@kernel/domain/admin/admin.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { createCache } from '@app/cache/cache.utils';
import {
  ADMIN_NEW_USERS_WINDOW_DAYS,
  adminNewUsersWindowStartDay,
  utcDayStart,
} from '@kernel/domain/admin/admin-users-url.config';
import {
  financialFunnelCountColumns,
  financialInvoiceProofCtes,
} from './financial-invoice-proof';

type MetricsResponse = ADMIN_DTO_API_V1['ADMIN_GET_METRICS']['RESPONSE'];

// Conversion funnel baseline for the admin dashboard, cached because the dashboard polls and the
// aggregates join across FKs.
const metricsCache = createCache<MetricsResponse>(CACHE_TTL.CONVERSION_FUNNEL);
const METRICS_CACHE_KEY = 'admin_metrics';

/**
 * Single-row aggregate result from the consolidated metrics raw SQL.
 * - Scalar counts are bigint in PostgreSQL (need Number() conversion).
 * - Grouped breakdowns + recent registrations use jsonb_agg → parsed as JS arrays.
 * - jsonb_agg returns null when source set is empty; coalesced to '[]'::jsonb in SQL.
 */
type AdminMetricsRow = {
  total_users: bigint;
  active_users: bigint;
  disabled_users: bigint;
  new_today: bigint;
  new_this_week: bigint;
  new_this_month: bigint;
  active_sessions: bigint;
  gallery_count: bigint;
  by_role: Array<{
    role_id: SystemRoleIdType;
    role_name: string;
    count: number;
  }>;
  by_plan: Array<{ plan: PricingPlan; count: number }>;
  by_account_type: Array<{ type: AccountType; count: number }>;
  // role_id is typed SystemRoleIdType without a runtime check: the FK to Role.id guarantees a
  // known role, and `$queryRaw<[AdminMetricsRow]>` is only a type assertion.
  recent_registrations: Array<{
    id: string;
    email: string;
    name: string;
    created_at: string;
    role_id: SystemRoleIdType;
  }>;
  // Conversion funnel scalars
  funnel_signup_count: bigint;
  funnel_trial_started_count: bigint;
  funnel_trial_to_paid_count: bigint;
  funnel_trial_expired_count: bigint;
  funnel_paid_active_count: bigint;
  funnel_churned_30d_count: bigint;
};

/**
 * Get platform metrics for admin dashboard.
 *
 * DECISION: one raw SQL query with CTEs and jsonb_agg instead of ~13 parallel Prisma round
 * trips. No transaction: a non-atomic snapshot is fine for dashboard analytics, and an
 * interactive transaction would hold a pool connection for a read-only query.
 */
export const adminGetMetrics_IO = async ({
  currentUser,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    MetricsResponse,
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const cached = metricsCache.get(METRICS_CACHE_KEY);
  if (cached) {
    return success(cached);
  }

  try {
    const now = new Date();

    // Date boundaries (UTC midnight)
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    // The same function builds the day the dashboard tile's list starts
    // from (`created_from`), so the list holds exactly the counted accounts.
    const weekStart = utcDayStart(
      adminNewUsersWindowStartDay(now, ADMIN_NEW_USERS_WINDOW_DAYS.week)
    );
    const monthStart = utcDayStart(
      adminNewUsersWindowStartDay(now, ADMIN_NEW_USERS_WINDOW_DAYS.month)
    );
    const recentLimit = QUERY_LIMITS.TOP_ITEMS;

    const rows = await DB_CLIENT.use.$queryRaw<[AdminMetricsRow]>(Prisma.sql`
      WITH ${financialInvoiceProofCtes(now)},
      user_stats AS (
        SELECT
          COUNT(*)::bigint AS total_users,
          COUNT(*) FILTER (WHERE is_active = true)::bigint AS active_users,
          COUNT(*) FILTER (WHERE is_active = false)::bigint AS disabled_users,
          COUNT(*) FILTER (WHERE created_at >= ${todayStart})::bigint AS new_today,
          COUNT(*) FILTER (WHERE created_at >= ${weekStart})::bigint AS new_this_week,
          COUNT(*) FILTER (WHERE created_at >= ${monthStart})::bigint AS new_this_month
        FROM "users"
      ),
      session_stats AS (
        SELECT COUNT(*)::bigint AS active_sessions
        FROM "Session"
        WHERE expires > ${now}
      ),
      gallery_stats AS (
        SELECT COUNT(*)::bigint AS gallery_count
        FROM "GalleryRecord"
      ),
      role_breakdown AS (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'role_id', t.role_id,
              'role_name', t.role_name,
              'count', t.count
            )
          ),
          '[]'::jsonb
        ) AS by_role
        FROM (
          SELECT u.role_id AS role_id,
                 COALESCE(r.name, 'Unknown') AS role_name,
                 COUNT(*)::int AS count
          FROM "users" u
          LEFT JOIN "Role" r ON r.id = u.role_id
          GROUP BY u.role_id, r.name
        ) t
      ),
      plan_breakdown AS (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object('plan', t.plan, 'count', t.count)
          ),
          '[]'::jsonb
        ) AS by_plan
        FROM (
          SELECT pricing_plan::text AS plan, COUNT(*)::int AS count
          FROM "StylistAccount"
          GROUP BY pricing_plan
        ) t
      ),
      account_type_breakdown AS (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object('type', t.type, 'count', t.count)
          ),
          '[]'::jsonb
        ) AS by_account_type
        FROM (
          SELECT account_type::text AS type, COUNT(*)::int AS count
          FROM "users"
          GROUP BY account_type
        ) t
      ),
      recent_users AS (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', t.id,
              'email', t.email,
              'name', t.name,
              -- created_at is TIMESTAMP(3) WITHOUT TZ, stored as UTC by Prisma.
              -- to_char preserves the exact stored value as ISO-8601 string with 'Z' suffix.
              'created_at', to_char(t.created_at,
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'role_id', t.role_id
            )
            ORDER BY t.created_at DESC
          ),
          '[]'::jsonb
        ) AS recent_registrations
        FROM (
          SELECT id, email, name, created_at, role_id
          FROM "users"
          ORDER BY created_at DESC
          LIMIT ${recentLimit}
        ) t
      ),
      -- Conversion funnel (stylists only). Paid steps read fin_* invoice proof,
      -- not payment_status: a card-required trial is stored as PAID without a sale.
      conversion_funnel_stats AS (
        SELECT
          ${financialFunnelCountColumns(now)},
          -- CHURN-QUERY (FAZA C): churn = Stripe subscription_status=CANCELED + current_period_end w oknie 30d.
          -- Wczesniej account_expiration_date (admin-estymata now+30d, nie Stripe) + account_status=NOT_ACTIVE
          -- ktore subscription-deleted resetuje do ACTIVE+FREE => praktycznie nigdy nie matchowal. current_period_end = Stripe SSOT.
          COUNT(*) FILTER (
            WHERE sa.subscription_status = 'CANCELED'
              AND sa.current_period_end IS NOT NULL
              AND sa.current_period_end >= ${monthStart}
              AND sa.current_period_end < ${now}
          )::bigint AS funnel_churned_30d_count
        FROM "StylistAccount" sa
      )
      SELECT
        us.total_users,
        us.active_users,
        us.disabled_users,
        us.new_today,
        us.new_this_week,
        us.new_this_month,
        ss.active_sessions,
        gs.gallery_count,
        rb.by_role,
        pb.by_plan,
        atb.by_account_type,
        ru.recent_registrations,
        cfs.funnel_signup_count,
        cfs.funnel_trial_started_count,
        cfs.funnel_trial_to_paid_count,
        cfs.funnel_trial_expired_count,
        cfs.funnel_paid_active_count,
        cfs.funnel_churned_30d_count
      FROM user_stats us,
           session_stats ss,
           gallery_stats gs,
           role_breakdown rb,
           plan_breakdown pb,
           account_type_breakdown atb,
           recent_users ru,
           conversion_funnel_stats cfs
    `);

    const row = rows[0];

    // Conversion funnel math — guard against division by zero
    const trialStarted = Number(row.funnel_trial_started_count);
    const trialToPaid = Number(row.funnel_trial_to_paid_count);
    const paidActive = Number(row.funnel_paid_active_count);
    const churned30d = Number(row.funnel_churned_30d_count);

    const conversionRatePct =
      trialStarted > 0
        ? Math.round((trialToPaid / trialStarted) * 1000) / 10
        : 0;

    const churnRate30dPct =
      paidActive > 0 ? Math.round((churned30d / paidActive) * 1000) / 10 : 0;

    const response: MetricsResponse = {
      users: {
        total: Number(row.total_users),
        active: Number(row.active_users),
        disabled: Number(row.disabled_users),
        newToday: Number(row.new_today),
        newThisWeek: Number(row.new_this_week),
        newThisMonth: Number(row.new_this_month),
        byRole: row.by_role,
        byPlan: row.by_plan,
        byAccountType: row.by_account_type,
      },
      sessions: {
        activeSessions: Number(row.active_sessions),
      },
      gallery: {
        totalRecords: Number(row.gallery_count),
      },
      recentRegistrations: row.recent_registrations,
      conversion_funnel: {
        signup_count: Number(row.funnel_signup_count),
        trial_started_count: trialStarted,
        trial_to_paid_count: trialToPaid,
        trial_expired_count: Number(row.funnel_trial_expired_count),
        paid_active_count: paidActive,
        conversion_rate_pct: conversionRatePct,
        churn_rate_30d_pct: churnRate30dPct,
      },
    };

    metricsCache.set(METRICS_CACHE_KEY, response);
    return success(response);
  } catch (error) {
    return databaseFailure('adminGetMetrics', error);
  }
};
