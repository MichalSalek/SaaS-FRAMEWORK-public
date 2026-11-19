import { Prisma } from '../../../prisma-app-logs/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { LogIssueGroup } from '@kernel/models/admin/admin-logs.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type {
  AdminInsufficientPermissionsError,
  AdminTargetNotFoundError,
} from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { DEFAULT_LOG_ISSUE_STATUS } from '@kernel/domain/admin/log-triage.config';
import {
  NORMALIZED_MESSAGE_SQL,
  buildLogGroupsCountQuery,
  buildLogGroupsListQuery,
  resolveLogGroupStatus,
  resolveLogGroupsScope,
  type LogGroupRow,
} from './admin-log-groups.query';

type GroupsRequest = ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['REQUEST'];
type GroupsResponse = ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['RESPONSE'];
type SetStatusRequest =
  ADMIN_DTO_API_V1['ADMIN_SET_LOG_ISSUE_STATUS']['REQUEST'];
type SetStatusResponse =
  ADMIN_DTO_API_V1['ADMIN_SET_LOG_ISSUE_STATUS']['RESPONSE'];

type OpenLogGroupsRow = { open_groups: number | bigint };

/**
 * The admin menu badge `log_issues_open`: error-log groups that are WAITING
 * for the admin. Scope and statuses are the kernel's (LOG_ATTENTION_SCOPE,
 * LOG_ISSUE_ATTENTION_STATUSES): never triaged, or `fixed` and seen again
 * after the mark. `known` and `ignored` are acknowledged decisions, so they
 * do not light the badge; they stay visible in the log panel.
 *
 * It is `count(*)` over the SAME relation adminGetLogGroups_IO lists with
 * `attention: true` (see buildLogGroupsRelation), so the badge equals
 * `totalGroups` of the list it links to.
 */
export const countUnsettledProductionErrorGroups =
  async (): Promise<number> => {
    const rows = await DB_CLIENT.useAppLogs.$queryRaw<OpenLogGroupsRow[]>(
      buildLogGroupsCountQuery(
        resolveLogGroupsScope({ attention: true }, new Date())
      )
    );
    const raw = rows[0]?.open_groups;
    if (typeof raw === 'bigint') {
      return Number(raw);
    }
    if (typeof raw === 'number') {
      return raw;
    }
    return 0;
  };

export const adminGetLogGroups_IO = async ({
  body,
  currentUser,
}: {
  body: GroupsRequest;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    GroupsResponse,
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const rows = await DB_CLIENT.useAppLogs.$queryRaw<LogGroupRow[]>(
      buildLogGroupsListQuery(resolveLogGroupsScope(body, new Date()))
    );

    const groups: LogIssueGroup[] = rows.map(row => ({
      fingerprint: row.fingerprint,
      application: row.application,
      type: row.type,
      namespace: row.namespace,
      sample_message: row.sample_message,
      sample_id: String(row.sample_id),
      count: Number(row.count),
      first_seen: row.first_seen.toISOString(),
      last_seen: row.last_seen.toISOString(),
      status: resolveLogGroupStatus(row),
      note: row.note,
      status_updated_at: row.status_updated_at
        ? row.status_updated_at.toISOString()
        : null,
    }));

    return success({
      groups,
      totalGroups: Number(rows[0]?.total_groups ?? 0),
    });
  } catch (error) {
    return databaseFailure('adminGetLogGroups', error);
  }
};

export const adminSetLogIssueStatus_IO = async ({
  body,
  currentUser,
}: {
  body: SetStatusRequest;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    SetStatusResponse,
    AdminInsufficientPermissionsError | AdminTargetNotFoundError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    // Returning to the default state DELETES the row: `new` is not a writable status but the
    // absence of a mark (SSOT: log-triage.config.ts).
    if (body.status === DEFAULT_LOG_ISSUE_STATUS) {
      await DB_CLIENT.useAppLogs.logIssueStatus.deleteMany({
        where: { fingerprint: body.fingerprint },
      });
      return success({
        fingerprint: body.fingerprint,
        status: DEFAULT_LOG_ISSUE_STATUS,
      });
    }

    // The group's descriptive fields are copied from the NEWEST occurrence, so the status row
    // stays readable in the database even after the logs fall out of retention.
    const sample = await DB_CLIENT.useAppLogs.$queryRaw<
      Array<{
        application: string;
        type: string;
        namespace: string;
        message: string;
      }>
    >(Prisma.sql`
      SELECT application, type, namespace, message
      FROM "AppLogRecord"
      WHERE md5(
        application || '|' || type || '|' || namespace || '|' || ${NORMALIZED_MESSAGE_SQL}
      ) = ${body.fingerprint}
      ORDER BY id DESC
      LIMIT 1
    `);

    // DECISION: the note is updated partially: a missing `note` key means "keep it", an empty
    // string means "delete it". The panel sends the note only when the field is non-empty, so an
    // unconditional `body.note ?? null` silently erased it on every status change.
    const noteUpdate =
      body.note === undefined
        ? {}
        : { note: body.note.length === 0 ? null : body.note };

    const descriptor = sample[0];

    // DECISION: a fingerprint with no matching log never creates a status row. The validator
    // checks only the shape (32 hex chars), so any string made an invisible 'unknown' ghost row.
    // An EXISTING row is still updated without logs: the status outlives its occurrences, and
    // this is the only way to change it after retention.
    if (!descriptor) {
      const updated = await DB_CLIENT.useAppLogs.logIssueStatus.updateMany({
        where: { fingerprint: body.fingerprint },
        data: {
          status: body.status,
          ...noteUpdate,
          updated_by: currentUser?.id ?? null,
        },
      });
      if (updated.count === 0) {
        return failure({
          type: 'ADMIN_TARGET_NOT_FOUND',
          targetId: body.fingerprint,
          targetType: 'RECORD',
        });
      }
      return success({ fingerprint: body.fingerprint, status: body.status });
    }

    await DB_CLIENT.useAppLogs.logIssueStatus.upsert({
      where: { fingerprint: body.fingerprint },
      create: {
        fingerprint: body.fingerprint,
        status: body.status,
        note: body.note ?? null,
        application: descriptor.application,
        type: descriptor.type,
        namespace: descriptor.namespace,
        message: descriptor.message,
        updated_by: currentUser?.id ?? null,
      },
      update: {
        status: body.status,
        ...noteUpdate,
        updated_by: currentUser?.id ?? null,
      },
    });

    return success({ fingerprint: body.fingerprint, status: body.status });
  } catch (error) {
    return databaseFailure('adminSetLogIssueStatus', error);
  }
};
