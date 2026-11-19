import { DB_CLIENT } from '@app/db/db.client';
import { createJobLeaseStore, type SqlExec } from './job-lease.store';
import { statementTimeoutSql } from './job-lease.sql';

// DECISION: `$queryRawUnsafe` with positional parameters, because the lease SQL is one shared text
// (job-lease.sql.ts) that the multi-process real-Postgres test runs through `pg` verbatim. Values
// are always bound parameters, never concatenated; the text has no interpolated input.
const prismaExec: SqlExec = async <T>(
  sql: string,
  params: ReadonlyArray<string | number | null>,
  options?: { statementTimeoutMs?: number }
) => {
  if (options?.statementTimeoutMs === undefined) {
    return DB_CLIENT.use.$queryRawUnsafe<T[]>(sql, ...params);
  }
  // Batch transaction: one pooled backend for SET LOCAL + the statement, released at COMMIT.
  const [, rows] = await DB_CLIENT.use.$transaction([
    DB_CLIENT.use.$executeRawUnsafe(
      statementTimeoutSql(options.statementTimeoutMs)
    ),
    DB_CLIENT.use.$queryRawUnsafe<T[]>(sql, ...params),
  ]);
  return rows;
};

export const prismaJobLeaseStore = createJobLeaseStore(prismaExec);
