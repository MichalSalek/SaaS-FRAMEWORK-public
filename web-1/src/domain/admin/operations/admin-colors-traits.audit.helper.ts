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
 * DECISION (nie usuwaj): colors/traits sa wybierane przez WSZYSTKICH stylistow, wiec
 * kazda mutacja to admin-config material — `reportIssueBackend` przy call-sites jest
 * no-op w prod (debug off by default), wiec TEN EventLog jest jedynym trwalym sladem
 * "kto zmienil globalna taksonomie". `await` w call-sites gwarantuje persystencje
 * audytu PRZED response. Dla update: before/after snapshot budowany z `existing`
 * (pobranego do existence-checku, wiec before jest darmowy). Dla delete: `name`
 * przechwytywany pre-delete w tx (EventLog FK wskazuje na aktora, nie usuwany rekord).
 * Cienki wrapper zbija powtarzalny boilerplate (eventLogType ADMIN + meta) z 6 ops do
 * jednej linii per call-site; payload przekazywany inline by zachowac czytelnosc snapshotu.
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
