import type { PoolConfig } from 'pg';

// DECISION: `connectionTimeoutMillis` is set for NEON SCALE-TO-ZERO, not network time. When compute
// is asleep the first connection must wait for the instance to wake; at the former 10 s production
// returned `Connection terminated due to connection timeout` on cold starts (public `track-crawler`
// returned 500 instead of waiting). The larger budget fits a wake-up with margin and does NOT
// lengthen queries: `statement_timeout` / `query_timeout` bound them independently.
//
// `keepAlive` keeps TCP alive so intermediaries (Render -> Neon proxy) do not drop idle pooled
// connections (`Connection terminated unexpectedly`).
const NEON_COLD_START_CONNECT_BUDGET_MS = 20_000;
const APP_LOGS_COLD_START_CONNECT_BUDGET_MS = 15_000;

const KEEP_ALIVE = Object.freeze({
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
});

export const MAIN_DATABASE_POOL_TUNING = Object.freeze({
  max: 5,
  min: 0,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: NEON_COLD_START_CONNECT_BUDGET_MS,
  statement_timeout: 30_000,
  query_timeout: 35_000,
  idle_in_transaction_session_timeout: 30_000,
  application_name: 'nailfolio-api',
  ...KEEP_ALIVE,
} satisfies Omit<PoolConfig, 'connectionString'>);

export const APP_LOGS_DATABASE_POOL_TUNING = Object.freeze({
  max: 2,
  min: 0,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: APP_LOGS_COLD_START_CONNECT_BUDGET_MS,
  statement_timeout: 15_000,
  query_timeout: 20_000,
  idle_in_transaction_session_timeout: 15_000,
  application_name: 'nailfolio-app-logs',
  ...KEEP_ALIVE,
} satisfies Omit<PoolConfig, 'connectionString'>);
