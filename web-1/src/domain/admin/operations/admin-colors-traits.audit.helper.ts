import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import type { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';

type TaxonomyAuditEvent =
  | typeof APP_EVENTS.INFO.ADMIN.COLOR_CREATED
  | typeof APP_EVENTS.INFO.ADMIN.COLOR_UPDATED
  | typeof APP_EVENTS.INFO.ADMIN.COLOR_DELETED
  | typeof APP_EVENTS.INFO.ADMIN.TRAIT_CREATED
  | typeof APP_EVENTS.INFO.ADMIN.TRAIT_UPDATED
  | typeof APP_EVENTS.INFO.ADMIN.TRAIT_DELETED;

/**
 * Durable taxonomy audit row for admin Color / Trait mutations (R3).
 *
 * DECISION: colors and traits are shared by every stylist, so each mutation is admin config,
 * and this EventLog row is the only durable trace of who changed the global taxonomy
 * (`reportIssueBackend` at the call sites is a no-op in prod). Call sites await it so the row
 * persists before the response. Update logs a before/after snapshot from `existing`; delete
 * captures `name` before the delete (the EventLog FK points at the actor, not the record).
 */
export const emitTaxonomyAudit = async (
  currentUserId: string,
  eventName: TaxonomyAuditEvent,
  payload: Record<string, unknown>
): Promise<void> => {
  await writeRawEventLog_IO({
    eventName,
    eventLogType: EventLogTypeValue.ADMIN,
    meta: { created_by_user_id: currentUserId },
    eventPayloadToStringify: payload,
  });
};
