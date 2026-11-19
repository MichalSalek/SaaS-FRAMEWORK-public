// No runtime Prisma import and no runtime app imports: the crash test runs this module in a plain
// `node` process (tests/postgres/job-lease.loader.mjs). Canon: email-outbox.store.ts.

import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../prisma/js-client';
import {
  EMAIL_OUTBOX_CONFIG,
  failedEmailRecipientForUser,
  parseOutboxPayload,
  type EmailOutboxIntent,
  type EmailOutboxPayload,
  type OutboxDecision,
  type OutboxDeps,
  type OutboxRoundResult,
  type OutboxRow,
  type OutboxTx,
} from './email-outbox.policy';

/**
 * Writes the intent inside the caller's transaction. Returns the ledger id, or null when the
 * same (accountId, occurrence, ruleId) already exists (a replayed webhook, a double delivery).
 */
export const enqueueEmailOutboxTx = async (
  tx: OutboxTx,
  intent: EmailOutboxIntent,
  now: Date = new Date()
): Promise<string | null> => {
  const id = randomUUID();
  const payload: EmailOutboxPayload = {
    subjectKey: intent.subjectKey,
    infoEvent: intent.infoEvent,
    vars: intent.vars,
  };
  const { count } = await tx.emailLifecycleMessage.createMany({
    data: [
      {
        id,
        userId: intent.userId,
        accountId: intent.accountId,
        family: EMAIL_OUTBOX_CONFIG.FAMILY,
        ruleId: intent.ruleId,
        templateId: intent.templateId,
        occurrence: intent.occurrence,
        contentVersion: '1',
        nonTransactional: false,
        locale: EMAIL_OUTBOX_CONFIG.PENDING_LOCALE,
        cohort: EMAIL_OUTBOX_CONFIG.COHORT,
        ctaIds: [],
        status: 'reserved',
        scheduledAt: now,
        createdAt: now,
        outbox: true,
        outboxPayload: payload,
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) {
    return null;
  }
  await tx.emailLifecycleOperationalEvent.create({
    data: {
      messageId: id,
      kind: 'qualified',
      state: 'reserved',
      dimensions: {
        family: EMAIL_OUTBOX_CONFIG.FAMILY,
        templateId: intent.templateId,
        ruleId: intent.ruleId,
        locale: EMAIL_OUTBOX_CONFIG.PENDING_LOCALE,
        cohort: EMAIL_OUTBOX_CONFIG.COHORT,
      },
      occurredAt: now,
    },
  });
  return id;
};

export class OutboxClaimLostError extends Error {
  constructor() {
    super('email outbox: claim lost before the provider call');
  }
}

export const SELECT_ROW = {
  id: true,
  userId: true,
  accountId: true,
  templateId: true,
  ruleId: true,
  status: true,
  attempts: true,
  provider: true,
  locale: true,
  createdAt: true,
  startedAt: true,
  outboxPayload: true,
} as const;

export type Fence = { id: string; status: string; attempts: number };

/**
 * One state change of one row, fenced on (id, status, attempts): a worker that lost the row (a
 * stale owner, a concurrent tick) changes nothing. The optional FailedEmail row commits with the
 * transition, so a dead-lettered message is never silently lost.
 */
export const transition = async (
  deps: OutboxDeps,
  row: OutboxRow,
  fence: Fence,
  data: Prisma.EmailLifecycleMessageUpdateManyMutationInput,
  event: { state: string; reason: string | null },
  deadLetter?: { error: string }
): Promise<boolean> => {
  const now = deps.now();
  return deps.db.$transaction(async tx => {
    const changed = await tx.emailLifecycleMessage.updateMany({
      where: { ...fence, outbox: true },
      data: deadLetter ? { ...data, deadLetteredAt: now } : data,
    });
    if (changed.count !== 1) {
      return false;
    }
    await tx.emailLifecycleOperationalEvent.create({
      data: {
        messageId: row.id,
        kind: 'send_result',
        state: event.state,
        reason: event.reason,
        occurredAt: now,
        dimensions: {
          family: EMAIL_OUTBOX_CONFIG.FAMILY,
          templateId: row.templateId,
          ruleId: row.ruleId,
          locale: row.locale,
          cohort: EMAIL_OUTBOX_CONFIG.COHORT,
          transport: row.provider,
        },
      },
    });
    if (deadLetter) {
      const payload = parseOutboxPayload(row.outboxPayload);
      await tx.failedEmail.create({
        data: {
          recipient: failedEmailRecipientForUser(row.userId),
          template: row.templateId,
          subject: payload?.subjectKey ?? row.templateId,
          payload: {
            source: 'email-outbox',
            messageId: row.id,
            userId: row.userId,
            templateId: row.templateId,
            subjectKey: payload?.subjectKey ?? null,
            vars: payload?.vars ?? null,
            locale: row.locale,
            ledgerStatus: event.state,
            provider: row.provider,
          },
          error: deadLetter.error,
          attempts: row.attempts,
        },
      });
    }
    return true;
  });
};

export const deadLetterError = (reason: string, row: OutboxRow): string => {
  switch (reason) {
    case 'unknown_unresolved':
      return `UNKNOWN DELIVERY via ${row.provider ?? 'no provider'}: the provider may already hold this message. Check the provider log (tag lifecycle_message_id=${row.id}) before any manual resend.`;
    case 'intent_expired':
      return 'Intent was not sent within its validity window; decide manually whether it is still relevant.';
    case 'retry_exhausted':
      return 'Not sent after the maximum number of attempts (provider never accepted).';
    case 'render_error':
      return 'Template could not be rendered from the stored intent.';
    default:
      return `Provider refused the message (${reason}).`;
  }
};

export const notifyDeadLetter = async (
  deps: OutboxDeps,
  row: OutboxRow,
  reason: string,
  ledgerStatus: string
): Promise<void> => {
  await deps.onDeadLettered({
    messageId: row.id,
    userId: row.userId,
    templateId: row.templateId,
    reason,
    ledgerStatus,
    provider: row.provider,
    attempts: row.attempts,
  });
};

export const settleUnclaimable = async (
  deps: OutboxDeps,
  row: OutboxRow,
  decision: Exclude<OutboxDecision, { action: 'claim' }>,
  result: OutboxRoundResult
): Promise<void> => {
  const fence: Fence = {
    id: row.id,
    status: row.status,
    attempts: row.attempts,
  };
  if (decision.action === 'expire') {
    const done = await transition(
      deps,
      row,
      fence,
      { status: 'suppressed', reason: 'intent_expired' },
      { state: 'suppressed', reason: 'intent_expired' },
      { error: deadLetterError('intent_expired', row) }
    );
    if (done) {
      result.deadLettered += 1;
      await notifyDeadLetter(deps, row, 'intent_expired', 'suppressed');
    }
    return;
  }
  // An `unknown` row keeps its status (the provider may hold it; a late delivery webhook can still
  // move it to `accepted`); a never-contacted `reserved` row ends as `suppressed`.
  const finalStatus = row.status === 'unknown' ? 'unknown' : 'suppressed';
  const done = await transition(
    deps,
    row,
    fence,
    { status: finalStatus, reason: decision.reason, nextAttemptAt: null },
    { state: finalStatus, reason: decision.reason },
    { error: deadLetterError(decision.reason, row) }
  );
  if (done) {
    result.deadLettered += 1;
    await notifyDeadLetter(deps, row, decision.reason, finalStatus);
  }
};
