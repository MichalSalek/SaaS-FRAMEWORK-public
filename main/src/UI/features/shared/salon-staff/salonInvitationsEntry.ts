// UI/features/shared/salon-staff/salonInvitationsEntry.ts
// What the in-app entry points to the invitations screen (drawer item, account
// card) show, derived from the state of the invitations read.
//
// DECISION (nie usuwaj tego komentarza): a FAILED read is not "no invitations".
// Collapsing it to 0 hid both entry points, i.e. the only in-app way to the
// screen that renders the error with a retry, so a first-load failure looked
// exactly like an empty inbox. Hidden means: still loading, disabled, or read
// successfully with nothing pending. Data from an earlier success wins over a
// later failed background refetch (TanStack keeps it), so the count stays.

export type SalonInvitationsEntry =
  { kind: 'hidden' } | { kind: 'count'; count: number } | { kind: 'error' };

export function resolveSalonInvitationsEntry({
  enabled,
  pendingCount,
  isError,
}: {
  enabled: boolean;
  /** Invitations in the cached data; undefined while nothing has loaded. */
  pendingCount: number | undefined;
  isError: boolean;
}): SalonInvitationsEntry {
  if (!enabled) {
    return { kind: 'hidden' };
  }
  if (pendingCount !== undefined) {
    return pendingCount > 0
      ? { kind: 'count', count: pendingCount }
      : { kind: 'hidden' };
  }
  return isError ? { kind: 'error' } : { kind: 'hidden' };
}

/**
 * Drawer contract (components/ cannot import features/, so it takes a plain
 * value): a number > 0 = item with that badge, `null` = item WITHOUT a badge
 * (the count is unknown because the read failed), 0 = no item.
 */
export function toDrawerInvitationsBadge(
  entry: SalonInvitationsEntry
): number | null {
  switch (entry.kind) {
    case 'count':
      return entry.count;
    case 'error':
      return null;
    case 'hidden':
      return 0;
  }
}
