import { DB_CLIENT } from '@app/db/db.client';
import type { EMAIL_DTO_API_V1 } from '@kernel/models/email/email.dto';

type Request = EMAIL_DTO_API_V1['EMAIL_LIFECYCLE_ENTRY']['REQUEST'];

/** Never treats opaque link markers as authentication or trusts a recipient from the body. */
export async function recordLifecycleEntry(
  userId: string,
  input: Request,
  now = new Date()
) {
  const message = await DB_CLIENT.use.emailLifecycleMessage.findFirst({
    where: {
      id: input.messageId,
      userId,
      acceptedAt: {
        not: null,
        gte: new Date(now.getTime() - 90 * 86400000),
        lte: now,
      },
      ctaIds: { has: input.ctaId },
    },
  });
  if (!message) {
    return null;
  }
  const observedAt = new Date(input.interactedAt);
  const boundedTime =
    Number.isFinite(observedAt.getTime()) &&
    Math.abs(observedAt.getTime() - now.getTime()) <= 5 * 60000 &&
    message.acceptedAt &&
    observedAt >= message.acceptedAt
      ? observedAt
      : now;
  const entry = await DB_CLIENT.use.emailLifecycleEntry.upsert({
    where: { id: input.entryId },
    create: {
      id: input.entryId,
      messageId: message.id,
      userId,
      ctaId: input.ctaId,
      createdAt: boundedTime,
    },
    update: {},
  });
  if (
    entry.userId !== userId ||
    entry.messageId !== message.id ||
    entry.ctaId !== input.ctaId
  ) {
    return null;
  }
  return {
    accountId: message.accountId,
    messageId: message.id,
    entryId: entry.id,
    ctaId: entry.ctaId,
    enteredAt: entry.createdAt.toISOString(),
    family: message.family,
    ruleId: message.ruleId,
    templateId: message.templateId,
    locale: message.locale,
    cohort: message.cohort,
    provider: message.provider,
  };
}
