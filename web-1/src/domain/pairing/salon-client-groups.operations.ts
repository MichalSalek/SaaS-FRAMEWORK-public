import { resolvePersonAvatarUrl } from '@kernel/domain/user/avatar.policy';
import {
  salonDisplayName,
  stylistDisplayName,
} from '@kernel/domain/salon-profile/salon-names';
import { DB_CLIENT } from '@app/db/db.client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { canManageSalonProfile } from '@domain/salon-profile/salon-profile.policy';
import type { ClientSalonGroup } from '@kernel/models/pairing/pairing.dto';

// DECISION: Scale has no team-size cap. Team and contact metadata are constrained to the salons reached through
// this client's direct connections, never truncated at an arbitrary member count: all current colleagues must stay
// valid addressees. Gallery records are paginated by their own read model. Three reads regardless of team size. No
// CRM/contact data is included: these are addressees, not fabricated pairings or colleague-owned client cards.
export async function getClientSalonGroups_IO(
  clientUserId: string
): Promise<ClientSalonGroup[]> {
  const seeds = await DB_CLIENT.use.clientStylistPair.findMany({
    where: {
      client_user_id: clientUserId,
      status: 'ACTIVE',
      salon_origin_account_id: null,
      stylist_account: STYLIST_PUBLICLY_VISIBLE,
    },
    select: {
      stylist_account_id: true,
      stylist_account: { select: { created_by_user_id: true } },
    },
    take: 10,
  });
  if (seeds.length === 0) {
    return [];
  }
  const owners = await DB_CLIENT.use.stylistAccount.findMany({
    where: {
      ...STYLIST_PUBLICLY_VISIBLE,
      created_by_user: { is_active: true, disabled_at: null },
      OR: [
        { account_id: { in: seeds.map(seed => seed.stylist_account_id) } },
        {
          staff_members: {
            some: {
              is_active: true,
              accepted_at: { not: null },
              public_profile_visible: true,
              user_id: {
                in: seeds.map(seed => seed.stylist_account.created_by_user_id),
              },
            },
          },
        },
      ],
    },
    include: {
      created_by_user: { select: { image: true, avatar_url: true } },
      staff_members: {
        where: {
          is_active: true,
          accepted_at: { not: null },
          public_profile_visible: true,
          user: { is_active: true, disabled_at: null },
        },
        include: {
          user: {
            select: { image: true, avatar_url: true, stylist_account: true },
          },
        },
      },
    },
    take: 10,
  });
  const activeOwners = owners.filter(canManageSalonProfile);
  const members = activeOwners.flatMap(owner => [
    owner,
    ...owner.staff_members.flatMap(member =>
      member.user.stylist_account?.account_status === 'ACTIVE'
        ? [member.user.stylist_account]
        : []
    ),
  ]);
  const pairs = await DB_CLIENT.use.clientStylistPair.findMany({
    where: {
      client_user_id: clientUserId,
      stylist_account_id: { in: members.map(member => member.account_id) },
    },
    select: {
      id: true,
      stylist_account_id: true,
      status: true,
      revoked_by: true,
    },
  });
  return activeOwners.map(owner => ({
    account_id: owner.account_id,
    name: salonDisplayName(owner),
    slug: owner.salon_vanity_url,
    members: [
      { account: owner, image: resolvePersonAvatarUrl(owner.created_by_user) },
      ...owner.staff_members.flatMap(member =>
        member.user.stylist_account?.account_status === 'ACTIVE'
          ? [
              {
                account: member.user.stylist_account,
                image: resolvePersonAvatarUrl(member.user),
              },
            ]
          : []
      ),
    ].flatMap(({ account, image }) => {
      const pair = pairs.find(
        candidate => candidate.stylist_account_id === account.account_id
      );
      if (pair?.status === 'REVOKED' && pair.revoked_by === 'STYLIST') {
        return [];
      }
      return [
        {
          account_id: account.account_id,
          name: stylistDisplayName(account),
          avatar_url: image,
          pair_id: pair?.status === 'ACTIVE' ? pair.id : null,
        },
      ];
    }),
  }));
}
