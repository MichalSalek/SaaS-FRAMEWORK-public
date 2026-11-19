// UI/features/support/supportStatus.helpers.ts
// Status helpers and the translator type shared by the support screens.

import type { SupportThreadStatus } from '@kernel/models/support/support.dto';

/* ============================================================
 *  Types & shared helpers
 * ============================================================ */

// SSOT typu i formatera dat: supportDate.helpers.ts (re-export dla konsumentow parts).
import type { TSupport } from './supportDate.helpers';

export type { TSupport };

/**
 * Support status → semantic CSS color token for the OKLCH-tinted <StatusPill>.
 * Domain map stays per-domain; the visual recipe lives in components/StatusPill.
 * Mirrors the former statusPillOpen/Resolved/Closed variant tints:
 *   OPEN → success, RESOLVED → info, CLOSED → text-secondary (neutral).
 */
export function getSupportStatusColor(status: SupportThreadStatus): string {
  switch (status) {
    case 'OPEN':
      return 'var(--color-success)';
    case 'RESOLVED':
      return 'var(--color-info)';
    case 'CLOSED':
      return 'var(--color-text-secondary)';
  }
}

export function getStatusLabel(
  t: TSupport,
  status: SupportThreadStatus
): string {
  switch (status) {
    case 'OPEN':
      return t('statusOpen');
    case 'RESOLVED':
      return t('statusResolved');
    case 'CLOSED':
      return t('statusClosed');
  }
}
