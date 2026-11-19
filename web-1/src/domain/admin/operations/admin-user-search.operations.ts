import { DB_CLIENT } from '@app/db/db.client';
import { escapeLikePattern } from '@app/db/like-escape';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import {
  assertType,
  isSystemRoleIdNarrower,
} from '@kernel/models/type_narrowing';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { Prisma } from '../../../prisma/js-client';
import { buildUserAttentionWhere } from './admin-user-attention.predicates';
import { utcDayStart } from '@kernel/domain/admin/admin-users-url.config';
import { ACCOUNT_TYPE_TO_ROLE_ID } from '@kernel/models/db_models.manual.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import type { AdminUserListStats } from '@kernel/models/admin/admin-users.dto';
import { fetchAdminUserListStats } from './admin-user-list-stats';
import type { ContractHandlerResponse } from '@kernel/application/contracts/contract.types';
import type { AdminContracts } from '@kernel/domain/admin/admin.contracts';

// DECISION: the UI filters by AccountType ('STYLIST' | 'CLIENT') but role_id holds SystemRoleId
// ('role_stylist' | 'role_client'); passing the raw value matched zero rows. Convert through the
// kernel SSOT ACCOUNT_TYPE_TO_ROLE_ID (db_models.manual.dto.ts).

type PaginatedUsersRequest =
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['REQUEST'];
type PaginatedUsersResponse = ContractHandlerResponse<
  AdminContracts['ADMIN_GET_USERS_PAGINATED']
>;
type AdminUserListRecord = PaginatedUsersResponse['records'][number];

type AdminUserSearchError = AdminInsufficientPermissionsError | DatabaseError;

type AdminUsersSortBy = NonNullable<PaginatedUsersRequest['sort_by']>;

/**
 * The first `orderBy` key for a `sort_by`; the resolver always appends `id`.
 *
 * DECISION: the API exposes snake_case keys but the Prisma field is `createdAt` (passing the raw
 * key threw "Unknown argument" and a 500), so every key is mapped here. Nullable keys sort nulls
 * LAST in both directions, so people who never signed in or have no city never lead the list.
 * `photos` orders by the stylist account's GalleryRecord count; people without one sort as no works.
 * Exhaustive by type: a new ADMIN_USERS_SORT_BY_VALUES entry does not compile until mapped.
 */
export const buildUsersPrimaryOrder = (
  sortBy: AdminUsersSortBy,
  order: Prisma.SortOrder
): Prisma.UserOrderByWithRelationInput => {
  switch (sortBy) {
    case 'id':
      return { id: order };
    case 'email':
      return { email: order };
    case 'name':
      return { name: order };
    case 'created_at':
      return { createdAt: order };
    case 'last_login_at':
      return { last_login_at: { sort: order, nulls: 'last' } };
    case 'photos':
      return { stylist_account: { gallery_record: { _count: order } } };
    case 'city':
      return {
        stylist_account: { address_city: { sort: order, nulls: 'last' } },
      };
  }
};

const emptyStats = (notificationsEnabled: boolean): AdminUserListStats => ({
  photos: null,
  public_works: null,
  connections: 0,
  inspiration_sessions: 0,
  messages_sent: 0,
  support_threads: 0,
  push_devices: 0,
  city: null,
  team_role: null,
  notifications_enabled: notificationsEnabled,
  email_marketing: null,
});

type ActiveSessionCountRow = { user_id: string; active_sessions: number };

/**
 * Liczba AKTYWNYCH sesji (expires w przyszłości) dla userów Z BIEŻĄCEJ STRONY.
 *
 * DECISION: a relational `_count` on sessions compiles to an uncorrelated aggregate over the whole
 * Session table; the LATERAL correlated to the page ids uses the [userId, expires] index instead.
 * `NOW() AT TIME ZONE 'UTC'`, not a bound JS Date: `expires` is a UTC `timestamp without time zone`
 * and node-pg serializes a Date with the process's local offset, shifting the threshold by hours.
 * A user with no row counts as 0.
 */
