/**
 * One in-process snapshot of the service probes behind ADMIN_HEALTH.
 * The attention-badge poll (60s) and the health page share it, so the
 * sidebar and the dashboard cannot disagree, and a badge refresh does
 * not open a fresh TLS connection on every hit.
 */

import type { ServiceHealthCheck } from '@kernel/models/admin/admin.dto';
import { TIME } from '@kernel/application/constants.config';
import { createCache } from '@app/cache/cache.utils';
import {
  SKIPPED_HEALTH_CHECK_MESSAGE,
  checkCloudinaryHealth,
  checkDatabaseHealth,
  checkEmailServiceHealth,
  checkEventLogDbHealth,
  checkStripeHealth,
} from '@app/health/health-check.utils';

export type ServiceHealthSnapshot = {
  database: ServiceHealthCheck;
  event_log_db: ServiceHealthCheck;
  external_services: ServiceHealthCheck[];
};

const SNAPSHOT_TTL_MS = TIME.MS_PER_MINUTE;
const SNAPSHOT_CACHE_KEY = 'service_health';

const snapshotCache = createCache<ServiceHealthSnapshot>(SNAPSHOT_TTL_MS, 1);

let inFlight: Promise<ServiceHealthSnapshot> | null = null;

const settle = (
  result: PromiseSettledResult<ServiceHealthCheck>,
  fallbackName: string
): ServiceHealthCheck => {
  if (result.status === 'fulfilled') {
    return result.value;
  }
  return {
    name: fallbackName,
    status: 'down',
    latency_ms: null,
    message:
      result.reason instanceof Error ? result.reason.message : 'Check failed',
  };
};

const collectServiceHealthSnapshot =
  async (): Promise<ServiceHealthSnapshot> => {
    const [database, eventLogDb, stripe, cloudinary, email] =
      await Promise.allSettled([
        checkDatabaseHealth(),
        checkEventLogDbHealth(),
        checkStripeHealth(),
        checkCloudinaryHealth(),
        checkEmailServiceHealth(),
      ]);

    const external_services = [
      settle(stripe, 'Stripe'),
      settle(cloudinary, 'Cloudinary'),
      settle(email, 'Serwis email'),
    ].filter(service => service.message !== SKIPPED_HEALTH_CHECK_MESSAGE);

    return {
      database: settle(database, 'Database (main)'),
      event_log_db: settle(eventLogDb, 'Event Log DB'),
      external_services,
    };
  };

/** Last probe set, refreshed at most once per minute. Concurrent callers share one run. */
export const getCachedServiceHealthSnapshot =
  async (): Promise<ServiceHealthSnapshot> => {
    const cached = snapshotCache.get(SNAPSHOT_CACHE_KEY);
    if (cached) {
      return cached;
    }
    if (inFlight) {
      return inFlight;
    }

    const run = collectServiceHealthSnapshot().then(snapshot => {
      snapshotCache.set(SNAPSHOT_CACHE_KEY, snapshot);
      return snapshot;
    });
    inFlight = run;
    try {
      return await run;
    } finally {
      if (inFlight === run) {
        inFlight = null;
      }
    }
  };

/** How many probed services are degraded or down. Skipped services are already gone. */
export const countServiceHealthIssues = (
  snapshot: ServiceHealthSnapshot
): number => {
  const services = [
    snapshot.database,
    snapshot.event_log_db,
    ...snapshot.external_services,
  ];
  return services.filter(
    service => service.status === 'degraded' || service.status === 'down'
  ).length;
};
