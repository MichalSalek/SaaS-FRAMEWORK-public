// UI/features/salon-staff/salonStaffDisplay.helpers.ts
// Display mapping for salon roster rows. `user_inactive` is a dead-user seat
//, not a pending invite (`accepted_at === null`).

import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';

export function getDisplayName(
  member: StaffMemberDTO,
  inactiveLabel: string
): string {
  if (member.user_inactive) {
    return inactiveLabel;
  }
  // `||`, not `??`: User.name defaults to '', and an accepted
  // member without a name rendered an EMPTY row title.
  return member.user?.name?.trim() || member.user?.email || member.id;
}

export function getAvatarSrc(member: StaffMemberDTO): string {
  if (member.user_inactive) {
    return '';
  }
  if (member.user?.image) {
    return member.user.image;
  }
  /* A second, own path to dicebear bypassed the brand palette (the avatar came
     out yellow) and put the e-mail in the query string. Without `src`,
     `AvatarAtom` decides: it knows both the palette and the PII rule. */
  return '';
}

/**
 * Pending invite: the invited person has not accepted yet (`accepted_at` null).
 * The membership row is created ACTIVE at invitation time (it holds the seat),
 * so `is_active` says nothing about acceptance. A dead-user seat is its own
 * variant ("Konto nieaktywne") and never reads as pending.
 */
export function isPendingInvite(member: StaffMemberDTO): boolean {
  return (
    (member.accepted_at === null || member.awaiting_stylist_account === true) &&
    !member.user_inactive
  );
}

/**
 * "wrz 2026" for the moment she ACCEPTED (not the invitation), in the app
 * locale rather than the device's. null when there is no valid date.
 */
export function formatJoinedMonth(
  acceptedAt: string | null,
  locale: string
): string | null {
  if (!acceptedAt) {
    return null;
  }
  const parsed = new Date(acceptedAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
    }).format(parsed);
  } catch {
    return parsed.toISOString().slice(0, 7);
  }
}
