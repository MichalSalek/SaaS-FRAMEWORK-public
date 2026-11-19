/**
 * The scheduler lease on REAL Postgres, in separate OS processes, directly and through PgBouncer
 * in transaction pooling mode (Neon `-pooler` runs the same mode). Every statement is the
 * production SQL (src/application/scheduler/job-lease.sql.ts) through the production store and
 * runner; only the pool is a bare `pg` Pool instead of Prisma's PrismaPg (which wraps the same
 * `pg`).
 *
 * Run: `npm run test:scheduler:pg` (starts a PgBouncer container in front of the dev database).
 * JOB_LEASE_TEST_DATABASE_URL = direct; JOB_LEASE_TEST_PGBOUNCER_URL = through PgBouncer.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  createJobLeaseStore,
  type JobLeaseStore,
  type SqlExec,
} from '../../src/application/scheduler/job-lease.store';
import { statementTimeoutSql } from '../../src/application/scheduler/job-lease.sql';

const directUrl = process.env.JOB_LEASE_TEST_DATABASE_URL;
const bouncerUrl = process.env.JOB_LEASE_TEST_PGBOUNCER_URL;
const marker = `test-lease-${randomUUID().slice(0, 8)}`;
const runTable = `job_lease_test_runs_${marker.slice(-8)}`;
const workerPath = fileURLToPath(
  new URL('./job-lease.worker.ts', import.meta.url)
);
const loaderPath = fileURLToPath(
  new URL('./job-lease.loader.mjs', import.meta.url)
);
const migrationPath = fileURLToPath(
  new URL(
    '../../src/prisma/migrations/20261023120000_job_lease/migration.sql',
    import.meta.url
  )
);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const spawnWorker = (
  url: string,
  args: string[]
): ChildProcessWithoutNullStreams =>
  spawn(process.execPath, ['--import', loaderPath, workerPath, ...args], {
    env: {
      ...process.env,
      JOB_LEASE_WORKER_URL: url,
      JOB_LEASE_RUN_TABLE: runTable,
    },
  });

const waitForLine = (
  child: ChildProcessWithoutNullStreams,
  prefix: string,
  timeoutMs: number
) =>
  new Promise<string>((resolve, reject) => {
    let buffer = '';
    let errors = '';
    const timer = setTimeout(
      () => reject(new Error(`worker did not print ${prefix}: ${errors}`)),
      timeoutMs
    );
    child.stderr.on('data', chunk => {
      errors += String(chunk);
    });
    child.stdout.on('data', chunk => {
      buffer += String(chunk);
      const line = buffer
        .split('\n')
        .find(candidate => candidate.startsWith(prefix));
      if (line !== undefined) {
        clearTimeout(timer);
        resolve(line);
      }
    });
    child.on('exit', code => {
      if (!buffer.includes(prefix)) {
        clearTimeout(timer);
        reject(
          new Error(`worker exited ${String(code)} before ${prefix}: ${errors}`)
        );
      }
    });
  });

const storeFor = (pool: Pool): JobLeaseStore => {
  const exec: SqlExec = async <T>(
    sql: string,
    params: ReadonlyArray<string | number | null>,
    options?: { statementTimeoutMs?: number }
  ) => {
    if (options?.statementTimeoutMs === undefined) {
      return (await pool.query(sql, [...params])).rows as T[];
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(statementTimeoutSql(options.statementTimeoutMs));
      const rows = (await client.query(sql, [...params])).rows as T[];
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
  return createJobLeaseStore(exec);
};

const targets = [
  { label: 'direct', url: directUrl },
  { label: 'PgBouncer transaction pooling', url: bouncerUrl },
].filter(
  (target): target is { label: string; url: string } => target.url !== undefined
);

describe.skipIf(directUrl === undefined)('job lease on real Postgres', () => {
  const admin = new Pool({ connectionString: directUrl, max: 2 });

  beforeAll(async () => {
    await admin.query(readFileSync(migrationPath, 'utf8'));
    await admin.query(
      `CREATE TABLE "${runTable}" (job_name text NOT NULL, owner text NOT NULL, started_at timestamptz NOT NULL, finished_at timestamptz)`
    );
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM "JobLease" WHERE job_name LIKE $1`, [
      `${marker}%`,
    ]);
    await admin.query(`DROP TABLE IF EXISTS "${runTable}"`);
    await admin.end();
  });

  for (const target of targets) {
    describe(target.label, () => {
      const pool = new Pool({ connectionString: target.url, max: 20 });
      const store = storeFor(pool);
      const job = (name: string) =>
        `${marker}-${target.label.slice(0, 6)}-${name}`;

      afterAll(async () => {
        await pool.end();
      });

      it('of 20 concurrent claims exactly one wins, on the first insert and on a due row', async () => {
        const name = job('claim');
        const first = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            store.claim(name, `o${i}`, 5_000, 0)
          )
        );
        expect(first.filter(Boolean)).toHaveLength(1);

        const winner = first.findIndex(Boolean);
        expect(await store.complete(name, `o${winner}`, 0, 1, 'test')).toBe(
          true
        );
        const second = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            store.claim(name, `p${i}`, 5_000, 0)
          )
        );
        expect(second.filter(Boolean)).toHaveLength(1);
      });

      it('renews across pooled connections, fences a lost owner, and lets the job go after expiry', async () => {
        const name = job('fence');
        expect(await store.claim(name, 'a', 800, 0)).toBe(true);
        for (let i = 0; i < 4; i += 1) {
          await sleep(400);
          expect(await store.renew(name, 'a', 800, 1_000)).toBe(true);
          expect(await store.claim(name, 'b', 800, 0)).toBe(false);
        }
        // Owner `a` stalls past its lease; `b` takes over.
        await sleep(1_000);
        expect(await store.renew(name, 'a', 800, 1_000)).toBe(false);
        // Expiry itself fences the owner, even before a replacement claims.
        expect(await store.complete(name, 'a', 60_000, 1, 'a')).toBe(false);
        expect(await store.fail(name, 'a', 60_000, 1, 'late', 'a')).toBe(false);
        expect(await store.claim(name, 'b', 5_000, 0)).toBe(true);
        // The stale owner can neither finish nor fail the run of `b`.
        expect(await store.complete(name, 'a', 60_000, 1, 'a')).toBe(false);
        expect(await store.fail(name, 'a', 60_000, 1, 'late', 'a')).toBe(false);
        const [row] = await store
          .readAll()
          .then(rows => rows.filter(r => r.job_name === name));
        expect(row?.lease_owner).toBe('b');
        expect(row?.run_count).toBe(0);
        expect(await store.complete(name, 'b', 60_000, 1, 'b')).toBe(true);
      });

      it('a renewal blocked by a row lock is cut by its statement timeout', async () => {
        const name = job('timeout');
        expect(await store.claim(name, 'a', 10_000, 0)).toBe(true);
        const locker = await admin.connect();
        try {
          await locker.query('BEGIN');
          await locker.query(
            `SELECT 1 FROM "JobLease" WHERE job_name = $1 FOR UPDATE`,
            [name]
          );
          const startedAt = Date.now();
          await expect(store.renew(name, 'a', 10_000, 300)).rejects.toThrow(
            /statement timeout/
          );
          expect(Date.now() - startedAt).toBeLessThan(3_000);
        } finally {
          await locker.query('ROLLBACK');
          locker.release();
        }
        // The timeout was transaction-local: the next statement on the pool runs unbounded.
        expect(await store.renew(name, 'a', 10_000, 1_000)).toBe(true);
      });

      it('three processes racing never overlap a run and keep one interval between runs', async () => {
        const name = job('race');
        const intervalMs = 300;
        const workers = Array.from({ length: 3 }, () =>
          spawnWorker(target.url, [
            'race',
            name,
            '40',
            String(intervalMs),
            '40',
          ])
        );
        const done = await Promise.all(
          workers.map(worker => waitForLine(worker, 'DONE', 60_000))
        );
        const completedByWorkers = done.reduce(
          (sum, line) => sum + Number(line.split(' ')[1]),
          0
        );

        const runs = (
          await admin.query<{ started: number; finished: number | null }>(
            `SELECT (EXTRACT(EPOCH FROM started_at) * 1000)::float8 AS started,
                    (EXTRACT(EPOCH FROM finished_at) * 1000)::float8 AS finished
             FROM "${runTable}" WHERE job_name = $1 ORDER BY started_at`,
            [name]
          )
        ).rows;
        const [row] = (
          await admin.query<{ run_count: number }>(
            `SELECT run_count FROM "JobLease" WHERE job_name = $1`,
            [name]
          )
        ).rows;

        expect(runs.length).toBeGreaterThan(3);
        expect(runs.every(run => run.finished !== null)).toBe(true);
        expect(row?.run_count).toBe(runs.length);
        expect(completedByWorkers).toBe(runs.length);
        for (let i = 1; i < runs.length; i += 1) {
          const previous = runs[i - 1];
          const current = runs[i];
          if (previous?.finished == null || current === undefined) {
            throw new Error('run row');
          }
          // No overlap, and the next run starts no earlier than one interval after the last ended.
          expect(current.started - previous.finished).toBeGreaterThanOrEqual(
            intervalMs - 5
          );
        }
      }, 90_000);

      it('a SIGKILLed owner blocks the job only until its lease expires', async () => {
        const name = job('kill');
        const leaseTtlMs = 2_000;
        const holder = spawnWorker(target.url, [
          'hold',
          name,
          String(leaseTtlMs),
        ]);
        await waitForLine(holder, 'CLAIMED', 20_000);

        // Alive and renewing: the lease outlives several TTLs.
        await sleep(leaseTtlMs * 2);
        expect(await store.claim(name, 'rescuer', 5_000, 0)).toBe(false);

        holder.kill('SIGKILL');
        const killedAt = Date.now();
        expect(await store.claim(name, 'rescuer', 5_000, 0)).toBe(false);
        let claimed = false;
        while (!claimed && Date.now() - killedAt < leaseTtlMs * 3) {
          await sleep(100);
          claimed = await store.claim(name, 'rescuer', 5_000, 0);
        }
        expect(claimed).toBe(true);
        expect(Date.now() - killedAt).toBeLessThanOrEqual(leaseTtlMs + 1_000);
      }, 60_000);
    });
  }
});
