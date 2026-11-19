import {
  EMAIL_OUTBOX_CONFIG,
  decideOutboxRow,
  type OutboxDeps,
  type OutboxRoundResult,
  type OutboxRow,
} from './email-outbox.policy';
import {
  SELECT_ROW,
  settleUnclaimable,
  transition,
} from './email-outbox.writes';
import { processClaimed } from './email-outbox.process';
import { isPrechargeReminderDisabled } from '../email-precharge-reminder.policy';

export {
  EMAIL_OUTBOX_CONFIG,
  decideOutboxRow,
  outboxBackoffMs,
  parseOutboxPayload,
  type EmailOutboxIntent,
  type OutboxDeadLetter,
  type OutboxDeps,
  type OutboxRoundResult,
  type OutboxRow,
} from './email-outbox.policy';
export { enqueueEmailOutboxTx } from './email-outbox.writes';

/**
 * One pass over due outbox rows (or only `ids`, for the post-commit kick). Every claim and every
 * state change is fenced on (id, status, attempts), so concurrent workers do not send the same
 * attempt twice.
 * Test: web-1/tests/postgres/email-outbox.test.ts ('double tick': 8 concurrent rounds in one process
 * send one message once) and web-1/tests/postgres/email-outbox.crash.test.ts (SIGKILL cases); not
 * every interleaving across processes.
 */
export const runEmailOutboxRound = async (
  deps: OutboxDeps,
  options: { ids?: readonly string[]; signal?: AbortSignal } = {}
): Promise<OutboxRoundResult> => {
  const result: OutboxRoundResult = {
    scanned: 0,
    sent: 0,
    failed: 0,
    unknown: 0,
    retryScheduled: 0,
    suppressed: 0,
    deadLettered: 0,
    interrupted: 0,
    aborted: false,
  };
  const now = deps.now();
  const staleBefore = new Date(
    now.getTime() - EMAIL_OUTBOX_CONFIG.STALE_SENDING_MS
  );
  const rows: OutboxRow[] = await deps.db.emailLifecycleMessage.findMany({
    where: {
      outbox: true,
      ...(options.ids ? { id: { in: [...options.ids] } } : {}),
      OR: [
        {
          status: 'reserved',
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        {
          status: 'unknown',
          deadLetteredAt: null,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        { status: 'sending', startedAt: { lte: staleBefore } },
      ],
    },
    select: SELECT_ROW,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: EMAIL_OUTBOX_CONFIG.BATCH_SIZE,
  });
  result.scanned = rows.length;

  for (const candidate of rows) {
    if (options.signal?.aborted) {
      result.aborted = true;
      break;
    }
    let row = candidate;
    if (row.status === 'sending') {
      // The worker died (or hung) between claim and result: the provider may hold the message.
      const interrupted = await transition(
        deps,
        row,
        { id: row.id, status: 'sending', attempts: row.attempts },
        { status: 'unknown', reason: 'send_interrupted' },
        { state: 'unknown', reason: 'send_interrupted' }
      );
      if (!interrupted) {
        continue;
      }
      result.interrupted += 1;
      row = { ...row, status: 'unknown' };
    }
    if (isPrechargeReminderDisabled(row.templateId)) {
      const reason = row.provider
        ? 'precharge_reminder_disabled_prior_delivery_unknown'
        : 'precharge_reminder_disabled';
      if (
        await transition(
          deps,
          row,
          { id: row.id, status: row.status, attempts: row.attempts },
          { status: 'suppressed', reason, nextAttemptAt: null },
          { state: 'suppressed', reason }
        )
      ) {
        result.suppressed += 1;
      }
      continue;
    }
    const decision = decideOutboxRow(row, deps.now());
    if (decision.action !== 'claim') {
      await settleUnclaimable(deps, row, decision, result);
      continue;
    }
    if (!(await deps.stillRelevant(row))) {
      const suppressed = await transition(
        deps,
        row,
        { id: row.id, status: row.status, attempts: row.attempts },
        {
          status: 'suppressed',
          reason: 'eligibility_changed',
          nextAttemptAt: null,
        },
        { state: 'suppressed', reason: 'eligibility_changed' }
      );
      if (suppressed) {
        result.suppressed += 1;
      }
      continue;
    }
    const attempts = row.attempts + 1;
    const claimed = await deps.db.emailLifecycleMessage.updateMany({
      where: {
        id: row.id,
        status: row.status,
        attempts: row.attempts,
        outbox: true,
      },
      data: {
        status: 'sending',
        attempts,
        startedAt: deps.now(),
        nextAttemptAt: null,
      },
    });
    if (claimed.count !== 1) {
      continue;
    }
    await processClaimed(
      deps,
      { ...row, status: 'sending', attempts },
      row.status,
      decision.resendOnly,
      result
    );
  }
  return result;
};
