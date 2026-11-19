import { lockUserRow } from '@app/db/lock-rows';
import { DB_CLIENT } from '@app/db/db.client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { canManageSalonProfile } from '@domain/salon-profile/salon-profile.policy';
import type { Prisma } from '../../prisma/js-client';

export type SalonAccess =
  | { kind: 'DIRECT'; pairId: string }
  | { kind: 'SALON'; salonAccountId: string; pairId: string | null };

const CONTRIBUTING_MEMBERSHIP = {
  is_active: true,
  accepted_at: { not: null },
  public_profile_visible: true,
} as const;

// DECISION: salon access is resolved from current membership and the owner's own paid plan, never a copied
// entitlement. Only direct QR connections seed salon access: derived connections cannot keep a departed client's
// access alive or transitively connect two salons. CRM and conversations stay scoped to the individual pairing
// row, never to the salon owner.
export async function resolveSalonAccess_IO(
  clientUserId: string,
  stylistAccountId: string,
  tx?: Prisma.TransactionClient,
  salonOnly = false
): Promise<SalonAccess | null> {
  const db = tx ?? DB_CLIENT.use;
  const direct = await db.clientStylistPair.findFirst({
    where: {
      client_user_id: clientUserId,
      stylist_account_id: stylistAccountId,
      status: 'ACTIVE',
      salon_origin_account_id: null,
      stylist_account: STYLIST_PUBLICLY_VISIBLE,
      client_user: { is_active: true },
    },
    select: { id: true },
  });
  if (direct && !salonOnly) {
    return { kind: 'DIRECT', pairId: direct.id };
  }

  const salons = await db.stylistAccount.findMany({
    where: {
      ...STYLIST_PUBLICLY_VISIBLE,
      created_by_user: { is_active: true, disabled_at: null },
      OR: [
        { account_id: stylistAccountId },
        {
          staff_members: {
            some: {
              ...CONTRIBUTING_MEMBERSHIP,
              user: {
                is_active: true,
                disabled_at: null,
                stylist_account: {
                  account_id: stylistAccountId,
                  ...STYLIST_PUBLICLY_VISIBLE,
                },
              },
            },
          },
        },
      ],
    },
    select: {
      account_id: true,
      pricing_plan: true,
      subscription_status: true,
      payment_status: true,
      account_status: true,
      account_expiration_date: true,
      // Scale team membership is complete metadata, not a gallery record page.
      staff_members: {
        where: {
          ...CONTRIBUTING_MEMBERSHIP,
          user: { is_active: true, disabled_at: null },
        },
        select: {
          user: {
            select: {
              stylist_account: {
                select: { account_id: true, account_status: true },
              },
            },
          },
        },
      },
    },
    take: 10,
  });
  const eligible = salons.filter(canManageSalonProfile);
  if (eligible.length === 0) {
    return null;
  }
  const contributorIds = (salon: (typeof eligible)[number]) => [
    salon.account_id,
    ...salon.staff_members.flatMap(member =>
      member.user.stylist_account?.account_status === 'ACTIVE'
        ? [member.user.stylist_account.account_id]
        : []
    ),
  ];
  const seeds = await db.clientStylistPair.findMany({
    where: {
      client_user_id: clientUserId,
      status: 'ACTIVE',
      salon_origin_account_id: null,
      stylist_account_id: { in: eligible.flatMap(contributorIds) },
      client_user: { is_active: true },
      stylist_account: STYLIST_PUBLICLY_VISIBLE,
    },
    select: { stylist_account_id: true },
    take: 100,
  });
  const salon = eligible.find(candidate =>
    seeds.some(seed =>
      contributorIds(candidate).includes(seed.stylist_account_id)
    )
  );
  if (!salon) {
    return null;
  }
  const existing = await db.clientStylistPair.findUnique({
    where: {
      client_user_id_stylist_account_id: {
        client_user_id: clientUserId,
        stylist_account_id: stylistAccountId,
      },
    },
    select: { id: true, status: true, revoked_by: true },
  });
  // A stylist's explicit disconnect is authoritative, including for salon clients.
  if (existing?.status === 'REVOKED' && existing.revoked_by === 'STYLIST') {
    return null;
  }
  return {
    kind: 'SALON',
    salonAccountId: salon.account_id,
    pairId: existing?.status === 'ACTIVE' ? existing.id : null,
  };
}

export async function ensureSalonPairing_IO(
  clientUserId: string,
  stylistAccountId: string,
  tx?: Prisma.TransactionClient
): Promise<{ id: string } | null> {
  if (!tx) {
    return DB_CLIENT.use.$transaction(
      inner => ensureSalonPairing_IO(clientUserId, stylistAccountId, inner),
      { isolationLevel: 'Serializable' }
    );
  }
  await lockUserRow(tx, clientUserId);
  const access = await resolveSalonAccess_IO(
    clientUserId,
    stylistAccountId,
    tx
  );
  if (!access) {
    return null;
  }
  if (access.pairId) {
    return { id: access.pairId };
  }
  if (access.kind !== 'SALON') {
    return null;
  }
  const db = tx ?? DB_CLIENT.use;
  return db.clientStylistPair.upsert({
    where: {
      client_user_id_stylist_account_id: {
        client_user_id: clientUserId,
        stylist_account_id: stylistAccountId,
      },
    },
    create: {
      client_user_id: clientUserId,
      stylist_account_id: stylistAccountId,
      salon_origin_account_id: access.salonAccountId,
      status: 'ACTIVE',
    },
    update: {
      status: 'ACTIVE',
      salon_origin_account_id: access.salonAccountId,
      revoked_at: null,
      revoked_by: null,
    },
    select: { id: true },
  });
}

export async function canUseSalonPhotoInSession_IO(
  clientUserId: string,
  receiverStylistId: string,
  authorStylistId: string,
  tx?: Prisma.TransactionClient
): Promise<boolean> {
  if (receiverStylistId === authorStylistId) {
    return Boolean(
      await resolveSalonAccess_IO(clientUserId, authorStylistId, tx)
    );
  }
  const receiver = await resolveSalonAccess_IO(
    clientUserId,
    receiverStylistId,
    tx,
    true
  );
  const author = await resolveSalonAccess_IO(
    clientUserId,
    authorStylistId,
    tx,
    true
  );
  return (
    receiver?.kind === 'SALON' &&
    author?.kind === 'SALON' &&
    receiver.salonAccountId === author.salonAccountId
  );
}
