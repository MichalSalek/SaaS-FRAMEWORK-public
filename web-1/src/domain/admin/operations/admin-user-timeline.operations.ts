import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type {
  ADMIN_DTO_API_V1,
  UserTimelineEntry,
} from '@kernel/models/admin/admin.dto';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { sanitizePagination } from '@domain/admin/admin.utils.api';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { getEventDescription } from '@kernel/domain/event-log/event-log-descriptions.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isEventLogTypeNarrower } from '@kernel/models/type_narrowing';
import type { Prisma } from '../../../prisma/js-client';

type TimelineRequest = ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['REQUEST'];
type TimelineResponse = ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['RESPONSE'];

type TimelineError =
  AdminInsufficientPermissionsError | DatabaseError | ValidationError;

/**
 * Narrow a Prisma `Json?` value to the `details` contract (`Record<string, unknown> | null`).
 * `event_payload` is a `JsonValue`, so it can be a primitive, array, or null — only a
 * plain JSON object is a valid timeline `details`. A bare `as Record<...>` would lie for
 * those shapes; here a non-object payload degrades to `null` instead.
 */
const toDetailsRecord = (
  payload: Prisma.JsonValue
): Record<string, unknown> | null => {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload)
  ) {
    return payload;
  }
  return null;
};

/**
 * Get paginated user timeline (activity log) from EventLog database.
 * Queries all event types for a specific user, ordered by most recent first.
 * Admin-only endpoint.
 */
export const adminGetUserTimeline_IO = async ({
  currentUser,
  params,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  params: TimelineRequest;
}): Promise<OperationResult<TimelineResponse, TimelineError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  // user_id is required; empty/whitespace gets rejected as validation error
  if (!params.user_id || params.user_id.trim().length === 0) {
    return failure({
      type: 'VALIDATION_ERROR' as const,
      field: 'user_id',
      message: 'user_id is required',
    });
  }

  try {
    // Sanitize pagination params
    const { page, limit, skip } = sanitizePagination(params, 50);

    // Query main DB EventLog — that's where user-attributed business events live
    // (via recordAuditEvent_IO). Event Log Store / Neon holds error/debug logs with
    // user_id=null, which would never match a user-timeline filter.
    const where: Prisma.EventLogWhereInput = {
      created_by_user_id: params.user_id,
    };

    if (params.event_type && params.event_type.trim().length > 0) {
      const trimmed = params.event_type.trim();
      // DECISION (nie usuwaj tego komentarza):
      // event_type to opcjonalny filtr — jesli nie pasuje do EventLogType,
      // pomijamy filtr zamiast zwracac validation failure (degraded UX > 400).
      if (isEventLogTypeNarrower(trimmed)) {
        where.event_type = trimmed;
      }
    }

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
        },
      }),
      DB_CLIENT.use.eventLog.count({ where }),
    ]);

    const timelineEntries: UserTimelineEntry[] = entries.map(e => ({
      id: e.event_log_id,
      created_at:
        e.created_at instanceof Date
          ? e.created_at.toISOString()
          : String(e.created_at),
      event_name: e.event,
      event_type: e.event_type,
      description_pl: getEventDescription(e.event),
      // Main DB EventLog has no namespace column — derive from event prefix
      // (e.g. GALLERY_RECORD_CREATED → GALLERY)
      namespace: e.event.split('_')[0] ?? '',
      details: toDetailsRecord(e.event_payload),
    }));

    return success({
      entries: timelineEntries,
      total,
      page,
      limit,
    });
  } catch (error) {
    return databaseFailure('adminGetUserTimeline', error);
  }
};
