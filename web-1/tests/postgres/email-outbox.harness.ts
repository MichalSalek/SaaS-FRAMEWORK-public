// Shared harness of the email-outbox Postgres suites (email-outbox.test.ts, email-outbox.crash.test.ts):
// an isolated schema built from schema.prisma, a fake provider (email-outbox.fakes.ts) and the crash
// worker launcher. The DB_CLIENT mock stays in each test file (vi.mock is hoisted per file).
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/prisma/js-client';
import {
  EMAIL_OUTBOX_CONFIG,
  enqueueEmailOutboxTx,
  type EmailOutboxIntent,
  type OutboxDeadLetter,
} from '../../src/application/email-handler/outbox/email-outbox.store';
import {
  createDeliveriesTable,
  deliveriesTable,
  fakeDeps,
  type ProviderBehavior,
} from './email-outbox.fakes';

export const OUTBOX_TEST_URL = process.env.OUTBOX_TEST_DATABASE_URL;

const workerPath = fileURLToPath(
  new URL('./email-outbox.worker.ts', import.meta.url)
);
const loaderPath = fileURLToPath(
  new URL('./job-lease.loader.mjs', import.meta.url)
);

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));
/** A clock past the stale-`sending` threshold. */
export const later = () =>
  new Date(Date.now() + EMAIL_OUTBOX_CONFIG.STALE_SENDING_MS + 60_000);

export const intent = (
  user: string,
  occurrence: string,
  ruleId = 'payment-failed'
): EmailOutboxIntent => ({
  userId: user,
  accountId: `acc-${user}`,
  ruleId,
  templateId: ruleId,
  occurrence,
  subjectKey: 'email.paymentFailed.subject',
  infoEvent: 'EMAIL_PAYMENT_FAILED_SENT',
  vars: { planName: 'Pro' },
});

export const waitFor = async (
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string
) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
};

export const createOutboxHarness = (url: string | undefined) => {
  const schema = 'outbox_test_' + randomUUID().replaceAll('-', '');
  const pool = new Pool({
    connectionString: url,
    options: `-c search_path=${schema},public`,
    max: 12,
  });
  const state: { db: PrismaClient | null } = { db: null };
  const db = (): PrismaClient => {
    if (!state.db) {
      throw new Error('harness not set up');
    }
    return state.db;
  };

  return {
    schema,
    pool,
    db,
    setUp: async (users: readonly string[]): Promise<PrismaClient> => {
      const sql = execFileSync(
        'npx',
        [
          'prisma',
          'migrate',
          'diff',
          '--from-empty',
          '--to-schema',
          'src/prisma/schema.prisma',
          '--script',
        ],
        { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url ?? '' } }
      );
      await pool.query(`CREATE SCHEMA "${schema}"`);
      await pool.query(sql);
      await createDeliveriesTable(pool, schema);
      const client = new PrismaClient({
        adapter: new PrismaPg(pool, { schema }),
      });
      state.db = client;
      await client.role.create({ data: { id: 'role', name: 'STYLIST' } });
      await client.user.createMany({
        data: users.map(id => ({
          id,
          email: `${id}@example.test`,
          role_id: 'role',
        })),
      });
      return client;
    },
    tearDown: async () => {
      await state.db?.$disconnect();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    },
    deliveries: async (messageId: string) =>
      (
        await pool.query<{ provider: string }>(
          `SELECT provider FROM ${deliveriesTable(schema)} WHERE message_id = $1`,
          [messageId]
        )
      ).rows,
    row: (id: string) =>
      db().emailLifecycleMessage.findUniqueOrThrow({ where: { id } }),
    enqueueCommitted: async (value: EmailOutboxIntent): Promise<string> => {
      const id = await db().$transaction(tx => enqueueEmailOutboxTx(tx, value));
      if (id === null) {
        throw new Error('intent not created');
      }
      return id;
    },
    deps: (
      provider: 'resend' | 'mailgun',
      behavior: ProviderBehavior,
      extra: {
        now?: () => Date;
        deadLetters?: OutboxDeadLetter[];
        accepted?: string[];
        db?: PrismaClient;
        stillRelevant?: () => boolean;
      } = {}
    ) =>
      fakeDeps({
        db: extra.db ?? db(),
        ...(extra.stillRelevant ? { stillRelevant: extra.stillRelevant } : {}),
        pool,
        schema,
        provider,
        behavior: () => behavior,
        ...(extra.now ? { now: extra.now } : {}),
        ...(extra.accepted ? { accepted: extra.accepted } : {}),
        onDeadLettered: entry => extra.deadLetters?.push(entry),
      }),
    spawnWorker: (args: string[]) =>
      spawn(process.execPath, ['--import', loaderPath, workerPath, ...args], {
        env: {
          ...process.env,
          OUTBOX_WORKER_URL: url,
          OUTBOX_WORKER_SCHEMA: schema,
        },
      }),
  };
};

/**
 * The client with ONE transient failure: the first provider marker for `provider` throws, as a
 * dropped connection would. Everything else passes through to the real client.
 */
export const failFirstProviderMarker = (
  client: PrismaClient,
  provider: 'resend' | 'mailgun'
): PrismaClient => {
  let failed = false;
  return new Proxy(client, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop);
      if (prop !== 'emailLifecycleMessage') {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      const delegate = target.emailLifecycleMessage;
      return new Proxy(delegate, {
        get(model, method) {
          if (method === 'updateMany') {
            return async (args: { data?: { provider?: unknown } }) => {
              if (!failed && args.data?.provider === provider) {
                failed = true;
                throw new Error('transient: connection reset');
              }
              return model.updateMany(
                args as Parameters<typeof model.updateMany>[0]
              );
            };
          }
          const member: unknown = Reflect.get(model, method);
          return typeof member === 'function' ? member.bind(model) : member;
        },
      });
    },
  });
};
