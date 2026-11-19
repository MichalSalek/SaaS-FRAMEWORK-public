/** Runs only against an explicitly supplied disposable loopback Postgres database. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
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
const claimInChild = (
  connectionString: string,
  accountId: string,
  owner: string
) =>
  new Promise<boolean>((resolve, reject) => {
    const code = `
      import pg from 'pg';
      import { CLAIM_CHECKOUT_ATTEMPT_SQL } from './src/domain/account/operations/checkout-attempt.sql.ts';
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const { connectionString, schema, accountId, owner } = JSON.parse(input);
      const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema });
      try {
        const result = await pool.query(CLAIM_CHECKOUT_ATTEMPT_SQL, [accountId, owner, 60000]);
        process.stdout.write(JSON.stringify(result.rowCount === 1));
      } finally { await pool.end(); }
    `;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', code],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let output = '';
    child.stdout.setEncoding('utf8').on('data', chunk => {
      output += chunk;
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', exitCode => {
      if (exitCode !== 0) {
        reject(new Error(`Claim subprocess failed: ${exitCode}`));
        return;
      }
      resolve(JSON.parse(output) === true);
    });
    child.stdin.end(
      JSON.stringify({ connectionString, schema, accountId, owner })
    );
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

  it('serializes claims for an active paid account and releases without changing checkout state', async () => {
    const id = await account();
    await pool.query(
      `UPDATE "StylistAccount" SET subscription_id = 'sub_current', subscription_status = 'ACTIVE' WHERE account_id = $1`,
      [id]
    );
    const owners = [randomUUID(), randomUUID()] as const;
    const claims = await Promise.all(
      owners.map(owner => claimInChild(url ?? '', id, owner))
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    const owner = claims[0] ? owners[0] : owners[1];
    const other = claims[0] ? owners[1] : owners[0];
    expect(await store.read(id)).toMatchObject({
      phase: 'empty',
      attempt_id: null,
      lease_owner: owner,
    });
    expect(await store.claim(id, other)).toBeNull();
    await store.release(id, owner);
    expect(await store.claim(id, other)).toMatchObject({
      phase: 'empty',
      attempt_id: null,
      stripe_params: null,
    });
    await store.release(id, other);
    expect(await store.read(id)).toMatchObject({
      phase: 'empty',
      attempt_id: null,
      lease_owner: null,
    });
  });
});
