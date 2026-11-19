import { readLifecycleFrequency } from './frequency-window';
import { createHash } from 'node:crypto';
import { DB_CLIENT } from '@app/db/db.client';
import { Prisma } from '../../../prisma/js-client';
import { type EmailCategory } from '@kernel/domain/email/email-schedule.config';
export const lifecycleAddressHash = (email: string): string =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
export type LifecycleReservation = {
  userId: string;
  accountId: string;
  family: string;
  ruleId: string;
  templateId: string;
  occurrence: string;
  contentVersion: string;
  locale: string;
  cohort: string;
  ctaIds: string[];
  scheduledAt: Date;
  recipientEmail: string;
  category?: EmailCategory;
  sweepId?: string;
  opportunityId?: string;
};
/** Provider calls never run under the user-level lock. */
export const reserveLifecycleMessage = async (
  input: LifecycleReservation,
  now = new Date()
) =>
  DB_CLIENT.use.$transaction(async tx => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`lifecycle:${input.userId}`}, 0))`
    );
    const dimensions = {
      family: input.family,
      templateId: input.templateId,
      ruleId: input.ruleId,
      locale: input.locale,
      cohort: input.cohort,
    };
    const suppressed = async (reason: string) => {
      await tx.emailLifecycleOperationalEvent.createMany({
        data: [
          {
            id: createHash('sha256')
              .update(
                [
                  input.accountId,
                  input.occurrence,
                  input.ruleId,
                  input.opportunityId ?? '',
                  reason,
                ].join(':')
              )
              .digest('hex'),
            kind: 'suppressed',
            state: 'suppressed',
            reason,
            dimensions,
            occurredAt: now,
          },
        ],
        skipDuplicates: true,
      });
      return { kind: 'suppressed' as const, reason };
    };
    const existing = await tx.emailLifecycleMessage.findUnique({
      where: {
        accountId_occurrence_ruleId: {
          accountId: input.accountId,
          occurrence: input.occurrence,
          ruleId: input.ruleId,
        },
      },
    });
    if (
      input.opportunityId &&
      (await tx.emailLifecycleMessage.findUnique({
        where: {
          accountId_occurrence_opportunityId: {
            accountId: input.accountId,
            occurrence: input.occurrence,
            opportunityId: input.opportunityId,
          },
        },
      }))
    ) {
      return suppressed('opportunity_reserved');
    }
    if (existing) {
      return suppressed('already_reserved');
    }
    if (
      input.category !== 'TRANSACTIONAL' &&
      (await tx.emailDeliverySuppression.findUnique({
        where: { addressHash: lifecycleAddressHash(input.recipientEmail) },
      }))
    ) {
      return suppressed('delivery_suppressed');
    }
    if (input.sweepId && input.category !== 'TRANSACTIONAL') {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`lifecycle-sweep:${input.sweepId}`}, 0))`
      );
      if (
        (await tx.emailLifecycleMessage.count({
          where: { sweepId: input.sweepId, nonTransactional: true },
        })) >= 50
      ) {
        return suppressed('sweep_budget');
      }
    }
    if (input.category !== 'TRANSACTIONAL') {
      const frequency = await readLifecycleFrequency(tx, input.userId, now);
      if (frequency) {
        return suppressed(frequency);
      }
    }
    if (
      input.category !== 'TRANSACTIONAL' &&
      (now.getUTCHours() >= 21 || now.getUTCHours() < 9)
    ) {
      return suppressed('quiet_hours');
    }
    const {
      recipientEmail: _recipientEmail,
      category: _category,
      ...data
    } = input;
    const message = await tx.emailLifecycleMessage.create({
      data: {
        ...data,
        nonTransactional: input.category !== 'TRANSACTIONAL',
        recipientAddressHash: lifecycleAddressHash(input.recipientEmail),
        createdAt: now,
      },
    });
    await tx.emailLifecycleOperationalEvent.create({
      data: {
        messageId: message.id,
        kind: 'qualified',
        state: 'reserved',
        dimensions,
        occurredAt: now,
      },
    });
    return { kind: 'reserved' as const, message };
  });
export const markLifecycleSending = async (id: string): Promise<boolean> =>
  (
    await DB_CLIENT.use.emailLifecycleMessage.updateMany({
      where: { id, status: 'reserved' },
      data: { status: 'sending', startedAt: new Date() },
    })
  ).count === 1;
export type LifecycleSendResult =
  | {
      status: 'accepted';
      provider: 'resend' | 'mailgun' | 'mailpit';
      providerMessageId: string;
    }
  | {
      status: 'rejected' | 'unknown';
      provider: 'resend' | 'mailgun' | 'mailpit';
      reason: string;
    }
  | { status: 'suppressed'; reason: string };
export const finishLifecycleMessage = async (
  id: string,
  result: LifecycleSendResult
): Promise<void> => {
  await DB_CLIENT.use.$transaction(async tx => {
    const changed = await tx.emailLifecycleMessage.updateMany({
      where: {
        id,
        status:
          result.status === 'suppressed'
            ? { in: ['reserved', 'sending'] }
            : 'sending',
      },
      data: {
        status: result.status,
        ...('provider' in result ? { provider: result.provider } : {}),
        ...(result.status === 'accepted'
          ? {
              providerMessageId: result.providerMessageId,
              acceptedAt: new Date(),
            }
          : { reason: result.reason }),
      },
    });
    if (changed.count) {
      const message = await tx.emailLifecycleMessage.findUniqueOrThrow({
        where: { id },
      });
      await tx.emailLifecycleOperationalEvent.create({
        data: {
          messageId: id,
          kind: 'send_result',
          state: result.status,
          reason: 'reason' in result ? result.reason : null,
          dimensions: {
            family: message.family,
            templateId: message.templateId,
            ruleId: message.ruleId,
            locale: message.locale,
            cohort: message.cohort,
            transport: message.provider,
          },
        },
      });
    }
  });
};
