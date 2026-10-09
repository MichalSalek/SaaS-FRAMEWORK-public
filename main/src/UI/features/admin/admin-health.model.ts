// UI/features/admin/admin-health.model.ts
// The ONE reading of the health snapshot: which services exist, their status,
// the overall verdict and their display names.
//
// DECISION (nie usuwaj tego komentarza) — S126, census P0: the health page
// said „Wszystkie systemy działają prawidłowo” while the dashboard widget said
// „Zdegradowany”. Both read the same query, but each built its own service
// list, names („Baza logów” vs „Event Log DB”), verdict and wording, so two
// snapshots taken a minute apart looked like two opinions about one moment.
// Every screen that shows health now goes through this file and prints the
// time of the measurement it shows (`measuredAt`); do not derive a verdict
// from the response anywhere else.

import type {
  ADMIN_DTO_API_V1,
  ServiceHealthCheck,
  ServiceStatus,
} from '@kernel/models/admin/admin.dto';

export type HealthResponse = ADMIN_DTO_API_V1['ADMIN_HEALTH']['RESPONSE'];

export interface ServiceCard {
  name: string;
  status: ServiceStatus;
  responseTime: number | null;
}

/** Backend service names → `admin.health` label keys. */
const SERVICE_LABEL_KEY = {
  Backend: 'service.backend',
  'Database (main)': 'service.database',
  'Event Log DB': 'service.eventLog',
  'Serwis email': 'service.email',
} as const;

export type ServiceLabelKey =
  (typeof SERVICE_LABEL_KEY)[keyof typeof SERVICE_LABEL_KEY];

/** Label key of a known service, or null when the name is shown as it comes. */
export function serviceLabelKey(name: string): ServiceLabelKey | null {
  return Object.prototype.hasOwnProperty.call(SERVICE_LABEL_KEY, name)
    ? SERVICE_LABEL_KEY[name as keyof typeof SERVICE_LABEL_KEY]
    : null;
}

export function formatUptime(uptimeSeconds: number): string {
  const days = Math.floor(uptimeSeconds / 86_400);
  const hours = Math.floor((uptimeSeconds % 86_400) / 3_600);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  const minutes = Math.floor((uptimeSeconds % 3_600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatLastCheck(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('pl-PL');
}

function buildServiceCards(health: HealthResponse): ServiceCard[] {
  const cards: ServiceCard[] = [];

  cards.push({
    name: 'Backend',
    status: 'healthy',
    // A cold process has no response-time samples yet (empty buffer): no value
    // instead of a pretended 0 ms.
    responseTime:
      health.performance.total_requests_tracked > 0
        ? health.performance.avg_response_time_ms
        : null,
  });

  cards.push({
    name: health.database.name,
    status: health.database.status,
    responseTime: health.database.latency_ms,
  });

  cards.push({
    name: health.event_log_db.name,
    status: health.event_log_db.status,
    responseTime: health.event_log_db.latency_ms,
  });

  // Every external service, not the first two: the menu counter counts each
  // degraded one, so every screen must see the same set.
  health.external_services.forEach((svc: ServiceHealthCheck) => {
    cards.push({
      name: svc.name,
      status: svc.status,
      responseTime: svc.latency_ms,
    });
  });

  return cards;
}

/** The verdict of one snapshot. */
export interface HealthVerdict {
  cards: ServiceCard[];
  overall: ServiceStatus;
  /** Clock time of the snapshot the verdict was computed from. */
  measuredAt: string;
}

function deriveOverallStatus(cards: readonly ServiceCard[]): ServiceStatus {
  if (cards.some(c => c.status === 'down')) {
    return 'down';
  }
  if (cards.some(c => c.status === 'degraded')) {
    return 'degraded';
  }
  return 'healthy';
}

/** Everything a screen needs to state the health verdict. */
export function readHealthVerdict(health: HealthResponse): HealthVerdict {
  const cards = buildServiceCards(health);
  return {
    cards,
    overall: deriveOverallStatus(cards),
    measuredAt: formatLastCheck(health.checked_at),
  };
}
