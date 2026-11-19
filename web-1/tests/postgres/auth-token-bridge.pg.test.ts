/**
 * One Verification row, two OS processes, a third connection holding that row
 * FOR UPDATE. The lock is released only after both workers are waiting
 * (pg_stat_activity), not after a sleep. The pre-fix find + void delete
 * returns two tokens. redeemExchangeCode returns one token and one null.
 * The URL is direct loopback Postgres. Workers set search_path and
 * application_name in startup options, and the observer must see other
 * backends. Not PgBouncer. Run from web-1:
 * AUTH_HOT_PATH_DATABASE_URL=postgresql://…@127.0.0.1:PORT/db
 * npx vitest run --config vitest.postgres.config.ts tests/postgres/auth-token-bridge.pg.test.ts
 * Covers this Prisma adapter with transactions left off. Not secondary storage.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const databaseUrl = process.env.AUTH_HOT_PATH_DATABASE_URL;

const loopbackHost = (url: string): boolean => {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

const schema = `auth_xchg_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schema}"`;
const workerPath = fileURLToPath(
  new URL('./auth-token-bridge.worker.ts', import.meta.url)
);
const loaderPath = fileURLToPath(
  new URL('./job-lease.loader.mjs', import.meta.url)
);
const web1Root = fileURLToPath(new URL('../..', import.meta.url));

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const stderrText = new WeakMap<ChildProcessWithoutNullStreams, string>();

const rememberStderr = (child: ChildProcessWithoutNullStreams): void => {
  child.stderr.on('data', chunk => {
    stderrText.set(child, `${stderrText.get(child) ?? ''}${String(chunk)}`);
  });
};

const redact = (text: string, secret: string): string =>
  text.replaceAll(secret, '[code]').slice(0, 400);

const enabled = databaseUrl !== undefined && loopbackHost(databaseUrl);

describe.skipIf(!enabled)('exchange-code single use on real Postgres', () => {
  if (databaseUrl === undefined) {
    return;
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    application_name: 'nf-xchg-parent',
  });

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${quotedSchema}`);
    await pool.query(`
      CREATE TABLE ${quotedSchema}."Verification" (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at TIMESTAMP(3) NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        UNIQUE (identifier, value)
      )
    `);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await pool.end();
  }, 20_000);

  const insertRow = async (
    code: string,
    token: string,
    expired: boolean
  ): Promise<void> => {
    // The column is TIMESTAMP(3) without time zone. A JS Date near "now" can
    // round-trip a couple of hours off, so expiry is a database interval.
    const expiresSql = expired
      ? `NOW() - interval '2 days'`
      : `NOW() + interval '5 minutes'`;
    await pool.query(
      `INSERT INTO ${quotedSchema}."Verification"
         (id, identifier, value, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, ${expiresSql}, NOW(), NOW())`,
      [`v_${randomBytes(8).toString('hex')}`, `xchg:${code}`, token]
    );
  };

  const rowCount = async (): Promise<number> => {
    const result = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM ${quotedSchema}."Verification"`
    );
    return result.rows[0]?.n ?? 0;
  };

  const spawnWorker = (
    mode: 'legacy' | 'redeem',
    code: string
  ): ChildProcessWithoutNullStreams => {
    const child = spawn(
      process.execPath,
      ['--import', loaderPath, workerPath, mode],
      {
        cwd: web1Root,
        env: {
          ...process.env,
          NODE_ENV_MANUAL: process.env.NODE_ENV_MANUAL ?? 'DEVELOPMENT',
          BRIDGE_SCHEMA: schema,
          BRIDGE_CODE: code,
        },
      }
    );
    rememberStderr(child);
    return child;
  };

  const readOutcome = (child: ChildProcessWithoutNullStreams, code: string) =>
    new Promise<'token' | 'null'>((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new Error(
            `worker timed out detail=${redact(stderrText.get(child) ?? '', code)}`
          )
        );
      }, 30_000);
      child.stdout.on('data', chunk => {
        out += String(chunk);
      });
      child.on('exit', () => {
        clearTimeout(timer);
        const line = out
          .split('\n')
          .find(candidate => candidate.startsWith('OUTCOME '));
        if (line === 'OUTCOME token') {
          resolve('token');
          return;
        }
        if (line === 'OUTCOME null') {
          resolve('null');
          return;
        }
        reject(
          new Error(
            `worker outcome missing detail=${redact(stderrText.get(child) ?? '', code)}`
          )
        );
      });
    });

  // The backend holding FOR UPDATE does not list the waiters in
  // pg_stat_activity. Count them from another connection in this pool.
  const waiterCount = async (): Promise<number> => {
    const result = await pool.query<{ named: number }>(
      `SELECT COUNT(DISTINCT pid) FILTER (
         WHERE application_name = 'nf-xchg-worker'
           AND wait_event_type = 'Lock'
       )::int AS named
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()`
    );
    return result.rows[0]?.named ?? 0;
  };

  const race = async (
    mode: 'legacy' | 'redeem'
  ): Promise<{ tokens: number; nulls: number; waiters: number }> => {
    const code = randomBytes(32).toString('hex');
    const token = randomBytes(16).toString('hex');
    await insertRow(code, token, false);
    const client = await pool.connect();
    const workers: ChildProcessWithoutNullStreams[] = [];
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT id FROM ${quotedSchema}."Verification" WHERE identifier = $1 FOR UPDATE`,
        [`xchg:${code}`]
      );
      if ((locked.rowCount ?? 0) !== 1) {
        throw new Error(`locked=${locked.rowCount ?? 0}`);
      }
      workers.push(spawnWorker(mode, code), spawnWorker(mode, code));
      const deadline = Date.now() + 20_000;
      let waiters = 0;
      while (Date.now() < deadline) {
        if (workers.every(worker => worker.exitCode !== null)) {
          const detail = workers
            .map(worker => redact(stderrText.get(worker) ?? '', code))
            .join(' || ');
          throw new Error(`workers exited early stderr=${detail}`);
        }
        waiters = await waiterCount();
        if (waiters >= 2) {
          break;
        }
        await sleep(50);
      }
      if (waiters < 2) {
        const detail = workers
          .map(worker => redact(stderrText.get(worker) ?? '', code))
          .join(' || ');
        throw new Error(`waiters=${waiters} stderr=${detail}`);
      }
      await client.query('COMMIT');
      const outcomes = await Promise.all(
        workers.map(worker => readOutcome(worker, code))
      );
      return {
        tokens: outcomes.filter(outcome => outcome === 'token').length,
        nulls: outcomes.filter(outcome => outcome === 'null').length,
        waiters,
      };
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      for (const worker of workers) {
        if (worker.exitCode === null) {
          worker.kill('SIGKILL');
        }
      }
    }
  };

  it('starts with an empty verification table', async () => {
    expect(await rowCount()).toBe(0);
  });

  it('legacy find + void delete returns the token to both waiters', async () => {
    const result = await race('legacy');
    expect(result.waiters).toBeGreaterThanOrEqual(2);
    expect(result.tokens).toBe(2);
    expect(result.nulls).toBe(0);
    expect(await rowCount()).toBe(0);
  }, 60_000);

  it('consumeVerificationValue returns one token and one null', async () => {
    const result = await race('redeem');
    expect(result.waiters).toBeGreaterThanOrEqual(2);
    expect(result.tokens).toBe(1);
    expect(result.nulls).toBe(1);
    expect(await rowCount()).toBe(0);
  }, 60_000);

  it('an expired code is null and the row is gone', async () => {
    const code = randomBytes(32).toString('hex');
    await insertRow(code, randomBytes(16).toString('hex'), true);
    const worker = spawnWorker('redeem', code);
    try {
      expect(await readOutcome(worker, code)).toBe('null');
      expect(await rowCount()).toBe(0);
    } finally {
      if (worker.exitCode === null) {
        worker.kill('SIGKILL');
      }
    }
  }, 60_000);
});
