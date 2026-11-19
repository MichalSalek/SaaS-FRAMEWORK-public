// Shared by tests/postgres/email-outbox.test.ts and its crash worker (a separate OS process).
// The fake provider keeps Resend's contract that matters here: the idempotency key `lifecycle/<id>`
// maps to ONE accepted message, durably (a table, so two processes see the same provider). Mailgun
// has no idempotency: every call is a new delivery. Relative imports only (the worker runs under
// plain `node` with the job-lease loader).
import type { Pool } from 'pg';
import type { PrismaClient } from '../../src/prisma/js-client';
import type {
  OutboxDeps,
  OutboxDeadLetter,
} from '../../src/application/email-handler/outbox/email-outbox.store';

export type ProviderBehavior =
  /** Accept and answer. */
  | 'accept'
  /** Accept, then never answer (process dies after the provider accepted, before the DB ACK). */
  | 'accept-then-hang'
  /** Never reach the provider's acceptance and never answer (dies during the call). */
  | 'hang'
  /** Network error before any answer: Resend reports unknown. */
  | 'network-error'
  /** Resend refuses definitively (422), the transport falls back to Mailgun, which accepts. */
  | 'resend-refuses';

export const deliveriesTable = (schema: string) =>
  `"${schema}"."outbox_test_deliveries"`;

export const createDeliveriesTable = async (pool: Pool, schema: string) => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${deliveriesTable(schema)} (seq serial PRIMARY KEY, provider text NOT NULL, idempotency_key text, message_id text NOT NULL, provider_id text NOT NULL)`
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS outbox_test_deliveries_key ON ${deliveriesTable(schema)} (idempotency_key)`
  );
};

const never = () => new Promise<never>(() => undefined);

export const fakeDeps = (input: {
  db: PrismaClient;
  pool: Pool;
  schema: string;
  provider: 'resend' | 'mailgun';
  behavior: () => ProviderBehavior;
  now?: () => Date;
  onDeadLettered?: (entry: OutboxDeadLetter) => void;
  onProviderReached?: () => void;
  accepted?: string[];
  stillRelevant?: () => boolean;
}): OutboxDeps => ({
  db: input.db,
  stillRelevant: async () => input.stillRelevant?.() ?? true,
  now: input.now ?? (() => new Date()),
  loadRecipient: async userId => {
    const user = await input.db.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    return user?.email ? { email: user.email, name: user.name } : null;
  },
  resolveLocale: async () => 'pl',
  addressHash: email => `hash:${email}`,
  render: ({ templateId, payload, recipient }) => ({
    to: recipient.email,
    subject: `${templateId}:${payload.subjectKey}`,
    html: `<p>${payload.vars.planName ?? ''}</p>`,
  }),
  send: async (message, _params, options) => {
    const behavior = input.behavior();
    if (behavior === 'resend-refuses') {
      await options.beforeProviderCall?.('resend');
      await options.beforeProviderCall?.('mailgun');
      await input.pool.query(
        `INSERT INTO ${deliveriesTable(input.schema)} (provider, idempotency_key, message_id, provider_id) VALUES ('mailgun', NULL, $1, $2)`,
        [message.id, `mailgun-${message.id}`]
      );
      return {
        status: 'accepted',
        provider: 'mailgun',
        providerMessageId: `mailgun-${message.id}`,
      };
    }
    const provider = options.resendOnly ? 'resend' : input.provider;
    await options.beforeProviderCall?.(provider);
    input.onProviderReached?.();
    if (behavior === 'hang') {
      return never();
    }
    if (behavior === 'network-error') {
      return { status: 'unknown', provider, reason: 'network_or_timeout' };
    }
    const key = provider === 'resend' ? `lifecycle/${message.id}` : null;
    await input.pool.query(
      `INSERT INTO ${deliveriesTable(input.schema)} (provider, idempotency_key, message_id, provider_id) VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`,
      [provider, key, message.id, `${provider}-${message.id}`]
    );
    if (behavior === 'accept-then-hang') {
      return never();
    }
    return {
      status: 'accepted',
      provider,
      providerMessageId: `${provider}-${message.id}`,
    };
  },
  onAccepted: async row => {
    input.accepted?.push(row.id);
  },
  onDeadLettered: async entry => {
    input.onDeadLettered?.(entry);
  },
});
