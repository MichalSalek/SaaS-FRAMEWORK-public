/** Runs only against an explicitly supplied disposable loopback Postgres database. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../src/prisma/js-client';

const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('Test database unavailable');
      }
      return holder.client;
    },
  },
}));
import { prismaCheckoutAttemptStore as store } from '../../src/domain/account/operations/checkout-attempt.store';

const url = process.env.CHECKOUT_ATTEMPT_DATABASE_URL;
if (
  url &&
  !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)
) {
  throw new Error(
    'Checkout attempt test requires a disposable loopback database'
  );
}
const schema = `checkout_attempt_${randomUUID().replaceAll('-', '')}`;
const migration = readFileSync(
  new URL(
    '../../src/prisma/migrations/20261106120000_checkout_attempt/migration.sql',
    import.meta.url
  ),
  'utf8'
);
const intent = JSON.stringify({ planId: 'PRO', currency: 'PLN' });
const params = JSON.stringify({
  mode: 'subscription',
  nested: { value: 'unchanged' },
});
const meta = JSON.stringify({
  returnUrl: 'https://example.test',
  billingAddressRequired: false,
  promoRejected: false,
});

describe.skipIf(!url)('checkout attempt on real Postgres', () => {
  const pool = new Pool({
    connectionString: url,
    max: 30,
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
  const expireLease = (id: string) =>
    pool.query(
      `UPDATE "CheckoutAttempt" SET lease_expires_at = now() - interval '1 second' WHERE account_id = $1`,
      [id]
    );
  const start = (accountId: string, owner: string, attemptId: string) =>
    store.start({
      accountId,
      owner,
      attemptId,
      fingerprint: 'fingerprint',
      intentJson: intent,
    });
  const prepare = (accountId: string, owner: string, attemptId: string) =>
    store.prepared({
      accountId,
      owner,
      attemptId,
      paramsJson: params,
      metaJson: meta,
      customerId: 'cus_test',
    });

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "users" (id text PRIMARY KEY)');
    await pool.query(
      'CREATE TABLE "StylistAccount" (account_id text PRIMARY KEY, created_by_user_id text NOT NULL REFERENCES users(id), trial_started_at timestamptz, payment_status text NOT NULL DEFAULT \'UNPAID\', subscription_id text, subscription_status text)'
    );
    await pool.query(migration);
    await pool.query(migration);
    holder.client = new PrismaClient({
      adapter: new PrismaPg(pool, { schema }),
    });
  });
  afterAll(async () => {
    await holder.client?.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it('grants exactly one of many concurrent claims and returns DB time', async () => {
    const id = await account();
    expect(await store.read(id)).toBeNull();
    const claims = await Promise.all(
      Array.from({ length: 50 }, () => store.claim(id, randomUUID()))
    );
    const winners = claims.filter(row => row !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({
      account_id: id,
      phase: 'empty',
      attempt_id: null,
    });
    expect(winners[0]?.db_now).toBeInstanceOf(Date);
  });

  it('reclaims after a crash with exact immutable preparation and deadline', async () => {
    const id = await account();
    const first = randomUUID();
    const second = randomUUID();
    const generation = randomUUID();
    await store.claim(id, first);
    const started = await start(id, first, generation);
    if (!started?.expires_at) {
      throw new Error('Expected a started attempt and deadline');
    }
    expect(started.expires_at.getTime() - started.db_now.getTime()).toBeCloseTo(
      24 * 3600_000 - 120_000,
      -2
    );
    const saved = await prepare(id, first, generation);
    expect(saved?.stripe_params).toEqual(JSON.parse(params));
    expect(await prepare(id, first, generation)).toBeNull();
    await expireLease(id);
    const recovered = await store.claim(id, second);
    expect(recovered).toMatchObject({
      attempt_id: generation,
      intent: JSON.parse(intent),
      stripe_params: JSON.parse(params),
      response_meta: JSON.parse(meta),
      customer_id: 'cus_test',
      phase: 'preparing',
    });
    expect(recovered?.expires_at?.getTime()).toBe(
      started?.expires_at?.getTime()
    );
    expect(
      await store.session({
        accountId: id,
        owner: second,
        attemptId: generation,
        sessionId: 'cs_test',
        subscriptionId: null,
        phase: 'open',
      })
    ).toMatchObject({ phase: 'open' });
    expect(await start(id, second, randomUUID())).toBeNull();
    expect(
      await store.expire({
        accountId: id,
        owner: second,
        attemptId: generation,
      })
    ).toMatchObject({
      phase: 'expired',
      attempt_id: generation,
      stripe_params: JSON.parse(params),
      stripe_session_id: 'cs_test',
    });
    const next = await start(id, second, randomUUID());
    expect(next).toMatchObject({
      phase: 'preparing',
      stripe_params: null,
      stripe_session_id: null,
      customer_id: null,
    });
  });

  it('rejects expired and stale owners and generation-fences writes', async () => {
    const id = await account();
    const oldOwner = randomUUID();
    const newOwner = randomUUID();
    const generation = randomUUID();
    await store.claim(id, oldOwner);
    await start(id, oldOwner, generation);
    await expireLease(id);
    expect(await prepare(id, oldOwner, generation)).toBeNull();
    expect(
      await store.expire({
        accountId: id,
        owner: oldOwner,
        attemptId: generation,
      })
    ).toBeNull();
    await store.release(id, oldOwner);
    expect((await store.read(id))?.lease_owner).toBe(oldOwner);
    await store.claim(id, newOwner);
    expect(await start(id, oldOwner, randomUUID())).toBeNull();
    expect(await prepare(id, oldOwner, generation)).toBeNull();
    expect(await prepare(id, newOwner, randomUUID())).toBeNull();
    expect(
      await store.session({
        accountId: id,
        owner: oldOwner,
        attemptId: generation,
        sessionId: 'cs_stale',
        subscriptionId: null,
        phase: 'open',
      })
    ).toBeNull();
    await store.release(id, oldOwner);
    expect((await store.read(id))?.lease_owner).toBe(newOwner);
    await store.release(id, newOwner);
    expect((await store.read(id))?.lease_owner).toBeNull();
  });

  it('fences starting after expiry and never resurrects terminal sessions', async () => {
    const id = await account();
    const oldOwner = randomUUID();
    const newOwner = randomUUID();
    const generation = randomUUID();
    await store.claim(id, oldOwner);
    await start(id, oldOwner, generation);
    const session = (owner: string, phase: 'open' | 'completed' | 'expired') =>
      store.session({
        accountId: id,
        owner,
        attemptId: generation,
        sessionId: 'cs_terminal',
        subscriptionId: 'sub_terminal',
        phase,
      });
    expect(await session(oldOwner, 'completed')).toMatchObject({
      phase: 'completed',
    });
    expect(await session(oldOwner, 'completed')).toMatchObject({
      phase: 'completed',
    });
    expect(await session(oldOwner, 'open')).toBeNull();
    expect(
      await store.expire({
        accountId: id,
        owner: oldOwner,
        attemptId: generation,
      })
    ).toMatchObject({
      phase: 'expired',
      stripe_subscription_id: 'sub_terminal',
    });
    expect(await session(oldOwner, 'open')).toBeNull();
    await expireLease(id);
    expect(await start(id, oldOwner, randomUUID())).toBeNull();
    await store.claim(id, newOwner);
    expect(await start(id, oldOwner, randomUUID())).toBeNull();
    expect(await start(id, newOwner, randomUUID())).toMatchObject({
      phase: 'preparing',
    });
  });

  it('rejects a trial freeze after the account consumed its trial, but accepts a no-trial retry', async () => {
    const id = await account();
    const owner = randomUUID();
    const attemptId = randomUUID();
    await store.claim(id, owner);
    await start(id, owner, attemptId);
    await pool.query(
      'UPDATE "StylistAccount" SET trial_started_at = clock_timestamp() WHERE account_id = $1',
      [id]
    );
    const trialParams = JSON.stringify({
      subscription_data: { trial_period_days: 30 },
    });
    expect(
      await store.prepared({
        accountId: id,
        owner,
        attemptId,
        paramsJson: trialParams,
        metaJson: meta,
        customerId: 'cus_trial',
      })
    ).toBeNull();
    expect((await store.read(id))?.stripe_params).toBeNull();
    expect(await prepare(id, owner, attemptId)).toMatchObject({
      phase: 'preparing',
      stripe_params: JSON.parse(params),
    });
  });

  it('waits for the user before taking the checkout attempt lock', async () => {
    const id = await account();
    const owner = randomUUID();
    const generation = randomUUID();
    await store.claim(id, owner);
    await start(id, owner, generation);
    const blocker = await pool.connect();
    const probe = await pool.connect();
    let pending: ReturnType<typeof prepare> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM "users" WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      pending = prepare(id, owner, generation);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const result = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%owned_user%'"
        );
        if (result.rowCount) {
          waiting = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await probe.query('BEGIN');
      await probe.query(
        'SELECT account_id FROM "CheckoutAttempt" WHERE account_id = $1 FOR UPDATE NOWAIT',
        [id]
      );
      await probe.query('ROLLBACK');
    } finally {
      await probe.query('ROLLBACK');
      probe.release();
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect(await pending).toMatchObject({
      phase: 'preparing',
      stripe_params: JSON.parse(params),
    });
  });

  it('enforces account ownership with a foreign key and cascades deletion', async () => {
    const missing = randomUUID();
    expect(await store.claim(missing, randomUUID())).toBeNull();
    await expect(
      pool.query('INSERT INTO "CheckoutAttempt" (account_id) VALUES ($1)', [
        missing,
      ])
    ).rejects.toThrow();
    const id = await account();
    await store.claim(id, randomUUID());
    await pool.query('DELETE FROM "StylistAccount" WHERE account_id = $1', [
      id,
    ]);
    expect(await store.read(id)).toBeNull();
  });
});
