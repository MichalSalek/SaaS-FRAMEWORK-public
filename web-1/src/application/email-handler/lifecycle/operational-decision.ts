import { createHash } from 'node:crypto';
import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../../prisma/js-client';

type Decision = {
  identity: string;
  kind: 'suppressed' | 'finished';
  reason: string;
  family: string;
  templateId: string;
  ruleId: string;
  locale: string;
  cohort: string;
  opportunityId?: string;
  plannedAt?: Date;
  now?: Date;
};
/** Repeated sweeps record the same account opportunity and reason once. */
export const recordLifecycleDecision_IO = async (
  input: Decision
): Promise<void> => {
  const { identity, kind, reason, plannedAt, now, ...dimensions } = input;
  const id = createHash('sha256')
    .update([identity, kind, reason, plannedAt?.toISOString() ?? ''].join(':'))
    .digest('hex');
  await DB_CLIENT.use.emailLifecycleOperationalEvent.createMany({
    data: [
      {
        id,
        kind,
        state: kind,
        reason,
        dimensions: {
          ...dimensions,
          ...(plannedAt ? { plannedAt: plannedAt.toISOString() } : {}),
        },
        occurredAt: now ?? new Date(),
      },
    ],
    skipDuplicates: true,
  });
};

/** Called under the account preference row lock and only for a confirmed true-to-false change. */
export const recordLifecycleUnsubscriptionTx = async (
  tx: Prisma.TransactionClient,
  userId: string,
  accountId: string,
  category: 'TRIAL_SEQUENCE' | 'MARKETING'
): Promise<void> => {
  const message = await tx.emailLifecycleMessage.findFirst({
    where: {
      userId,
      accountId,
      acceptedAt: { not: null },
      family: {
        in:
          category === 'TRIAL_SEQUENCE'
            ? ['free', 'trial']
            : ['cancel', 'reactivation', 'winback'],
      },
    },
    orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      family: true,
      templateId: true,
      ruleId: true,
      locale: true,
      cohort: true,
      provider: true,
    },
  });
  await tx.emailLifecycleOperationalEvent.create({
    data: {
      messageId: message?.id ?? null,
      kind: 'unsubscribed',
      state: 'unsubscribed',
      reason: 'preference_disabled',
      dimensions: {
        family:
          message?.family ??
          (category === 'TRIAL_SEQUENCE' ? 'free' : 'reactivation'),
        templateId: message?.templateId ?? 'none',
        ruleId: message?.ruleId ?? 'none',
        locale: message?.locale ?? 'unknown',
        cohort: message?.cohort ?? 'unknown',
        transport: message?.provider ?? 'none',
        category,
      },
    },
  });
};
