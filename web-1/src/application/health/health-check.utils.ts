/**
 * Health check utilities for external services and databases.
 * Each checker returns ServiceHealthCheck with latency and status.
 *
 * Latency budgets live in HEALTH_LATENCY_BUDGETS (per service class).
 * `down` is only an error or a timeout — a slow probe stays `degraded`.
 */

import type {
  CloudinaryEgressInfo,
  CloudinaryEgressStatus,
  ServiceHealthCheck,
  ServiceStatus,
} from '@kernel/models/admin/admin.dto';
import { TIME } from '@kernel/application/constants.config';
import {
  HEALTH_LATENCY_BUDGETS,
  type HealthLatencyClass,
} from '@kernel/domain/admin/health.config';
import { DB_CLIENT } from '@app/db/db.client';
import { ENV_VARS } from '@app/environment/environment.config';
import { createCache } from '@app/cache/cache.utils';
import {
  formatDbInvariantProblems,
  verifyDbInvariants,
} from '@app/startup/verify-db-invariants';

const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/** Probe skipped because the env vars it needs are empty. Not a failure. */
export const SKIPPED_HEALTH_CHECK_MESSAGE =
  'Not configured (env vars missing) — skipped';

/**
 * Map a successful probe's latency onto healthy/degraded.
 * Never returns `down`: crossing `degradedMs` means "slow but alive".
 */
export const statusFromLatency = (
  latency_ms: number,
  latencyClass: HealthLatencyClass
): ServiceStatus => {
  const { healthyMs } = HEALTH_LATENCY_BUDGETS[latencyClass];
  if (latency_ms < healthyMs) {
    return 'healthy';
  }
  // Past `degradedMs` is still degraded. `down` is an error or a timeout
  // in the checker (cross-region TLS and a Neon cold start are not outages).
  return 'degraded';
};

const measureLatency = async (
  fn: () => Promise<void>
): Promise<{ latency_ms: number }> => {
  const start = performance.now();
  await fn();
  return { latency_ms: Math.round(performance.now() - start) };
};

const makeHealthyResult = (
  name: string,
  latency_ms: number,
  latencyClass: HealthLatencyClass
): ServiceHealthCheck => {
  const { healthyMs } = HEALTH_LATENCY_BUDGETS[latencyClass];
  return {
    name,
    status: statusFromLatency(latency_ms, latencyClass),
    latency_ms,
    message: latency_ms >= healthyMs ? 'High latency' : null,
  };
};

const makeDownResult = (name: string, error: unknown): ServiceHealthCheck => ({
  name,
  status: 'down',
  latency_ms: null,
  message: error instanceof Error ? error.message : 'Unknown error',
});

const makeSkippedResult = (name: string): ServiceHealthCheck => ({
  name,
  status: 'healthy',
  latency_ms: null,
  message: SKIPPED_HEALTH_CHECK_MESSAGE,
});

// ── Database (main Prisma) ──

