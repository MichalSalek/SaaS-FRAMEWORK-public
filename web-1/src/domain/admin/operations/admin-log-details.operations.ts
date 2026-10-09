import { Prisma } from '../../../prisma-app-logs/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { LogDetailsGroup } from '@kernel/models/admin/admin-logs.dto';
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
import {
  LOG_DETAILS_CHAIN_LIMIT,
  LOG_DETAILS_GROUP_WINDOW_DAYS,
  LOG_DETAILS_RECENT_LIMIT,
} from '@kernel/domain/admin/log-triage.config';
import { TIME } from '@kernel/application/constants.config';
import {
  NORMALIZED_MESSAGE_SQL,
  appLogFingerprintSql,
} from './admin-log-groups.query';
import { logIssueDisplayStatus } from './admin-log-display-status.helper';
import { APP_LOG_SELECT, toEventLogRecord } from './admin-logs.operations';

type DetailsRequest = ADMIN_DTO_API_V1['ADMIN_GET_LOG_DETAILS']['REQUEST'];
type DetailsResponse = ADMIN_DTO_API_V1['ADMIN_GET_LOG_DETAILS']['RESPONSE'];

const CHAIN_SENTINEL = '0';

type GroupSqlRow = {
  fingerprint: string;
  count: bigint | number;
  first_seen: Date | null;
  last_seen: Date | null;
  stored_status: string | null;
  note: string | null;
  status_updated_at: Date | null;
  recent_ids: Array<number | bigint> | null;
};

const toCount = (value: bigint | number): number =>
  typeof value === 'bigint' ? Number(value) : value;

const toIdList = (ids: Array<number | bigint> | null): number[] =>
  (ids ?? []).map(id => (typeof id === 'bigint' ? Number(id) : id));

export const adminGetLogDetails_IO = async ({
  body,
  currentUser,
}: {
  body: DetailsRequest;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    DetailsResponse,
    AdminInsufficientPermissionsError | AdminTargetNotFoundError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  // Upper bound = Postgres int4 (AppLogRecord.id): a larger id cannot exist, and
  // passing it to Prisma failed validation as a 500 instead of a 404 (testy-api s34).
  if (!Number.isInteger(body.id) || body.id < 1 || body.id > 2_147_483_647) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: String(body.id),
      targetType: 'RECORD',
    });
  }

  try {
    const row = await DB_CLIENT.useAppLogs.appLogRecord.findUnique({
      where: { id: body.id },
      select: APP_LOG_SELECT,
    });
    if (!row) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: String(body.id),
        targetType: 'RECORD',
      });
    }

    // The chain around this record: up to half the limit on each side, so a
    // long chain shows what led to the log and what followed it, not just its
    // first events.
    const chainSide = Math.ceil(LOG_DETAILS_CHAIN_LIMIT / 2);
    const chainPromise: Promise<Array<typeof row>> =
      row.event_log_chain_id === CHAIN_SENTINEL
        ? Promise.resolve([])
        : Promise.all([
            DB_CLIENT.useAppLogs.appLogRecord.findMany({
              where: {
                event_log_chain_id: row.event_log_chain_id,
                id: { lt: body.id },
              },
              orderBy: { id: 'desc' },
              take: chainSide,
              select: APP_LOG_SELECT,
            }),
            DB_CLIENT.useAppLogs.appLogRecord.findMany({
              where: {
                event_log_chain_id: row.event_log_chain_id,
                id: { gt: body.id },
              },
              orderBy: { id: 'asc' },
              take: chainSide,
              select: APP_LOG_SELECT,
            }),
          ]).then(([before, after]) => [...before.reverse(), ...after]);

    const groupSince = new Date(
      Date.now() - LOG_DETAILS_GROUP_WINDOW_DAYS * TIME.MS_PER_DAY
    );

    // Fingerprint expression is the groups query's — one source. The peer
    // scan is limited to the same application/type/namespace before the
    // regex runs, so a single namespace does not drag the whole table
    // through md5. Chain lookup uses @@index([event_log_chain_id]) (S122).
    const groupQuery = Prisma.sql`
      WITH target AS (
        SELECT
          ${appLogFingerprintSql(NORMALIZED_MESSAGE_SQL)} AS fingerprint,
          application,
          type,
          namespace
        FROM "AppLogRecord"
        WHERE id = ${body.id}
      ),
      peers AS (
        -- The fingerprint expression uses bare column names, so it must run
        -- where ONLY "AppLogRecord" is in scope; joined to target (which has
        -- the same columns) Postgres rejected it as ambiguous (42702).
        SELECT
          id,
          created_at,
          ${appLogFingerprintSql(NORMALIZED_MESSAGE_SQL)} AS fingerprint
        FROM "AppLogRecord"
        WHERE type = (SELECT type FROM target)
          AND created_at >= ${groupSince}
          AND application = (SELECT application FROM target)
          AND namespace = (SELECT namespace FROM target)
      ),
      matched AS (
        SELECT p.id, p.created_at, p.fingerprint
        FROM peers p
        JOIN target t ON p.fingerprint = t.fingerprint
      )
      SELECT
        t.fingerprint,
        (SELECT count(*)::bigint FROM matched) AS count,
        (SELECT min(created_at) FROM matched) AS first_seen,
        (SELECT max(created_at) FROM matched) AS last_seen,
        s.status AS stored_status,
        s.note,
        s.updated_at AS status_updated_at,
        (
          SELECT COALESCE(array_agg(recent.id), ARRAY[]::int[])
          FROM (
            SELECT id FROM matched ORDER BY id DESC
            LIMIT ${LOG_DETAILS_RECENT_LIMIT}
          ) recent
        ) AS recent_ids
      FROM target t
      LEFT JOIN "LogIssueStatus" s ON s.fingerprint = t.fingerprint
    `;

    const [chainRows, groupRows] = await Promise.all([
      chainPromise,
      DB_CLIENT.useAppLogs.$queryRaw<GroupSqlRow[]>(groupQuery),
    ]);

    const groupRow = groupRows[0];
    let group: LogDetailsGroup | null = null;
    let recent: DetailsResponse['recent'] = [];

    if (
      groupRow !== undefined &&
      groupRow.first_seen !== null &&
      groupRow.last_seen !== null
    ) {
      group = {
        fingerprint: groupRow.fingerprint,
        status: logIssueDisplayStatus({
          storedStatus: groupRow.stored_status,
          statusUpdatedAt: groupRow.status_updated_at,
          lastSeen: groupRow.last_seen,
        }),
        note: groupRow.note,
        count: toCount(groupRow.count),
        first_seen: groupRow.first_seen.toISOString(),
        last_seen: groupRow.last_seen.toISOString(),
      };
      const recentIds = toIdList(groupRow.recent_ids);
      if (recentIds.length > 0) {
        const recentRows = await DB_CLIENT.useAppLogs.appLogRecord.findMany({
          where: { id: { in: recentIds } },
          orderBy: { id: 'desc' },
          select: APP_LOG_SELECT,
        });
        recent = recentRows.map(toEventLogRecord);
      }
    }

    return success({
      record: toEventLogRecord(row),
      chain: chainRows.map(toEventLogRecord),
      group,
      recent,
    });
  } catch (error) {
    return databaseFailure('adminGetLogDetails', error);
  }
};
