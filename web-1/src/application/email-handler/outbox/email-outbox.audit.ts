import { isEventInfoNarrower } from '@kernel/models/type_narrowing';
import type { Prisma } from '../../../prisma/js-client';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { parseOutboxPayload } from './email-outbox.policy';

/**
 * The audit row of an accepted outbox mail: the same `EMAIL_*_SENT` event the direct send wrote
 * (mail history), plus the ledger id, so the frequency guard and the legacy dunning dedup can tell
 * it apart from pre-outbox rows. Written by whichever side settles the row as `accepted`: the
 * outbox worker or the delivery webhook (ledger-delivery.ts).
 */
export const recordOutboxAccepted = async (row: {
  id: string;
  userId: string;
  templateId: string;
  outboxPayload: Prisma.JsonValue;
}): Promise<void> => {
  const payload = parseOutboxPayload(row.outboxPayload);
  if (!payload || !isEventInfoNarrower(payload.infoEvent)) {
    return;
  }
  await recordAuditEvent_IO({
    eventName: payload.infoEvent,
    user: { id: row.userId },
    responseBody: { templateId: row.templateId, lifecycleMessageId: row.id },
  });
};