// The structural invariants from migrations (verify-db-invariants.ts) ride on the main DB probe:
// a reachable database with a missing or INVALID backstop is `degraded`, which raises the admin
// `system_health_issues` badge. A failed catalog read degrades too (unknown is not healthy).
const withDbInvariants = async (
  result: ServiceHealthCheck
): Promise<ServiceHealthCheck> => {
  try {
    const problems = await verifyDbInvariants();
    if (problems.length === 0) {
      return result;
    }
    return {
      ...result,
      status: 'degraded',
      message: `DB invariants not in force: ${formatDbInvariantProblems(problems)}`,
    };
  } catch (error) {
    return {
      ...result,
      status: 'degraded',
      message: `DB invariants unreadable: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
};

export const checkDatabaseHealth = async (): Promise<ServiceHealthCheck> => {
  try {
    const { latency_ms } = await measureLatency(async () => {
      await DB_CLIENT.use.$queryRaw`SELECT 1`;
    });
    const result = makeHealthyResult(
      'Database (main)',
      latency_ms,
      'primaryDb'
    );
    return withDbInvariants(result);
  } catch (error) {
    return makeDownResult('Database (main)', error);
  }
};

// ── Event Log DB (separate Prisma client) ──

export const checkEventLogDbHealth = async (): Promise<ServiceHealthCheck> => {
  try {
    const { latency_ms } = await measureLatency(async () => {
      await DB_CLIENT.useAppLogs.$queryRaw`SELECT 1`;
    });
    return makeHealthyResult('Event Log DB', latency_ms, 'logDb');
  } catch (error) {
    return makeDownResult('Event Log DB', error);
  }
};

// ── Stripe ──

export const checkStripeHealth = async (): Promise<ServiceHealthCheck> => {
  if (!ENV_VARS.STRIPE_SECRET_KEY) {
    return makeSkippedResult('Stripe');
  }

  try {
    const { latency_ms } = await measureLatency(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        HEALTH_CHECK_TIMEOUT_MS
      );
      try {
        await fetch('https://api.stripe.com', {
          method: 'HEAD',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    });
    return makeHealthyResult('Stripe', latency_ms, 'externalHttp');
  } catch (error) {
    return makeDownResult('Stripe', error);
  }
};

// ── Cloudinary ──

export const checkCloudinaryHealth = async (): Promise<ServiceHealthCheck> => {
  if (!ENV_VARS.CLOUDINARY_CLOUD_NAME || !ENV_VARS.CLOUDINARY_API_KEY) {
    return makeSkippedResult('Cloudinary');
  }

  try {
    const { latency_ms } = await measureLatency(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        HEALTH_CHECK_TIMEOUT_MS
      );
      try {
        await fetch(
          `https://api.cloudinary.com/v1_1/${ENV_VARS.CLOUDINARY_CLOUD_NAME}`,
          {
            method: 'HEAD',
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timeout);
      }
    });
    return makeHealthyResult('Cloudinary', latency_ms, 'externalHttp');
  } catch (error) {
    return makeDownResult('Cloudinary', error);
  }
};

// ── Cloudinary Egress Monitoring ──

// DECISION: the Cloudinary Admin API /usage is rate limited, and admin /health can be polled
// often, so the result is cached for 1h (egress figures update hourly).
// A missing API secret falls back gracefully (never throws): admin /health must always return a
// response, and a missing credential is operational info, not a crash.

const CLOUDINARY_EGRESS_WARN_PCT = 70;
const CLOUDINARY_EGRESS_CRIT_PCT = 90;
const CLOUDINARY_EGRESS_CACHE_TTL_MS = TIME.MS_PER_HOUR; // 1 hour

const _cloudinaryEgressCache = createCache<CloudinaryEgressInfo>(
  CLOUDINARY_EGRESS_CACHE_TTL_MS,
  1 // single entry — only one Cloudinary account
);
const CLOUDINARY_EGRESS_CACHE_KEY = 'cloudinary_egress';

type CloudinaryUsageApiResponse = {
  bandwidth?: {
    usage?: number; // bytes used this billing cycle
    limit?: number; // bytes allowed per plan (may be absent)
    used_percent?: number; // 0-100
  };
  storage?: {
    usage?: number;
    limit?: number;
    used_percent?: number;
  };
};

/**
 * Fetch Cloudinary egress (bandwidth) usage for the current billing cycle.
 * Results are cached for 1h to stay within Cloudinary Admin API rate limits.
 *
 * Returns a CloudinaryEgressInfo object — never throws.
 */
