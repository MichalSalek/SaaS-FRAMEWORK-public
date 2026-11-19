import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';

type RawAuditArgs = Parameters<typeof writeRawEventLog_IO>[0];

/**
 * DRY helper for ADMIN-category audit writes in admin user-management ops.
 *
 * Every admin user mutation (delete / disable / enable / change-plan) emits the
 * same envelope: eventLogType = ADMIN, meta keyed by the acting admin's id, only
 * the eventName + payload differ. Extracted to a single call-site to keep
 * admin-user-management.operations.ts under the max-lines budget and to make the
 * audit shape a single point of change.
 */
export const emitAdminUserAudit = (
  eventName: RawAuditArgs['eventName'],
  createdByUserId: string,
  eventPayloadToStringify: NonNullable<RawAuditArgs['eventPayloadToStringify']>
): ReturnType<typeof writeRawEventLog_IO> =>
  writeRawEventLog_IO({
    eventName,
    eventLogType: EventLogTypeValue.ADMIN,
    meta: { created_by_user_id: createdByUserId },
    eventPayloadToStringify,
  });