const fetchActiveSessionCounts = async (
  userIds: readonly string[]
): Promise<Map<string, number>> => {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await DB_CLIENT.use.$queryRaw<ActiveSessionCountRow[]>(
    Prisma.sql`
      SELECT
        u."id" AS user_id,
        active."active_sessions" AS active_sessions
      FROM "users" u
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS active_sessions
        FROM "Session" s
        WHERE s."user_id" = u."id"
          AND s."expires" > (NOW() AT TIME ZONE 'UTC')
      ) active
      WHERE u."id" IN (${Prisma.join([...userIds])})
    `
  );

  return new Map(rows.map(row => [row.user_id, row.active_sessions] as const));
};

/**
 * Admin paginated user search with filters and sorting.
 */
export const adminGetUsersPaginated_IO = async ({
  currentUser,
  params,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  params: PaginatedUsersRequest;
}): Promise<OperationResult<PaginatedUsersResponse, AdminUserSearchError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const take = Math.min(100, Math.max(1, Number(params.take) || 50));
    const cursor = params.cursor || undefined;

    // DECISION: no isValidCursorFormat cuid gate here, unlike other cursor lists. This cursor anchors
    // on User.id, and Better Auth mints its own ids (e.g. `usr_…` with an underscore) over the Prisma
    // cuid default, so the gate would 400 legitimate pagination. Null bytes are already blocked by the
    // handler-layer guard; a stale cursor yields an empty page. Admin-only endpoint.

    const sortOrder: Prisma.SortOrder =
      params.sort_order === 'asc' ? 'asc' : 'desc';
    const primaryOrder = buildUsersPrimaryOrder(
      params.sort_by ?? 'id',
      sortOrder
    );

    // Build where clause with proper Prisma types
    const where: Prisma.UserWhereInput = {};

    if (params.search && params.search.trim().length > 0) {
      // Escape LIKE metacharacters so `%`/`_` match literally and a trailing `\` cannot 500.
      const searchTerm = escapeLikePattern(params.search.trim());
      // Exact `id` beside email and name: the „Pokaż użytkownika" link from a
      // log (it knows only user_id) hits one row. Equality on the primary key,
      // so there is no scan.
      where.OR = [
        { email: { contains: searchTerm, mode: 'insensitive' } },
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { id: params.search.trim() },
      ];
    }

    if (params.role !== undefined && params.role !== null) {
      where.role_id = ACCOUNT_TYPE_TO_ROLE_ID[params.role];
      // role_client is also the signup default, so "Klientka" must mean a
      // finished client onboarding, the same rule as the row label
      // (onboarding_completed); people who never picked a role stay out.
      if (params.role === AccountTypeValue.CLIENT) {
        where.client_account = { isNot: null };
      }
    }

    if (params.onboarding_pending === true) {
      where.stylist_account = null;
      where.client_account = null;
    }

    // "Needs a reaction" lists behind the admin menu badges. The predicate is
    // the one the badge counts with (admin-user-attention.predicates.ts) and
    // goes into AND, so it narrows every other filter instead of overwriting
    // a key another filter set (both touch `stylist_account`).
    if (params.attention !== undefined) {
      where.AND = [buildUserAttentionWhere(params.attention, new Date())];
    }

    // Same UTC-midnight boundary as the dashboard counter that links here
    // (admin-metrics.operations.ts, adminNewUsersWindowStartDay).
    if (params.created_from !== undefined) {
      where.createdAt = { gte: utcDayStart(params.created_from) };
    }

    if (params.is_active !== undefined && params.is_active !== null) {
      where.is_active = params.is_active;
    }

    const stylistAccountFilter: Prisma.StylistAccountWhereInput = {};
    if (params.account_status) {
      stylistAccountFilter.account_status = params.account_status;
    }
    if (params.payment_status) {
      stylistAccountFilter.payment_status = params.payment_status;
    }
    if (params.pricing_plan) {
      stylistAccountFilter.pricing_plan = params.pricing_plan;
    }
    // A plan/status filter needs a stylist account, which "no role yet"
    // excludes by definition: with the pending filter on, those filters are
    // ignored instead of turning the list into a guaranteed empty result.
    if (
      Object.keys(stylistAccountFilter).length > 0 &&
      params.onboarding_pending !== true
    ) {
      where.stylist_account = stylistAccountFilter;
    }

    // DECISION: userSelect is EXACTLY the AdminUserListRecord projection (kernel
    // admin-users.dto.ts), so no field is declared present and undefined at runtime. trial_started_at
    // and trial_ends_at must stay, or every trialing stylist is labelled "Active". Change one side,
    // align the other.
    const userSelect = {
      id: true,
      email: true,
      emailVerified: true,
      name: true,
      account_type: true,
      role_id: true,
      is_active: true,
      createdAt: true,
      updatedAt: true,
      last_login_at: true,
      notifications_enabled: true,
      stylist_account: {
        select: {
          pricing_plan: true,
          payment_status: true,
          account_status: true,
          trial_started_at: true,
          trial_ends_at: true,
          // Inputs of `stats` only (fetchAdminUserListStats), not projected as is.
          account_id: true,
          address_city: true,
          email_marketing: true,
        },
      },
      client_account: { select: { client_account_id: true } },
      // `_count.sessions` NIE jest tu selektowany — liczba aktywnych sesji przychodzi
      // ze skorelowanego LATERAL-a poniżej (fetchActiveSessionCounts).
    } satisfies Prisma.UserSelect;

    const records = await DB_CLIENT.use.user.findMany({
      select: userSelect,
      where,
      // Cursor field (id) MUST be in orderBy for stable pagination. When sortBy is
      // email/name/created_at those columns are non-unique → cursor+skip would skip/dup
      // rows. Appending `id` as a deterministic tiebreaker keeps the cursor stable
      // regardless of sortBy (when sortBy === 'id' the second key is a harmless no-op).
      // The aggregate and nullable keys keep it too: measured on the dev DB
      // (407 users, pages of 4) a walk equals the unpaged order for every key.
      orderBy: [primaryOrder, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > take;
    const items = hasMore ? records.slice(0, take) : records;

    const [activeSessionsByUserId, statsByUserId] = await Promise.all([
      fetchActiveSessionCounts(items.map(row => row.id)),
      fetchAdminUserListStats(items),
    ]);

    // DECISION: built field by field from the select above, never a double cast of the full model
    // (that declared fields runtime left undefined). Only role_id needs narrowing (Prisma string vs
    // SystemRoleIdType); the rest is assignable as is.
    const usersCollection: AdminUserListRecord[] = items.map(row => ({
      id: row.id,
      email: row.email,
      emailVerified: row.emailVerified,
      name: row.name,
      account_type: row.account_type,
      role_id: assertType(
        row.role_id,
        isSystemRoleIdNarrower,
        'role_id in adminGetUsersPaginated'
      ),
      is_active: row.is_active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      last_login_at: row.last_login_at,
      stats: statsByUserId.get(row.id) ?? emptyStats(row.notifications_enabled),
      stylist_account: row.stylist_account
        ? {
            pricing_plan: row.stylist_account.pricing_plan,
            payment_status: row.stylist_account.payment_status,
            account_status: row.stylist_account.account_status,
            trial_started_at: row.stylist_account.trial_started_at,
            trial_ends_at: row.stylist_account.trial_ends_at,
          }
        : null,
      onboarding_completed:
        row.stylist_account !== null || row.client_account !== null,
      _count: { sessions: activeSessionsByUserId.get(row.id) ?? 0 },
    }));

    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    reportIssueBackend({
      namespace: 'adminGetUsersPaginated',
      message: `Fetched ${usersCollection.length} users (cursor: ${cursor ?? 'start'}, hasMore: ${hasMore})`,
      payload: { count: usersCollection.length, hasMore, cursor },
      mode: 'info',
    });

    return success({
      records: usersCollection,
      nextCursor,
    });
  } catch (error) {
    return databaseFailure('adminGetUsersPaginated', error);
  }
};
