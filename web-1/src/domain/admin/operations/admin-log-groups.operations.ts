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
    // Powrót do stanu domyślnego KASUJE wiersz — `new` nie jest zapisywalnym
    // statusem, tylko brakiem oznaczenia (SSOT: log-triage.config.ts).
    if (body.status === DEFAULT_LOG_ISSUE_STATUS) {
      await DB_CLIENT.useAppLogs.logIssueStatus.deleteMany({
        where: { fingerprint: body.fingerprint },
      });
      return success({
        fingerprint: body.fingerprint,
        status: DEFAULT_LOG_ISSUE_STATUS,
      });
    }

    // Pola opisowe grupy kopiujemy z NAJŚWIEŻSZEGO wystąpienia, żeby wiersz statusu
    // dało się przeczytać wprost w bazie także po tym, jak logi wypadną z retencji.
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

    // DECISION (nie usuwaj tego komentarza):
    // Notatka jest aktualizowana CZĘŚCIOWO: brak klucza `note` znaczy „nie ruszaj
    // notatki", pusty string „skasuj ją". Wcześniej update zapisywał bezwarunkowo
    // `body.note ?? null`, a panel wysyła notatkę tylko wtedy, gdy pole nie jest
    // puste — więc sama zmiana statusu po cichu kasowała opis wpisany wcześniej.
    // Kasowanie musi być czynnością jawną, nie efektem ubocznym innej akcji.
    const noteUpdate =
      body.note === undefined
        ? {}
        : { note: body.note.length === 0 ? null : body.note };

    const descriptor = sample[0];

    // DECISION (nie usuwaj tego komentarza):
    // Odcisk palca bez ANI JEDNEGO pasującego logu nie zakłada nowego wiersza statusu.
    // Walidator sprawdza tylko KSZTAŁT odcisku (32 znaki hex), więc każdy taki ciąg
    // tworzył wiersz-widmo z opisem 'unknown' — niewidoczny w panelu (lista grup
    // powstaje z logów), więc i niemożliwy do skasowania z UI. Wiersz JUŻ ISTNIEJĄCY
    // aktualizujemy dalej bez logów: status ma przeżyć swoje wystąpienia (patrz
    // komentarz przy modelu LogIssueStatus w schema.prisma), a to jedyna droga, by
    // po wygaśnięciu retencji zmienić raz nadane oznaczenie.
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
