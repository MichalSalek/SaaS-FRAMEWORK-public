import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type {
  ContentReportReason,
  ContentReportStatus,
} from '@kernel/models/moderation/moderation.dto';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';

// ── Get Content Reports (Admin) ──

type GetContentReportsParams = {
  status?: ContentReportStatus | undefined;
  page?: number | undefined;
  limit?: number | undefined;
};

export const getContentReports_IO = async ({
  currentUser,
  params,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  params: GetContentReportsParams;
}): Promise<
  OperationResult<
    {
      reports: Array<{
        id: string;
        gallery_record_id: string | null;
        reporter_id: string;
        reason: ContentReportReason;
        description: string | null;
        status: ContentReportStatus;
        admin_note: string | null;
        created_at: Date;
        resolved_at: Date | null;
        gallery_record: {
          asset_url: string;
          created_by_account_id: string;
          gallery_record_owner_user_id: string | null;
          owner_active_strikes: number;
        } | null;
        reporter: {
          email: string;
          name: string;
        } | null;
      }>;
      total_count: number;
    },
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  // Defense in depth: route-level RBAC stays, and the operation checks again
  // on entry (same as admin/operations). The operation does not trust that it
  // was called only from an admin route.
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  // DECISION: page/limit are clamped at the OPERATION boundary, not only at the route, so a caller that
  // bypasses the route's clamp cannot make skip = (page-1)*limit overflow the Postgres bigint OFFSET (unmapped
  // 500). The ceiling 10_000_000 mirrors PAGINATION_CEILING in http/query-params.utils, kept inline instead of
  // importing the HTTP query util into the domain layer. floor() because Prisma skip rejects non-integers.
  // A past-end page yields an empty list (200). Number.isFinite comes FIRST (like clampInt there): `??` only
  // catches null/undefined, so NaN/Infinity would otherwise reach skip:NaN (Prisma DATABASE_ERROR). Non-finite
  // values collapse to the default (page 1 / limit 20).
  const PAGE_CEILING = 10_000_000;
  const clampPaging = (value: number, fallback: number, max: number): number =>
    Number.isFinite(value)
      ? Math.floor(Math.min(Math.max(value, 1), max))
      : fallback;
  const page = clampPaging(params.page ?? 1, 1, PAGE_CEILING);
  const limit = clampPaging(params.limit ?? 20, 20, 100);
  const skip = (page - 1) * limit;

  try {
    const where = params.status ? { status: params.status } : {};

    const [reports, total_count] = await DB_CLIENT.use.$transaction([
      DB_CLIENT.use.contentReport.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
        include: {
          gallery_record: {
            select: {
              asset_url: true,
              created_by_account_id: true,
              created_by_account: {
                select: {
                  created_by_user_id: true,
                },
              },
            },
          },
        },
      }),
      DB_CLIENT.use.contentReport.count({ where }),
    ]);

    // DECISION: the reporter is fetched with a SEPARATE query, not a relation. `reporter_id` is a soft FK (see
    // the note on the model in schema.prisma): a hard cascade deleted reports together with the reporter's
    // account, including PENDING ones about content that stayed live, so the queue silently lost cases. The row
    // now outlives its author, so the read must show a report without one (the DTO allows `reporter: null`; the
    // panel renders "N/A"). One query per result page (`in` over the filtered ids), constant cost.
    const reporterIds = [...new Set(reports.map(r => r.reporter_id))];
    const reporters = reporterIds.length
      ? await DB_CLIENT.use.user.findMany({
          where: { id: { in: reporterIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const reporterById = new Map(
      reporters.map(u => [u.id, { email: u.email, name: u.name }])
    );

    // DECISION: Prisma $Enums.ContentReportReason/Status are structurally identical to the DTO unions
    // (re-exported from the generated DTO), so no `as` casts. The mapping exists only to flatten
    // gallery_record (nested created_by_user_id); reason/status pass through 1:1.
    // Owner ACTIVE strikes for this page of reports — one grouped query over
    // the rolling window (expires_at > now), parity with
    // applyModerationStrike_IO response semantics. The monotonic
    // User.moderation_strikes counter is NOT used here: it never decays, while
    // moderation decisions (ban threshold) are made on ACTIVE strikes.
    const now = new Date();
    const ownerIds = [
      ...new Set(
        reports
          .map(r => r.gallery_record?.created_by_account?.created_by_user_id)
          .filter((id): id is string => id != null)
      ),
    ];
    const strikeGroups =
      ownerIds.length > 0
        ? await DB_CLIENT.use.moderationStrike.groupBy({
            by: ['user_id'],
            where: { user_id: { in: ownerIds }, expires_at: { gt: now } },
            _count: { _all: true },
          })
        : [];
    const strikesByOwner = new Map(
      strikeGroups.map(g => [g.user_id, g._count._all])
    );

    // DECISION: explicit field pick instead of `const { gallery_record, ...rest } = r; return { ...rest }`.
    // `...rest` spread every remaining ContentReport scalar, including `resolved_by_id` (the soft-FK audit
    // column), into each response item although the DTO ADMIN_GET_CONTENT_REPORTS.RESPONSE.reports[] does not
    // declare it (the moderator's internal id leaked). TS allows excess props from a spread, and the handler
    // lacked the <TRes> brand. The pick is 1:1 with the DTO, and the handler now carries the
    // <REQUEST, RESPONSE> brand so the compiler catches future drift (audit:dto checks registry key parity, not
    // runtime shape).
    const mappedReports = reports.map(r => {
      const ownerUserId =
        r.gallery_record?.created_by_account?.created_by_user_id ?? null;
      return {
        id: r.id,
        gallery_record_id: r.gallery_record_id,
        reporter_id: r.reporter_id,
        reason: r.reason,
        description: r.description,
        status: r.status,
        admin_note: r.admin_note,
        created_at: r.created_at,
        resolved_at: r.resolved_at,
        gallery_record: r.gallery_record
          ? {
              asset_url: r.gallery_record.asset_url,
              created_by_account_id: r.gallery_record.created_by_account_id,
              gallery_record_owner_user_id: ownerUserId,
              owner_active_strikes:
                ownerUserId != null
                  ? (strikesByOwner.get(ownerUserId) ?? 0)
                  : 0,
            }
          : null,
        reporter: reporterById.get(r.reporter_id) ?? null,
      };
    });

    return success({ reports: mappedReports, total_count });
  } catch (error) {
    return databaseFailure('getContentReports', error);
  }
};