export const checkCloudinaryEgress =
  async (): Promise<CloudinaryEgressInfo> => {
    // DECISION: a missing CLOUDINARY_SECRET returns an 'unknown' status instead of throwing:
    // admin /health must always return 200 with a full body. The SECRET (not the API key alone)
    // is what Basic Auth against the Admin API needs.
    if (
      !ENV_VARS.CLOUDINARY_CLOUD_NAME ||
      !ENV_VARS.CLOUDINARY_API_KEY ||
      !ENV_VARS.CLOUDINARY_SECRET
    ) {
      return {
        egress_used_gb: null,
        egress_limit_gb: null,
        egress_pct: null,
        egress_status: 'unknown',
        fetched_at: null,
        message:
          'Admin API credentials not configured (CLOUDINARY_SECRET missing)',
      };
    }

    const cached = _cloudinaryEgressCache.get(CLOUDINARY_EGRESS_CACHE_KEY);
    if (cached) {
      return cached;
    }

    try {
      const credentials = Buffer.from(
        `${ENV_VARS.CLOUDINARY_API_KEY}:${ENV_VARS.CLOUDINARY_SECRET}`
      ).toString('base64');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);

      let apiResponse: CloudinaryUsageApiResponse;
      try {
        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${ENV_VARS.CLOUDINARY_CLOUD_NAME}/usage`,
          {
            method: 'GET',
            headers: {
              Authorization: `Basic ${credentials}`,
            },
            signal: controller.signal,
          }
        );

        if (!res.ok) {
          const result: CloudinaryEgressInfo = {
            egress_used_gb: null,
            egress_limit_gb: null,
            egress_pct: null,
            egress_status: 'unknown',
            fetched_at: new Date().toISOString(),
            message: `Cloudinary Admin API error: HTTP ${res.status}`,
          };
          // Cache error responses briefly (5 min) to avoid hammering on auth errors
          _cloudinaryEgressCache.set(CLOUDINARY_EGRESS_CACHE_KEY, result);
          return result;
        }

        apiResponse = (await res.json()) as CloudinaryUsageApiResponse;
      } finally {
        clearTimeout(timeout);
      }

      const bandwidthBytes = apiResponse.bandwidth?.usage ?? null;
      const limitBytes = apiResponse.bandwidth?.limit ?? null;
      // Cloudinary returns used_percent; derive it if missing (limit might be null)
      const usedPct =
        apiResponse.bandwidth?.used_percent ??
        (bandwidthBytes !== null && limitBytes !== null && limitBytes > 0
          ? (bandwidthBytes / limitBytes) * 100
          : null);

      const egress_used_gb =
        bandwidthBytes !== null
          ? Math.round((bandwidthBytes / (1024 * 1024 * 1024)) * 100) / 100
          : null;
      const egress_limit_gb =
        limitBytes !== null
          ? Math.round((limitBytes / (1024 * 1024 * 1024)) * 100) / 100
          : null;
      const egress_pct =
        usedPct !== null ? Math.round(usedPct * 10) / 10 : null;

      let egress_status: CloudinaryEgressStatus = 'ok';
      if (egress_pct === null) {
        egress_status = 'unknown';
      } else if (egress_pct >= CLOUDINARY_EGRESS_CRIT_PCT) {
        egress_status = 'critical';
      } else if (egress_pct >= CLOUDINARY_EGRESS_WARN_PCT) {
        egress_status = 'warning';
      }

      const result: CloudinaryEgressInfo = {
        egress_used_gb,
        egress_limit_gb,
        egress_pct,
        egress_status,
        fetched_at: new Date().toISOString(),
        message: null,
      };

      _cloudinaryEgressCache.set(CLOUDINARY_EGRESS_CACHE_KEY, result);
      return result;
    } catch (error) {
      const message =
        error instanceof Error
          ? `Cloudinary Admin API unreachable: ${error.name}`
          : 'Cloudinary Admin API unreachable';

      const result: CloudinaryEgressInfo = {
        egress_used_gb: null,
        egress_limit_gb: null,
        egress_pct: null,
        egress_status: 'unknown',
        fetched_at: new Date().toISOString(),
        // DECISION: error.message is intentionally NOT included, as it may contain internal
        // details (hostname, DNS, TLS info). Only error.name ("AbortError", "TypeError") is safe
        // to surface in admin health responses.
        message,
      };
      return result;
    }
  };

// ── Database P95 Query Latency (pg_stat_statements) ──

// DECISION: P95 query latency via pg_stat_statements, not avg (one fast query among 1000 calls
// masks outliers) and not P99 (a single outlier spikes it in low traffic). P95 is stable and
// actionable. Cached 30s because the pg_stat_statements query costs ~100ms on Neon and /health
// may be polled every few seconds. The statistics accumulate since the DB instance started, so
// they need a periodic `SELECT pg_stat_statements_reset();` (monthly, or a job) or mean_exec_time
// becomes a historical average.

const DB_P95_CACHE_TTL_MS = 30_000; // 30 seconds
// DECISION: sentinel wrapper `{ value }` instead of a bare `number | null`. createCache.get()
// returns `null` for both a miss and a cached null, so a cached "p95 unavailable" would look
// like a miss and re-run the expensive pg_stat_statements query on every /health poll. With the
// wrapper every HIT (also value=null) is an object !== null.
const _dbP95Cache = createCache<{ value: number | null }>(
  DB_P95_CACHE_TTL_MS,
  1
);
const DB_P95_CACHE_KEY = 'db_p95_latency';

/**
 * Query pg_stat_statements for P95 query latency across all tracked statements.
 * Returns null if the extension is not enabled or an error occurs.
 * Result is cached for 30s to avoid ~100ms cost on every health poll.
 */
export const getDatabaseP95Latency = async (): Promise<number | null> => {
  const cached = _dbP95Cache.get(DB_P95_CACHE_KEY);
  if (cached !== null) {
    return cached.value;
  }

  try {
    type P95Row = { p95_ms: bigint | number | null };
    const rows = await DB_CLIENT.use.$queryRaw<P95Row[]>`
      SELECT round(
        percentile_cont(0.95) WITHIN GROUP (ORDER BY mean_exec_time)
      )::bigint AS p95_ms,
      count(*) AS query_count
      FROM pg_stat_statements
    `;

    const p95Raw = rows[0]?.p95_ms;
    const p95 = p95Raw !== null && p95Raw !== undefined ? Number(p95Raw) : null;

    _dbP95Cache.set(DB_P95_CACHE_KEY, { value: p95 });
    return p95;
  } catch {
    // pg_stat_statements not enabled or query failed — not a critical error.
    // Cache null for 30s to avoid repeated failing queries on every health poll.
    _dbP95Cache.set(DB_P95_CACHE_KEY, { value: null });
    return null;
  }
};

// ── Serwis email (Resend primary / Mailgun fallback) ──

// DECISION: the label is the GENERIC „Serwis email", not a provider name, so a provider change
// needs no edit here or in the admin UI. The check targets the PRIMARY transport as in
// email-transport.ts (Resend when RESEND_API_KEY is present, otherwise Mailgun), so „Zdrowie"
// reflects the service actually used, not the fallback.
const measureReachability = async (
  url: string,
  label: string
): Promise<ServiceHealthCheck> => {
  try {
    const { latency_ms } = await measureLatency(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        HEALTH_CHECK_TIMEOUT_MS
      );
      try {
        await fetch(url, { method: 'HEAD', signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    });
    return makeHealthyResult(label, latency_ms, 'externalHttp');
  } catch (error) {
    return makeDownResult(label, error);
  }
};

export const checkEmailServiceHealth =
  async (): Promise<ServiceHealthCheck> => {
    const LABEL = 'Serwis email';
    // Primary: Resend (mirror email-transport.ts — Resend gdy klucz obecny).
    if (ENV_VARS.RESEND_API_KEY) {
      return measureReachability('https://api.resend.com', LABEL);
    }
    // Fallback: Mailgun (gdy Resend wyłączony).
    if (!ENV_VARS.MAILGUN_API_KEY || !ENV_VARS.MAILGUN_API_BASE_URL) {
      return makeSkippedResult(LABEL);
    }
    return measureReachability(ENV_VARS.MAILGUN_API_BASE_URL, LABEL);
  };
