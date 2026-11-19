// No runtime Prisma import and no runtime app imports: the crash test runs this module in a plain
// `node` process (tests/postgres/job-lease.loader.mjs). Canon: email-outbox.store.ts.

import type { LifecycleSendResult } from '../lifecycle/ledger';
import type { SendEmailParams } from '../email.types';
import {
  EMAIL_OUTBOX_CONFIG,
  decideOutboxRow,
  outboxBackoffMs,
  parseOutboxPayload,
  type OutboxDeps,
  type OutboxRoundResult,
  type OutboxRow,
} from './email-outbox.policy';
import {
  OutboxClaimLostError,
  deadLetterError,
  notifyDeadLetter,
  transition,
  type Fence,
} from './email-outbox.writes';

export const processClaimed = async (
  deps: OutboxDeps,
  row: OutboxRow,
  previousStatus: string,
  resendOnly: boolean,
  result: OutboxRoundResult
): Promise<void> => {
  const fence: Fence = {
    id: row.id,
    status: 'sending',
    attempts: row.attempts,
  };
  const requeue = async (
    reason: string,
    extra: { provider?: null } = {}
  ): Promise<void> => {
    if (row.attempts >= EMAIL_OUTBOX_CONFIG.MAX_ATTEMPTS) {
      const done = await transition(
        deps,
        row,
        fence,
        { status: 'suppressed', reason: 'retry_exhausted' },
        { state: 'suppressed', reason: 'retry_exhausted' },
        { error: deadLetterError('retry_exhausted', row) }
      );
      if (done) {
        result.deadLettered += 1;
        await notifyDeadLetter(deps, row, 'retry_exhausted', 'suppressed');
      }
      return;
    }
    const done = await transition(
      deps,
      row,
      fence,
      {
        status: previousStatus,
        reason,
        ...extra,
        nextAttemptAt: new Date(
          deps.now().getTime() + outboxBackoffMs(row.attempts)
        ),
      },
      { state: previousStatus, reason }
    );
    if (done) {
      result.retryScheduled += 1;
    }
  };

  const payload = parseOutboxPayload(row.outboxPayload);
  const recipient = await deps.loadRecipient(row.userId);
  if (!recipient) {
    if (
      await transition(
        deps,
        row,
        fence,
        { status: 'suppressed', reason: 'recipient_missing' },
        { state: 'suppressed', reason: 'recipient_missing' }
      )
    ) {
      result.suppressed += 1;
    }
    return;
  }
  const locale =
    row.locale === EMAIL_OUTBOX_CONFIG.PENDING_LOCALE
      ? await deps.resolveLocale(recipient.email)
      : row.locale;
  let params: SendEmailParams | null = null;
  if (payload) {
    try {
      params = deps.render({
        messageId: row.id,
        templateId: row.templateId,
        payload,
        locale,
        recipient,
      });
    } catch {
      params = null;
    }
  }
  if (!payload || !params) {
    const done = await transition(
      deps,
      row,
      fence,
      { status: 'suppressed', reason: 'render_error' },
      { state: 'suppressed', reason: 'render_error' },
      { error: deadLetterError('render_error', row) }
    );
    if (done) {
      result.deadLettered += 1;
      await notifyDeadLetter(deps, row, 'render_error', 'suppressed');
    }
    return;
  }

  let send: LifecycleSendResult;
  let contacted = row.provider;
  let resendRefused = false;
  try {
    send = await deps.send({ id: row.id, templateId: row.templateId }, params, {
      resendOnly,
      // Evidence BEFORE the call: a crash mid-call leaves the provider that may hold the message.
      beforeProviderCall: async provider => {
        // The transport asks for Mailgun after Resend was marked only when Resend refused THIS
        // request in a way that leaves it no copy: on a first attempt any refusal (no earlier
        // request exists), on a Resend-only retry only a JSON 400/422 validation error
        // (measured-transport.ts). From here on Resend does not hold the message.
        if (provider === 'mailgun' && contacted === 'resend') {
          resendRefused = true;
        }
        const marked = await deps.db.emailLifecycleMessage.updateMany({
          where: { ...fence, outbox: true },
          data: {
            provider,
            locale,
            recipientAddressHash: deps.addressHash(recipient.email),
          },
        });
        if (marked.count !== 1) {
          throw new OutboxClaimLostError();
        }
        contacted = provider;
      },
    });
  } catch (error) {
    if (error instanceof OutboxClaimLostError) {
      return;
    }
    // Only beforeProviderCall throws (the transport maps provider errors to results), so the
    // provider recorded on the row is exactly the set that may have been contacted. After a
    // definitive Resend refusal nobody holds the message: the provider is cleared, so the next
    // attempt may still fall back to Mailgun instead of being held as a Resend-only retry.
    await requeue('dispatch_error', resendRefused ? { provider: null } : {});
    return;
  }
  const settled: OutboxRow = { ...row, provider: contacted, locale };

  if (send.status === 'accepted') {
    if (
      await transition(
        deps,
        settled,
        fence,
        {
          status: 'accepted',
          provider: send.provider,
          providerMessageId: send.providerMessageId,
          acceptedAt: deps.now(),
          reason: null,
          nextAttemptAt: null,
        },
        { state: 'accepted', reason: null }
      )
    ) {
      result.sent += 1;
      await deps.onAccepted(settled, payload);
    }
    return;
  }
  if (send.status === 'rejected') {
    const done = await transition(
      deps,
      { ...settled, provider: send.provider },
      fence,
      { status: 'rejected', provider: send.provider, reason: send.reason },
      { state: 'rejected', reason: send.reason },
      { error: deadLetterError(send.reason, settled) }
    );
    if (done) {
      result.failed += 1;
      result.deadLettered += 1;
      await notifyDeadLetter(deps, settled, send.reason, 'rejected');
    }
    return;
  }
  if (send.status === 'unknown') {
    const after: OutboxRow = { ...settled, provider: send.provider };
    const next = decideOutboxRow({ ...after, status: 'unknown' }, deps.now());
    if (next.action === 'claim') {
      const done = await transition(
        deps,
        after,
        fence,
        {
          status: 'unknown',
          provider: send.provider,
          reason: send.reason,
          nextAttemptAt: new Date(
            deps.now().getTime() + outboxBackoffMs(row.attempts)
          ),
        },
        { state: 'unknown', reason: send.reason }
      );
      if (done) {
        result.unknown += 1;
        result.retryScheduled += 1;
      }
      return;
    }
    const reason =
      next.action === 'dead-letter' ? next.reason : 'unknown_unresolved';
    const done = await transition(
      deps,
      after,
      fence,
      {
        status: 'unknown',
        provider: send.provider,
        reason,
        nextAttemptAt: null,
      },
      { state: 'unknown', reason },
      { error: deadLetterError(reason, after) }
    );
    if (done) {
      result.unknown += 1;
      result.deadLettered += 1;
      await notifyDeadLetter(deps, after, reason, 'unknown');
    }
    return;
  }
  // suppressed: the provider was not contacted.
  if (send.reason === 'circuit_open') {
    await requeue('circuit_open');
    return;
  }
  if (
    await transition(
      deps,
      settled,
      fence,
      { status: 'suppressed', reason: send.reason, nextAttemptAt: null },
      { state: 'suppressed', reason: send.reason }
    )
  ) {
    result.suppressed += 1;
  }
};
