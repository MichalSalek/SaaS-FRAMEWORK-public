import { salonDisplayName } from '@kernel/domain/salon-profile/salon-names';
import { DB_CLIENT } from '@app/db/db.client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { canManageSalonProfile } from './salon-profile.policy';
export async function getStylistSalonLink_IO({
  accountId,
  userId,
}: {
  accountId: string;
  userId: string;
}): Promise<{
  account_id: string;
  name: string;
  role: 'owner' | 'stylist';
  salon_vanity_url?: string | null;
} | null> {
  const own = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { account_id: accountId },
  });
  // DECISION: the link appears only when the salon page exists. The public read (getSalonProfile_IO) answers 404 for
  // a salon that never saved its name, so a Studio owner who had not set it up showed "Właścicielka salonu ..."
  // leading to a 404 page.
  if (own && canManageSalonProfile(own) && own.salon_profile_name) {
    return {
      account_id: accountId,
      name: salonDisplayName(own),
      role: 'owner',
      salon_vanity_url: own.salon_vanity_url,
    };
  }
  const membership = await DB_CLIENT.use.staffMember.findFirst({
    where: {
      user_id: userId,
      is_active: true,
      accepted_at: { not: null },
      public_profile_visible: true,
      stylist_account: {
        ...STYLIST_PUBLICLY_VISIBLE,
        salon_show_team: true,
        salon_profile_name: { not: null },
      },
    },
    include: { stylist_account: true },
    orderBy: { invited_at: 'asc' },
  });
  if (!membership || !canManageSalonProfile(membership.stylist_account)) {
    return null;
  }
  return {
    account_id: membership.stylist_account_id,
    name: salonDisplayName(membership.stylist_account),
    role: 'stylist',
    salon_vanity_url: membership.stylist_account.salon_vanity_url,
  };
}
