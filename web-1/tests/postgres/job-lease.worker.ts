// A separate OS process for tests/postgres/job-lease.test.ts: runs the PRODUCTION lease code
// (job-runner.ts + job-lease.store.ts + job-lease.sql.ts) through its own `pg` pool.
//   race <job> <rounds> <intervalMs> <bodyMs>  claim/run in a loop, log every run to the run table
//   hold <job> <leaseTtlMs>                     claim, print CLAIMED, keep renewing until killed
import { Pool } from 'pg';
import {
  createJobLeaseStore,
  type SqlExec,
} from '../../src/application/scheduler/job-lease.store';
import { runLeasedJob } from '../../src/application/scheduler/job-runner';

const [mode, jobName, a, b, c] = process.argv.slice(2);
const url = process.env.JOB_LEASE_WORKER_URL;
const runTable = process.env.JOB_LEASE_RUN_TABLE;
if (!url || !runTable || !mode || !jobName) {
  throw new Error('worker: missing arguments');
}
const pool = new Pool({ connectionString: url, max: 4 });
const exec: SqlExec = async <T>(
  sql: string,
  params: ReadonlyArray<string | number | null>
) => (await pool.query(sql, [...params])).rows as T[];
const store = createJobLeaseStore(exec);
const instance = `worker:${process.pid}:${Date.now()}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  if (mode === 'race') {
    const rounds = Number(a);
    const intervalMs = Number(b);
    const bodyMs = Number(c);
    let completed = 0;
    for (let round = 0; round < rounds; round += 1) {
      const outcome = await runLeasedJob({
        job: {
          name: jobName,
          intervalMs,
          leaseTtlMs: 5_000,
          run: async () => {
            await pool.query(
              `INSERT INTO "${runTable}" (job_name, owner, started_at) VALUES ($1, $2, clock_timestamp())`,
              [jobName, instance]
            );
            await sleep(bodyMs);
            await pool.query(
              `UPDATE "${runTable}" SET finished_at = clock_timestamp() WHERE owner = $1 AND finished_at IS NULL`,
              [instance]
            );
          },
        },
        store,
        owner: `${instance}#${round}`,
        instance,
        earlyMs: 0,
        failureRetryMs: intervalMs,
      });
      if (outcome.status === 'completed' && !outcome.fenced) {
        completed += 1;
      }
      await sleep(50 + Math.floor(Math.random() * 50));
    }
    process.stdout.write(`DONE ${completed}\n`);
    await pool.end();
    return;
  }
  if (mode === 'hold') {
    const leaseTtlMs = Number(a);
    await runLeasedJob({
      job: {
        name: jobName,
        intervalMs: 60_000,
        leaseTtlMs,
        run: async () => {
          process.stdout.write('CLAIMED\n');
          await new Promise(() => undefined);
        },
      },
      store,
      owner: `${instance}#hold`,
      instance,
      earlyMs: 0,
      failureRetryMs: 60_000,
    });
  }
};

void main();
