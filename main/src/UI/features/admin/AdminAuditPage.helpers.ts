import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { EVENT_DESCRIPTIONS_PL } from '@kernel/domain/event-log/event-log-descriptions.config';
import type { AuditTrailEntry } from './hooks/useAdminAuditTrail';
import { downloadCSV } from './admin-csv';

export const PAGE_SIZE = 15;

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_LABEL_KEY = {
  low: 'severity.low',
  medium: 'severity.medium',
  high: 'severity.high',
  critical: 'severity.critical',
} as const satisfies Record<Severity, string>;

export const NAMESPACE_LABEL_KEY = {
  [EventLogTypeValue.ACCOUNT]: 'namespace.ACCOUNT',
  [EventLogTypeValue.LOGIN]: 'namespace.LOGIN',
  [EventLogTypeValue.GALLERY]: 'namespace.GALLERY',
  [EventLogTypeValue.ADMIN]: 'namespace.ADMIN',
  [EventLogTypeValue.DOMAIN]: 'namespace.DOMAIN',
  [EventLogTypeValue.EMAIL]: 'namespace.EMAIL',
} as const;

export function isNamespaceKey(
  value: string
): value is keyof typeof NAMESPACE_LABEL_KEY {
  return Object.prototype.hasOwnProperty.call(NAMESPACE_LABEL_KEY, value);
}

/** Polish sentence from the kernel catalog. Unknown names stay unlabeled. */
export function describeAdminEvent(eventName: string): string | null {
  if (Object.prototype.hasOwnProperty.call(EVENT_DESCRIPTIONS_PL, eventName)) {
    return EVENT_DESCRIPTIONS_PL[
      eventName as keyof typeof EVENT_DESCRIPTIONS_PL
    ];
  }
  return null;
}

export function deriveSeverity(namespace: string): Severity {
  if (namespace === EventLogTypeValue.ADMIN) {
    return 'high';
  }
  if (namespace === EventLogTypeValue.DOMAIN) {
    return 'medium';
  }
  if (namespace === EventLogTypeValue.LOGIN) {
    return 'low';
  }
  return 'low';
}

/* Mapa domenowa severity -> token roli, karmi <StatusPill color>. Wizualna
 * receptura pigułki (tint / rama / tekst) żyje w komponencie; tutaj zostaje
 * wyłącznie znaczenie: co w tym produkcie jest ostrzeżeniem, a co awarią. */
export function getSeverityColor(severity: Severity): string {
  const map: Record<Severity, string> = {
    low: 'var(--color-info)',
    medium: 'var(--color-warning)',
    high: 'var(--color-error)',
    critical: 'var(--color-error)',
  };
  return map[severity];
}

export function exportToCSV(entries: AuditTrailEntry[]): void {
  downloadCSV(
    'audit-log',
    [
      'Timestamp',
      'Namespace',
      'Event',
      'Admin Name',
      'Admin Email',
      'Target',
      'Details',
    ],
    entries.map(e => [
      e.created_at,
      e.namespace,
      e.event_name,
      e.admin_name ?? '',
      e.admin_email ?? '',
      e.target_info ?? '',
      e.details,
    ])
  );
}
