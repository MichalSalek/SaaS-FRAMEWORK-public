import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { EVENT_DESCRIPTIONS_PL } from '@kernel/domain/event-log/event-log-descriptions.config';
import type { AuditTrailEntry } from './hooks/useAdminAuditTrail';

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

function escapeCSVField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportToCSV(entries: AuditTrailEntry[]): void {
  const header =
    'Timestamp,Namespace,Event,Admin Name,Admin Email,Target,Details\n';
  const rows = entries
    .map(e =>
      [
        escapeCSVField(e.created_at),
        escapeCSVField(e.namespace),
        escapeCSVField(e.event_name),
        escapeCSVField(e.admin_name ?? ''),
        escapeCSVField(e.admin_email ?? ''),
        escapeCSVField(e.target_info ?? ''),
        escapeCSVField(e.details),
      ].join(',')
    )
    .join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
