// No runtime Prisma import and no runtime imports beyond the dependency-free kernel constants: the
// crash test runs this module in a plain `node` process. Canon: email-outbox.store.ts.

import { TIME } from '@kernel/application/constants.config';
import type { Prisma, PrismaClient } from '../../../prisma/js-client';
import type { LifecycleSendResult } from '../lifecycle/ledger';
import type { MeasuredSendOptions } from '../lifecycle/measured-transport';
import type { SendEmailParams } from '../email.types';

export const EMAIL_OUTBOX_CONFIG = {
  FAMILY: 'account-billing',
  COHORT: 'transactional',
  /** Locale placeholder until the first claim resolves and stores the recipient's locale. */
  PENDING_LOCALE: 'auto',
  /** A `sending` row older than this lost its worker (provider timeout is 20 s per call). */
  STALE_SENDING_MS: 20 * TIME.MS_PER_MINUTE,
  /** Claims per message, first attempt included. */
  MAX_ATTEMPTS: 4,
  /**
   * Resend keeps an idempotency key for 24 h from the first request. Counted from the intent's
   * creation (always before the first request), so the window is conservative.
   */
  RESEND_RETRY_WINDOW_MS: 20 * TIME.MS_PER_HOUR,
  /** A never-sent intent older than this is stale news: dead-lettered, not sent. */
  MAX_INTENT_AGE_MS: 72 * TIME.MS_PER_HOUR,
  BATCH_SIZE: 50,
  BACKOFF_BASE_MS: 5 * TIME.MS_PER_MINUTE,
  BACKOFF_MAX_MS: 2 * TIME.MS_PER_HOUR,
} as const;

export type EmailOutboxIntent = {
  userId: string;
  /** Stylist account id; part of the dedup key. */
  accountId: string;
  /** Message kind (payment-failed, dunning rule id, …); part of the dedup key. */
  ruleId: string;
  templateId: string;
  /** Stable occurrence of the business fact (invoice attempt, billing period, checkout id). */
  occurrence: string;
  subjectKey: string;
  /** APP_EVENTS.INFO.EMAIL.* recorded in the audit log when the provider accepts. */
  infoEvent: string;
  vars: Record<string, string>;
};

export type EmailOutboxPayload = {
  subjectKey: string;
  infoEvent: string;
  vars: Record<string, string>;
};

export type OutboxTx = Prisma.TransactionClient;

// ── Decisions (pure) ─────────────────────────────────────────────────────────

export type OutboxRow = {
  id: string;
  userId: string;
  accountId: string;
  templateId: string;
  ruleId: string;
  status: string;
  attempts: number;
  provider: string | null;
  locale: string;
  createdAt: Date;
  startedAt: Date | null;
  outboxPayload: Prisma.JsonValue;
};

export type OutboxDecision =
  | { action: 'claim'; resendOnly: boolean }
  | { action: 'expire' }
  | { action: 'dead-letter'; reason: string };

/**
 * What may happen to a `reserved` or `unknown` outbox row now. `unknown` is re-sent only when no
 * second copy is possible: provider never contacted (null), or Resend only, inside its idempotency
 * window (same key `lifecycle/<id>`). Mailgun has no idempotency: an unknown there is never re-sent.
 */
export const decideOutboxRow = (
  row: Pick<OutboxRow, 'status' | 'attempts' | 'provider' | 'createdAt'>,
  now: Date
): OutboxDecision => {
  const age = now.getTime() - row.createdAt.getTime();
  const attemptsLeft = row.attempts < EMAIL_OUTBOX_CONFIG.MAX_ATTEMPTS;
  if (row.provider === null) {
    if (age > EMAIL_OUTBOX_CONFIG.MAX_INTENT_AGE_MS) {
      return row.status === 'reserved'
        ? { action: 'expire' }
        : { action: 'dead-letter', reason: 'intent_expired' };
    }
    return attemptsLeft
      ? { action: 'claim', resendOnly: false }
      : { action: 'dead-letter', reason: 'retry_exhausted' };
  }
  if (row.provider === 'resend') {
    if (age > EMAIL_OUTBOX_CONFIG.RESEND_RETRY_WINDOW_MS) {
      return { action: 'dead-letter', reason: 'unknown_unresolved' };
    }
    return attemptsLeft
      ? { action: 'claim', resendOnly: true }
      : { action: 'dead-letter', reason: 'unknown_unresolved' };
  }
  return { action: 'dead-letter', reason: 'unknown_unresolved' };
};

export const outboxBackoffMs = (attempts: number): number =>
  Math.min(
    EMAIL_OUTBOX_CONFIG.BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    EMAIL_OUTBOX_CONFIG.BACKOFF_MAX_MS
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const parseOutboxPayload = (
  value: Prisma.JsonValue
): EmailOutboxPayload | null => {
  if (
    !isRecord(value) ||
    typeof value.subjectKey !== 'string' ||
    typeof value.infoEvent !== 'string' ||
    !isRecord(value.vars)
  ) {
    return null;
  }
  const vars: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value.vars)) {
    if (typeof entry !== 'string') {
      return null;
    }
    vars[key] = entry;
  }
  return { subjectKey: value.subjectKey, infoEvent: value.infoEvent, vars };
};

// ── Round (I/O through injected dependencies) ────────────────────────────────

export type OutboxRecipient = { email: string; name: string | null };

export type OutboxDeadLetter = {
  messageId: string;
  userId: string;
  templateId: string;
  reason: string;
  ledgerStatus: string;
  provider: string | null;
  attempts: number;
};

export const failedEmailRecipientForUser = (userId: string): string =>
  `user:${userId}`;

export type OutboxDeps = {
  db: PrismaClient;
  /**
   * Is the message still true right before it is (re)sent? A payment-failed mail after the card
   * went through, or an upgrade confirmation after a downgrade, is suppressed as
   * `eligibility_changed`.
   */
  stillRelevant: (row: OutboxRow) => Promise<boolean>;
  now: () => Date;
  loadRecipient: (userId: string) => Promise<OutboxRecipient | null>;
  resolveLocale: (email: string) => Promise<string>;
  addressHash: (email: string) => string;
  render: (input: {
    messageId: string;
    templateId: string;
    payload: EmailOutboxPayload;
    locale: string;
    recipient: OutboxRecipient;
  }) => SendEmailParams;
  send: (
    message: { id: string; templateId: string },
    params: SendEmailParams,
    options: MeasuredSendOptions
  ) => Promise<LifecycleSendResult>;
  /** After the `accepted` commit (audit log). Must not throw. */
  onAccepted: (row: OutboxRow, payload: EmailOutboxPayload) => Promise<void>;
  /** After a dead-letter commit (alert + audit). Must not throw. */
  onDeadLettered: (entry: OutboxDeadLetter) => Promise<void>;
};

export type OutboxRoundResult = {
  scanned: number;
  sent: number;
  failed: number;
  unknown: number;
  retryScheduled: number;
  suppressed: number;
  deadLettered: number;
  interrupted: number;
  aborted: boolean;
};
