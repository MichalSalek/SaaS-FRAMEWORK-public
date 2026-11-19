/** Production checkout store bootstrap and subscription guards on disposable Postgres. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';

const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('No test DB');
      }
      return holder.client;
    },
  },
}));
import { PrismaClient as Client } from '../../src/prisma/js-client';
import { prismaCheckoutAttemptStore as store } from '@domain/account/operations/checkout-attempt.store';

const url =
  process.env.CHECKOUT_ATTEMPT_DATABASE_URL ??
  process.env.CHECKOUT_ATTEMPT_TEST_DATABASE_URL;
if (
  url &&
  !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)
) {
  throw new Error('Disposable loopback database required');
}
const schema = `checkout_guards_${randomUUID().replaceAll('-', '')}`;
const migration = readFileSync(
  new URL(
    '../../src/prisma/migrations/20261106120000_checkout_attempt/migration.sql',
    import.meta.url
  ),
  'utf8'
);
describe.skipIf(!url)('checkout claim and freeze guards on Postgres', () => {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    options: `-c search_path=${schema}`,
  });
  const account = async () => {
    const id = randomUUID();
    await pool.query('INSERT INTO "users" (id) VALUES ($1)', [id]);
    await pool.query(
      'INSERT INTO "StylistAccount" (account_id, created_by_user_id) VALUES ($1, $1)',
      [id]
    );
    return id;
  };
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "users" (id text PRIMARY KEY)');
    await pool.query(
      `CREATE TABLE "StylistAccount" (account_id text PRIMARY KEY, created_by_user_id text NOT NULL REFERENCES users(id), trial_started_at timestamptz, payment_status text NOT NULL DEFAULT 'UNPAID', subscription_id text, subscription_status text)`
    );
    await pool.query(migration);
    holder.client = new Client({ adapter: new PrismaPg(pool, { schema }) });
  });
  afterAll(async () => {
    await holder.client?.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });
  it('waits for the user lock before inserting the first attempt', async () => {
    const id = await account();
    const owner = randomUUID();
    const blocker = await pool.connect();
    let pending: ReturnType<typeof store.claim> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM "users" WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      pending = store.claim(id, owner);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const result = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%INSERT INTO \"CheckoutAttempt\"%'"
        );
        if (result.rowCount) {
          waiting = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      expect(await store.read(id)).toBeNull();
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect(await pending).toMatchObject({ account_id: id, lease_owner: owner });
  });
  it('rejects a retained nonterminal or unknown subscription even without trial params', async () => {
    const id = await account();
    const owner = randomUUID();
    const attemptId = randomUUID();
    await store.claim(id, owner);
    await store.start({
      accountId: id,
      owner,
      attemptId,
      fingerprint: 'fingerprint',
      intentJson: '{}',
    });
    const prepared = () =>
      store.prepared({
        accountId: id,
        owner,
        attemptId,
        paramsJson: '{}',
        metaJson: '{}',
        customerId: 'cus_test',
      });
    await pool.query(
      'UPDATE "StylistAccount" SET subscription_id = $2, subscription_status = $3 WHERE account_id = $1',
      [id, 'sub_test', 'ACTIVE']
    );
    expect(await prepared()).toBeNull();
    await pool.query(
      'UPDATE "StylistAccount" SET subscription_status = NULL WHERE account_id = $1',
      [id]
    );
    expect(await prepared()).toBeNull();
    expect((await store.read(id))?.stripe_params).toBeNull();
    await pool.query(
      'UPDATE "StylistAccount" SET subscription_status = $2 WHERE account_id = $1',
      [id, 'CANCELED']
    );
    expect(await prepared()).toMatchObject({
      phase: 'preparing',
      stripe_params: {},
    });
  });
});
