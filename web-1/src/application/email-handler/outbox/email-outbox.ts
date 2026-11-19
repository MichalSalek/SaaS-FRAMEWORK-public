import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { renderEmailTemplate } from '../email-template.renderer';
import { resolveLocaleByEmail } from '../email-locale.resolver';
import { lifecycleAddressHash } from '../lifecycle/ledger';
import { sendMeasuredLifecycleMessage } from '../lifecycle/measured-transport';
import { recordOutboxAccepted } from './email-outbox.audit';
import { loadOutboxRelevance } from './email-outbox.relevance';
import {
  runEmailOutboxRound,
  type OutboxDeps,
  type OutboxRoundResult,
} from './email-outbox.store';

export { enqueueEmailOutboxTx } from './email-outbox.store';

const asLocale = (value: string): LocaleType => getLocaleOrDefault(value);

export const createEmailOutboxDeps = (
  overrides: Partial<OutboxDeps> = {}
): OutboxDeps => ({
  db: DB_CLIENT.use,
  stillRelevant: loadOutboxRelevance,
  now: () => new Date(),
  loadRecipient: async userId => {
    const user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    return user?.email ? { email: user.email, name: user.name } : null;
  },
  resolveLocale: email => resolveLocaleByEmail(email),
  addressHash: lifecycleAddressHash,
  render: ({ templateId, payload, locale, recipient }) => ({
    to: recipient.email,
    // Same rendering as sendTransactionalEmail: no unsubscribe link, no List-Unsubscribe header.
    ...renderEmailTemplate(
      templateId,
      { displayName: recipient.name ?? '', ...payload.vars },
      asLocale(locale),
      '',
      payload.subjectKey
    ),
    headers: {},
  }),
  send: (message, params, options) =>
    sendMeasuredLifecycleMessage(message, params, 'TRANSACTIONAL', options),
  onAccepted: row => recordOutboxAccepted(row),
  onDeadLettered: async entry => {
    reportIssueBackend({
      namespace: 'EMAIL_OUTBOX_DEAD_LETTERED',
      message: `Outbox email needs a human decision (${entry.reason}): ${entry.templateId}`,
      payload: entry,
      mode: 'error',
    });
    await recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_DEAD_LETTERED,
      user: { id: entry.userId },
      responseBody: {
        templateId: entry.templateId,
        attempts: entry.attempts,
        reason: entry.reason,
        lifecycleMessageId: entry.messageId,
      },
    });
  },
  ...overrides,
});

/** Sends due outbox mail. Never throws for a single message; a DB outage surfaces to the caller. */
export const processEmailOutbox_IO = (
  options: { ids?: readonly string[]; signal?: AbortSignal } = {}
): Promise<OutboxRoundResult> =>
  runEmailOutboxRound(createEmailOutboxDeps(), options);

/**
 * Post-commit effect: send the just-committed intents now instead of at the next job round. A
 * lost kick (process killed after commit) costs latency only; the job picks the row up.
 */
export const kickEmailOutbox =
  (ids: readonly string[]) => async (): Promise<void> => {
    if (ids.length === 0) {
      return;
    }
    try {
      await processEmailOutbox_IO({ ids });
    } catch (error) {
      reportIssueBackend({
        namespace: 'EMAIL_OUTBOX_KICK_FAILED',
        message:
          'Post-commit outbox send failed; the email-outbox job retries it',
        payload: { ids, error },
        mode: 'warn',
      });
    }
  };
