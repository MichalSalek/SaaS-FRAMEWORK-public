import { DB_CLIENT } from '@app/db/db.client';
import { Prisma } from '../../../prisma/js-client';
import { normalizeProviderMessageId } from './provider-message-id';
import { recordOutboxAccepted } from '../outbox/email-outbox.audit';

export type LifecycleDeliveryInput = {
  provider: 'resend' | 'mailgun';
  providerEventId: string;
  replayToken?: string;
  providerMessageId: string;
  messageId?: string;
  kind: 'delivered' | 'delayed' | 'bounced' | 'complained';
  occurredAt: Date;
  permanent?: boolean;
};
const priority: Record<string, number> = {
  delayed: 1,
  delivered: 2,
  bounced: 3,
  complained: 4,
};
type DeliveryOutcome = {
  found: boolean;
  /** An outbox row this delivery moved to `accepted`: its audit row is written after commit. */
  acceptedOutbox: {
    id: string;
    userId: string;
    templateId: string;
    outboxPayload: Prisma.JsonValue;
  } | null;
};

/**
 * A late delivery cannot erase a complaint or a permanent bounce.
 *
 * DECISION: an OUTBOX row still `sending` keeps its status: its worker owns the transition (fenced
 * on status `sending`) and writes the audit row when it settles; flipping it here made that
 * transition fail and lost the `EMAIL_*_SENT` audit. The delivery itself is still recorded. An
 * outbox row in any other state (`unknown`, dead-lettered or awaiting a Resend retry) is settled
 * here, and its audit row is written by the outbox helper after commit.
 */
export const recordLifecycleDelivery = async (
  event: LifecycleDeliveryInput
): Promise<boolean> => {
  const outcome = await recordDeliveryTx(event);
  if (outcome.acceptedOutbox) {
    await recordOutboxAccepted(outcome.acceptedOutbox);
  }
  return outcome.found;
};

const recordDeliveryTx = (
  event: LifecycleDeliveryInput
): Promise<DeliveryOutcome> =>
  DB_CLIENT.use.$transaction(async (tx): Promise<DeliveryOutcome> => {
    const providerMessageId = normalizeProviderMessageId(
      event.provider,
      event.providerMessageId
    );
    // Match already persisted, bracketed Mailgun IDs as well as the canonical form.
    const providerMessageIds =
      event.provider === 'mailgun'
        ? [providerMessageId, `<${providerMessageId}>`]
        : [providerMessageId];
    const message = await tx.emailLifecycleMessage.findFirst({
      where: {
        OR: [
          {
            provider: event.provider,
            providerMessageId: { in: providerMessageIds },
          },
          ...(event.messageId
            ? [
                {
                  id: event.messageId,
                  AND: [
                    { OR: [{ provider: null }, { provider: event.provider }] },
                    {
                      OR: [
                        { providerMessageId: null },
                        { providerMessageId: { in: providerMessageIds } },
                      ],
                    },
                  ],
                },
              ]
            : []),
        ],
      },
    });
    if (!message) {
      return { found: false, acceptedOutbox: null };
    }
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`lifecycle-delivery:${message.id}`}, 0))`
    );
    const written = await tx.emailDeliveryEvent.createMany({
      data: [
        {
          provider: event.provider,
          providerEventId: event.providerEventId,
          ...(event.replayToken ? { replayToken: event.replayToken } : {}),
          messageId: message.id,
          kind: event.kind,
          occurredAt: event.occurredAt,
        },
      ],
      skipDuplicates: true,
    });
    if (!written.count) {
      return { found: true, acceptedOutbox: null };
    }
    await tx.emailLifecycleOperationalEvent.create({
      data: {
        messageId: message.id,
        kind: 'delivery',
        state: event.kind,
        dimensions: {
          family: message.family,
          templateId: message.templateId,
          ruleId: message.ruleId,
          locale: message.locale,
          cohort: message.cohort,
          transport: event.provider,
        },
        occurredAt: event.occurredAt,
      },
    });
    const current = await tx.emailLifecycleMessage.findUniqueOrThrow({
      where: { id: message.id },
    });
    let acceptedOutbox: DeliveryOutcome['acceptedOutbox'] = null;
    if (
      (priority[event.kind] ?? 0) >
        (priority[current.deliveryStatus ?? ''] ?? 0) ||
      ((priority[event.kind] ?? 0) ===
        (priority[current.deliveryStatus ?? ''] ?? 0) &&
        (current.deliveryAt === null || event.occurredAt >= current.deliveryAt))
    ) {
      const ownedByOutboxWorker =
        current.outbox && current.status === 'sending';
      await tx.emailLifecycleMessage.update({
        where: { id: message.id },
        data: ownedByOutboxWorker
          ? { deliveryStatus: event.kind, deliveryAt: event.occurredAt }
          : {
              status: 'accepted',
              provider: event.provider,
              providerMessageId,
              acceptedAt: current.acceptedAt ?? event.occurredAt,
              deliveryStatus: event.kind,
              deliveryAt: event.occurredAt,
              ...(current.outbox ? { nextAttemptAt: null } : {}),
            },
      });
      if (
        current.outbox &&
        !ownedByOutboxWorker &&
        current.status !== 'accepted'
      ) {
        acceptedOutbox = {
          id: current.id,
          userId: current.userId,
          templateId: current.templateId,
          outboxPayload: current.outboxPayload,
        };
      }
    }
    if (
      message.recipientAddressHash !== null &&
      (event.kind === 'complained' ||
        (event.kind === 'bounced' && event.permanent))
    ) {
      await tx.emailDeliverySuppression.createMany({
        data: [
          {
            addressHash: message.recipientAddressHash,
            reason: event.kind,
          },
        ],
        skipDuplicates: true,
      });
    }
    return { found: true, acceptedOutbox };
  });
