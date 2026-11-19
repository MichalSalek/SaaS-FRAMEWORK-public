import { resolvePersonAvatarUrl } from '@kernel/domain/user/avatar.policy';
import { stylistDisplayName } from '@kernel/domain/salon-profile/salon-names';
import type { Prisma } from '../../prisma/js-client';
import type { StaffPermission } from '@kernel/domain/user-and-account/staff_accounts.config';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';

type StaffMemberInput = Omit<
  Prisma.StaffMemberGetPayload<Prisma.StaffMemberDefaultArgs>,
  'public_profile_visible'
> & {
  public_profile_visible?: boolean;
  user?: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    avatar_url?: string | null;
    /** User.is_active: absent from the select means treated as live (the mapper does not guess). */
    is_active?: boolean;
    stylist_account?: {
      account_id?: string;
      account_status?: string;
      display_name: string | null;
      business_name: string | null;
    } | null;
  } | null;
};

export const resolveStaffPersonName = (
  profile:
    | { display_name: string | null; business_name: string | null }
    | null
    | undefined,
  userName: string | null
): string | null => (profile ? stylistDisplayName(profile) : '') || userName;

// DECISION: a team member with an INACTIVE account (User.is_active=false: soft-delete within the 90-day window, or
// ban) still occupies a seat (liveStaffSeatWhere below), so the row IS in the roster, but as "Konto nieaktywne":
// name/email/image are MASKED HERE on the server (roster and detail used to show the dead account's full PII), and
// `user_inactive=true` drives the row variant with the "Zwolnij miejsce" action (= removeStaffMember_IO). id/user_id
// stay because removal goes by id.
//
// DECISION: an invitation without acceptance does NOT reveal identity. The membership row is created at invite time by
// e-mail with accepted_at = null, so without a mask a Studio owner could type any stylist's address and the team list
// would immediately return her name and avatar: exactly the "e-mail -> name + avatar" oracle that the INVITE response
// deliberately closes (see inviteStaffMember_IO). While accepted_at === null, name and image are null; the e-mail
// stays because the owner typed it (the UI shows it as the row name, with "oczekuje na akceptację" from
// `accepted_at === null` in the DTO). The mask sits in the mapper, so it covers list, detail and the permission-change
// response at once. Only the INVITED person writes the acceptance (respondToStaffInvitation_IO): that is her consent
// to show her name and photo in this salon's team, and the write reveals the data with no change here.
export const mapStaffMemberToDTO = (
  staff: StaffMemberInput
): StaffMemberDTO => {
  const userInactive = staff.user?.is_active === false;
  const identityHidden = userInactive || staff.accepted_at === null;
  return {
    id: staff.id,
    stylist_account_id: staff.stylist_account_id,
    user_id: staff.user_id,
    role: staff.role,
    permissions: staff.permissions as StaffPermission[],
    is_active: staff.is_active,
    created_at: staff.invited_at.toISOString(),
    user_inactive: userInactive,
    accepted_at: staff.accepted_at?.toISOString() ?? null,
    contributes_to_gallery:
      !identityHidden && staff.public_profile_visible !== false,
    ...(!identityHidden &&
    staff.user?.stylist_account?.account_status === 'ACTIVE' &&
    staff.user.stylist_account.account_id
      ? { public_profile_id: staff.user.stylist_account.account_id }
      : {}),
    ...(staff.user && {
      user: {
        id: staff.user.id,
        name: identityHidden
          ? null
          : resolveStaffPersonName(staff.user.stylist_account, staff.user.name),
        email: userInactive ? '' : staff.user.email,
        image: identityHidden ? null : resolvePersonAvatarUrl(staff.user),
      },
    }),
  };
};

export const liveStaffSeatWhere = (
  stylistAccountId: string
): Prisma.StaffMemberWhereInput => ({
  stylist_account_id: stylistAccountId,
  is_active: true,
});

/**
 * The name an invitee sees for the inviting salon (invitation list and e-mail):
 * the owner's public display name, then her account name, then the salon's
 * business name. '' when none is set; callers decide what an empty name means.
 * display_name is nullable in the DB but app-required, so the fallbacks are rare
 * (SCHEMA_DECISIONS.md#stylistaccount-display-name-nullable).
 */
export const resolveInviterName = (salon: {
  display_name: string | null;
  business_name: string | null;
  created_by_user: { name: string | null } | null;
}): string =>
  salon.display_name?.trim() ||
  salon.created_by_user?.name?.trim() ||
  salon.business_name?.trim() ||
  '';
