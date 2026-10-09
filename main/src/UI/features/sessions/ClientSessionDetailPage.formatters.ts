// UI/features/sessions/ClientSessionDetailPage.formatters.ts
// Thin translated adapters over the shared session-time SSOT
// (./sessionTime.formatters). Kept as named exports so the client-detail call
// sites (ClientSessionDetailPage.actions.molecule) + the co-located tests stay
// put; the diff/floor/branch logic lives ONCE in the SSOT.

import {
  formatExpiryRemaining,
  formatTimeSinceShared,
} from './sessionTime.formatters';
import type { TSessions } from './sessionTime.formatters';

export function tFormatDaysRemaining(
  expiresAt: string | null,
  t: TSessions
): string {
  return formatExpiryRemaining(expiresAt, t, t('statusDraft'));
}

export function tFormatTimeSinceShared(
  sharedAt: string | null,
  t: TSessions
): string {
  return formatTimeSinceShared(sharedAt, t);
}
