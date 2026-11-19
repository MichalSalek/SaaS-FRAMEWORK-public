/**
 * The SQL of the job lease, kept free of imports so the production store
 * (job-lease.store.ts over Prisma) and the real-Postgres tests that spawn
 * separate processes (tests/postgres/job-lease.test.ts) execute the SAME text.
 *
 * DECISION: every operation is ONE statement that decides and writes at once, and every time
 * comes from the database clock (`now()`), never from a process. That is what keeps the lease
 * correct under PgBouncer transaction pooling (Neon `-pooler`): a statement never spans two
 * backends, and two processes with skewed clocks still agree on expiry. Session state of any
 * kind (pg_try_advisory_lock + pg_advisory_unlock as two calls) is NOT allowed here: the unlock
 * can land on another pooled backend and miss. Do not split a claim into "read, then update".
 */

const ms = (param: string): string =>
  `(${param}::double precision * interval '1 millisecond')`;

const epochMs = (column: string): string =>
  `(EXTRACT(EPOCH FROM ${column}) * 1000)::float8`;

/**
 * Claim a due job. Inserts the row on the very first claim (due immediately), otherwise takes
 * the lease only when the job is due (`due_at <= now() + early`) AND no live lease exists.
 * ON CONFLICT locks the conflicting row and re-evaluates the WHERE against its latest version,
 * so of N concurrent claimers exactly one gets a row back.
 * Params: $1 job name, $2 owner token, $3 lease TTL ms, $4 early window ms.
 */
export const CLAIM_JOB_SQL = `
INSERT INTO "JobLease" ("job_name", "due_at", "lease_owner", "lease_expires_at", "last_started_at", "updated_at")
VALUES ($1, now(), $2, now() + ${ms('$3')}, now(), now())
ON CONFLICT ("job_name") DO UPDATE SET
  "lease_owner" = EXCLUDED."lease_owner",
  "lease_expires_at" = EXCLUDED."lease_expires_at",
  "last_started_at" = EXCLUDED."last_started_at",
  "updated_at" = EXCLUDED."updated_at"
WHERE "JobLease"."due_at" <= now() + ${ms('$4')}
  AND ("JobLease"."lease_expires_at" IS NULL OR "JobLease"."lease_expires_at" <= now())
RETURNING "job_name", ${epochMs('"lease_expires_at"')} AS lease_expires_at_ms
`;

/**
 * Extend a live lease. Only the current owner, and only while the lease has not expired: an
 * expired lease may already belong to someone else's next claim, so it is reported as lost.
 * Params: $1 job name, $2 owner token, $3 lease TTL ms.
 */
export const RENEW_JOB_SQL = `
UPDATE "JobLease" SET
  "lease_expires_at" = now() + ${ms('$3')},
  "updated_at" = now()
WHERE "job_name" = $1 AND "lease_owner" = $2 AND "lease_expires_at" > now()
RETURNING ${epochMs('"lease_expires_at"')} AS lease_expires_at_ms
`;

/**
 * Finish a run: next due = now + interval (a job late by days runs ONCE, not once per missed
 * interval), lease released. Fenced by the owner token: an owner whose lease was taken over
 * writes nothing.
 * Params: $1 job name, $2 owner token, $3 interval ms, $4 duration ms, $5 instance id.
 */
export const COMPLETE_JOB_SQL = `
UPDATE "JobLease" SET
  "due_at" = now() + ${ms('$3')},
  "lease_owner" = NULL,
  "lease_expires_at" = NULL,
  "last_completed_at" = now(),
  "last_duration_ms" = $4::int,
  "last_error" = NULL,
  "last_instance" = $5,
  "consecutive_failures" = 0,
  "run_count" = "run_count" + 1,
  "updated_at" = now()
WHERE "job_name" = $1 AND "lease_owner" = $2 AND "lease_expires_at" > now()
RETURNING ${epochMs('"due_at"')} AS due_at_ms
`;

/**
 * Record a failed run: retry after `retry` ms, lease released, failure counted. Fenced like
 * COMPLETE_JOB_SQL.
 * Params: $1 job name, $2 owner token, $3 retry ms, $4 duration ms, $5 error text, $6 instance id.
 */
export const FAIL_JOB_SQL = `
UPDATE "JobLease" SET
  "due_at" = now() + ${ms('$3')},
  "lease_owner" = NULL,
  "lease_expires_at" = NULL,
  "last_duration_ms" = $4::int,
  "last_error" = $5,
  "last_instance" = $6,
  "consecutive_failures" = "consecutive_failures" + 1,
  "updated_at" = now()
WHERE "job_name" = $1 AND "lease_owner" = $2 AND "lease_expires_at" > now()
RETURNING ${epochMs('"due_at"')} AS due_at_ms
`;

/** Every row with times as epoch milliseconds, plus the database clock. The table holds one row per job. */
export const READ_JOBS_SQL = `
SELECT "job_name",
  ${epochMs('"due_at"')} AS due_at_ms,
  "lease_owner",
  ${epochMs('"lease_expires_at"')} AS lease_expires_at_ms,
  ${epochMs('"last_started_at"')} AS last_started_at_ms,
  ${epochMs('"last_completed_at"')} AS last_completed_at_ms,
  "last_duration_ms",
  "last_error",
  "last_instance",
  "consecutive_failures",
  "run_count",
  ${epochMs('now()')} AS db_now_ms
FROM "JobLease"
ORDER BY "job_name"
LIMIT 200
`;

export type ClaimRow = { job_name: string; lease_expires_at_ms: number };
export type RenewRow = { lease_expires_at_ms: number };
export type FinishRow = { due_at_ms: number };
export type JobLeaseRow = {
  job_name: string;
  due_at_ms: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  last_started_at_ms: number | null;
  last_completed_at_ms: number | null;
  last_duration_ms: number | null;
  last_error: string | null;
  last_instance: string | null;
  consecutive_failures: number;
  run_count: number;
  db_now_ms: number;
};

/** Transaction-local statement timeout; the value is an integer of milliseconds, never user input. */
export const statementTimeoutSql = (timeoutMs: number): string =>
  `SET LOCAL statement_timeout = ${String(Math.max(1, Math.floor(timeoutMs)))}`;
