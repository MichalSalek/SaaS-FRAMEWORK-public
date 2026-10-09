import { DB_CLIENT } from '@app/db/db.client';
import { escapeLikePattern } from '@app/db/like-escape';
import type { Prisma } from '../../../prisma/js-client';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type {
  ADMIN_DTO_API_V1,
  AuditTrailEntry,
} from '@kernel/models/admin/admin.dto';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { sanitizePagination } from '@domain/admin/admin.utils.api';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { cleanAdminFilter } from './admin-filter-sanitize.helper';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';

type AuditTrailRequest = ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['REQUEST'];
type AuditTrailResponse = ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['RESPONSE'];

type AuditTrailError = AdminInsufficientPermissionsError | DatabaseError;

/**
 * Parse target information from EventLog event_payload JSON.
 * Extracts a meaningful target identifier (user id / email) from the payload.
 * Returns null when the payload carries no standard target field —
 * an honest "no target info" rather than low-signal noise.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Świadomie NIE fallbackujemy na metadane (np. client_ip). IP nie jest
 * znaczącym "target" w audit trail, a wstrzykiwanie go tutaj produkuje mylący
 * `target_info: 'IP: ...'` i łamie minimalizację PII opisaną w
 * admin-impersonation.operations.ts (DECISION przy writeRawEventLog_IO).
 */
const parseTargetFromPayload = (
  payload: Prisma.JsonValue | null
): string | null => {
  if (
    payload != null &&
    typeof payload === 'object' &&
    !Array.isArray(payload)
  ) {
    const obj = payload;
    // Look for common target identifiers in payload.
    // target_id / target_ids = dominujący kształt payloadów admin eventów
    // (admin-user-management, admin-impersonation, admin-bulk).
    if (typeof obj.target_id === 'string') {
      return `User ${obj.target_id}`;
    }
    if (
      Array.isArray(obj.target_ids) &&
      obj.target_ids.every(id => typeof id === 'string')
    ) {
      return `Users ${obj.target_ids.join(', ')}`;
    }
    if (typeof obj.targetUserId === 'string') {
      return `User ${obj.targetUserId}`;
    }
    if (typeof obj.targetEmail === 'string') {
      return obj.targetEmail;
    }
    if (typeof obj.userId === 'string') {
      return `User ${obj.userId}`;
    }
    if (typeof obj.id === 'string') {
      return `ID ${obj.id}`;
    }
    if (typeof obj.email === 'string') {
      return obj.email;
    }
  }

  return null;
};

/**
 * Get paginated audit trail entries from main-DB EventLog
 * (event_type = 'ADMIN' — real admin audit events via writeRawEventLog_IO).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Źródłem JEST main-DB EventLog, NIE app-logs AppLogRecord. AppLogRecord.type
 * przyjmuje wyłącznie 'info'|'warn'|'error' (SEND_LOG_TYPES; error-handler
 * hardcoduje type=data.mode) — filtr type='ADMIN' na app-logs zwracał ZAWSZE
 * pusty wynik. Admin audit events lądują w EventLog z event_type='ADMIN'
 * (indeks [event_type, created_at desc] istnieje).
 *
 * Enrichment: User from main DB, batch fetch for N+1 prevention.
 */
export const adminGetAuditTrail_IO = async ({
  currentUser,
  params,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  params: AuditTrailRequest;
}): Promise<OperationResult<AuditTrailResponse, AuditTrailError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    // Sanitize pagination params
    const { page, limit, skip } = sanitizePagination(params, 20);

    // Build where clause: always filter by ADMIN event type
    const where: Prisma.EventLogWhereInput = {
      event_type: EventLogTypeValue.ADMIN,
    };

    // Optional substring filter by event name (case-insensitive contains —
    // exact-equality wymagałaby od admina pełnej, dokładnej nazwy eventu).
    // DECISION (nie usuwaj tego komentarza):
    // cleanAdminFilter strips NUL (U+0000) + trims -> null gdy puste. NUL w
    // event_name NIE moze trafic do Prisma where (Postgres text odrzuca NUL ->
    // niezmapowany 500); malformowany filtr degraduje do braku filtra. Lustro
    // hardeningu kursora event-loga (event-log.client.ts isValidCursorFormat).
    const eventNameFilter = cleanAdminFilter(params.event_name);
    if (eventNameFilter !== null) {
      // Escape LIKE metacharacters (%, _, \) — an unescaped trailing `\` would crash the
      // ILIKE query (unmapped 500); `%`/`_` would act as wildcards. See like-escape.ts.
      where.event = {
        contains: escapeLikePattern(eventNameFilter),
        mode: 'insensitive',
      };
    }

    // Parallel: fetch entries + count
    const [entries, total] = await Promise.all([
      DB_CLIENT.use.eventLog.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { event_log_id: 'desc' }],
        skip,
        take: limit,
        select: {
          event_log_id: true,
          created_at: true,
          event: true,
          event_type: true,
          event_payload: true,
          created_by_user_id: true,
        },
      }),
      DB_CLIENT.use.eventLog.count({ where }),
    ]);

    // Batch enrichment: collect unique admin user ids, fetch from User table
    const userIds = [...new Set(entries.map(e => e.created_by_user_id))];

    const users =
      userIds.length > 0
        ? await DB_CLIENT.use.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, name: true },
            // Safety net: at most one row per unique userId from this page of entries.
            // sanitizePagination caps entries at limit rows, so userIds.length ≤ limit.
            take: userIds.length,
          })
        : [];

    const userMap = new Map(users.map(u => [u.id, u]));

    // Map to response DTO
    const auditEntries: AuditTrailEntry[] = entries.map(e => {
      const user = userMap.get(e.created_by_user_id);
      return {
        id: e.event_log_id,
        created_at:
          e.created_at instanceof Date
            ? e.created_at.toISOString()
            : String(e.created_at),
        event_name: e.event,
        admin_user_id: e.created_by_user_id,
        admin_email: user?.email ?? null,
        admin_name: user?.name ?? null,
        target_info: parseTargetFromPayload(e.event_payload),
        details:
          e.event_payload != null ? JSON.stringify(e.event_payload) : e.event,
        namespace: e.event_type,
      };
    });

    return success({
      entries: auditEntries,
      total,
      page,
      limit,
    });
  } catch (error) {
    return databaseFailure('adminGetAuditTrail', error);
  }
};
