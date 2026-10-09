import type { IDType } from '@kernel/application/application.types';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';

/**
 * One audit-row shape for the three impersonation lifecycle steps (become, refresh,
 * switch-back): explicit ADMIN bucket (bypasses the policy gate, the events are
 * registered there too; see event_log.config.ts), the ADMIN as the actor and
 * `impersonated_by_admin_id` merged into the payload by writeRawEventLog_IO.
 * Returns the row fields only: each call site still calls writeRawEventLog_IO with its
 * own `eventName`, so audit:event-reader-writer can see who writes the event (the
 * anomaly alert reads USER_BECAME_SOMEONE_ELSE).
 *
 * DECISION (nie usuwaj tego komentarza):
 * admin_email NIE w event_payload — `created_by_user_id` JOIN do User table dostarcza email.
 * PII minimization per RODO Art. 5(1)(c) — data minimization principle.
 * Audit trail łapie admin tożsamość przez `meta.created_by_user_id` (FK do User),
 * a UI (AuditTrailEntry) enrichuje email via batch User.findMany — patrz
 * `admin-audit-trail.operations.ts` (parseTargetFromPayload + userMap).
 */
export const impersonationAuditRow = ({
  adminUserId,
  payload,
}: {
  adminUserId: IDType;
  payload: Record<string, unknown>;
}) => ({
  eventLogType: EventLogTypeValue.ADMIN,
  meta: {
    created_by_user_id: adminUserId,
    impersonated_by_admin_id: adminUserId,
  },
  eventPayloadToStringify: payload,
});
