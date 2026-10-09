// UI/features/salon-staff/salonStaffView.helpers.ts
// What the salon staff page shows, decided from the plan and the roster query.
//
// DECISION (nie usuwaj tego komentarza):
// A plan without staff accounts does NOT hide the team (owner, 2026-09-24).
// After a downgrade from Studio/Scale the membership rows stay (there is no
// downgrade cleanup), and the backend deliberately keeps list + remove open on
// every plan (DECISIONs in getAllStaffMembers_IO and removeStaffMember_IO) so
// the owner can see the people she no longer pays for and remove them. Invites
// and permission changes stay plan-gated there, so the page offers ONLY removal
// in that state ('removeOnly'), without seat counters that imply a paid seat.

import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';

export interface SalonStaffViewInput {
  /** The current user (and therefore the plan) is resolved. */
  isPlanKnown: boolean;
  canUseStaffAccounts: boolean;
  /** First roster load in flight (no data yet). */
  isRosterLoading: boolean;
  isRosterError: boolean;
  /** The roster query holds data (possibly stale after a failed refetch). */
  isRosterFetched: boolean;
  memberCount: number;
}

export interface SalonStaffView {
  /** Full management: seats, stats, limit nudge, invite, permission toggles. */
  showSeatUsage: boolean;
  showEmptyState: boolean;
  showStaffList: boolean;
  /** Plan without staff accounts: the upgrade notice. */
  showLockedNotice: boolean;
  /** Plan without staff accounts, team left over: list with removal only. */
  showRemoveOnlyList: boolean;
  /** Roster unknown because the load failed: error with retry, never "0". */
  showRosterError: boolean;
}

export function resolveSalonStaffView({
  isPlanKnown,
  canUseStaffAccounts,
  isRosterLoading,
  isRosterError,
  isRosterFetched,
  memberCount,
}: SalonStaffViewInput): SalonStaffView {
  const hasNoMembers = memberCount === 0;
  // A failed background refetch keeps the cached roster (TQ v5), so the list
  // stays on screen. An EMPTY cached roster under a failed refetch is not a
  // confirmed "no team yet": it counts as unknown (error with retry).
  const isRosterKnown = isRosterFetched && !(isRosterError && hasNoMembers);
  const isFull = isPlanKnown && canUseStaffAccounts;
  const isLocked = isPlanKnown && !canUseStaffAccounts;

  return {
    showSeatUsage: isFull && isRosterKnown,
    showEmptyState: isFull && isRosterKnown && hasNoMembers,
    showStaffList: isFull && isRosterKnown && !hasNoMembers,
    // The notice depends on the plan alone, so a failed roster load does not
    // hide it; it waits for the first load only to avoid a layout jump.
    showLockedNotice: isLocked && !isRosterLoading,
    showRemoveOnlyList: isLocked && isRosterKnown && !hasNoMembers,
    showRosterError: isRosterError && !isRosterKnown,
  };
}

export type SalonStaffRemoveVariant = 'remove' | 'freeSlot' | 'removeInactive';

/**
 * Confirmation copy for a removal. A dead-user row is a "seat to free" only
 * where seats exist; in remove-only mode there is no paid seat to talk about.
 */
export function resolveRemoveVariant(
  member: Pick<StaffMemberDTO, 'user_inactive'> | null,
  isRemoveOnly: boolean
): SalonStaffRemoveVariant {
  if (!member?.user_inactive) {
    return 'remove';
  }
  return isRemoveOnly ? 'removeInactive' : 'freeSlot';
}
