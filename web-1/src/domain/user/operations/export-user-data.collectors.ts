import { DB_CLIENT } from '@app/db/db.client';
import {
  collectStylistCrmNotes,
  collectStylistVisits,
  collectStylistSessionContainers,
} from './export-user-data.collectors.extra';

// Cap per-collection rows in a GDPR Art.15 export (defense against unbounded
// result sets for power users). Shared by stylist + client collectors and the
// activity-log read in the orchestrator (export-user-data.operations.ts).
export const COLLECTION_LIMIT = 5000;

export async function exportStylistData(
  stylistAccountId: string
): Promise<Record<string, unknown>> {
  const [
    stylistAccount,
    galleryRecords,
    pairedClients,
    staffMembers,
    crmNotes,
    visits,
    sessionContainers,
  ] = await Promise.all([
    DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: stylistAccountId },
      select: {
        display_name: true,
        business_name: true,
        description: true,
        dashboard_note: true,
        address_street: true,
        address_city: true,
        address_postal_code: true,
        address_country: true,
        phone: true,
        website: true,
        vanity_url: true,
        pricing_plan: true,
        payment_status: true,
        account_status: true,
        trial_started_at: true,
        trial_ends_at: true,
        created_at: true,
      },
    }),
    DB_CLIENT.use.galleryRecord.findMany({
      where: { created_by_account_id: stylistAccountId },
      select: {
        asset_url: true,
        nail_length: true,
        is_pinned: true,
        created_at: true,
        colors: {
          select: { color: { select: { name: true, hex_code: true } } },
        },
        traits: {
          select: { trait: { select: { name: true, category: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
      take: COLLECTION_LIMIT,
    }),
    DB_CLIENT.use.clientStylistPair.findMany({
      where: { stylist_account_id: stylistAccountId },
      select: {
        paired_at: true,
        status: true,
        revoked_at: true,
        client_user: { select: { name: true } },
      },
      orderBy: { paired_at: 'desc' },
      take: COLLECTION_LIMIT,
    }),
    DB_CLIENT.use.staffMember.findMany({
      where: { stylist_account_id: stylistAccountId },
      select: {
        role: true,
        permissions: true,
        invited_at: true,
        accepted_at: true,
        is_active: true,
        user: { select: { name: true } },
      },
      take: COLLECTION_LIMIT,
    }),
    collectStylistCrmNotes(stylistAccountId, COLLECTION_LIMIT),
    collectStylistVisits(stylistAccountId, COLLECTION_LIMIT),
    collectStylistSessionContainers(stylistAccountId, COLLECTION_LIMIT),
  ]);

  return {
    profile: stylistAccount ?? {},
    dashboard_note: stylistAccount?.dashboard_note ?? null,
    gallery_records: galleryRecords.map(record => ({
      asset_url: record.asset_url,
      nail_length: record.nail_length,
      is_pinned: record.is_pinned,
      created_at: record.created_at.toISOString(),
      colors: record.colors.map(c => ({
        name: c.color.name,
        hex_code: c.color.hex_code, // gallery-mapper-allow: GDPR export uses a reduced shape (name+hex only, no id/icon_url/is_featured) — the SSOT mapper would over-emit internal fields
      })),
      traits: record.traits.map(t => ({
        name: t.trait.name,
        category: t.trait.category,
      })),
    })),
    paired_clients: pairedClients.map(pair => ({
      client_name: pair.client_user.name,
      paired_at: pair.paired_at.toISOString(),
      status: pair.status,
      revoked_at: pair.revoked_at?.toISOString() ?? null,
    })),
    staff_members: staffMembers.map(staff => ({
      member_name: staff.user.name,
      role: staff.role,
      permissions: staff.permissions,
      invited_at: staff.invited_at.toISOString(),
      accepted_at: staff.accepted_at?.toISOString() ?? null,
      is_active: staff.is_active,
    })),
    crm_notes: crmNotes,
    visits,
    session_containers: sessionContainers,
  };
}

export async function exportClientData(
  userId: string
): Promise<Record<string, unknown>> {
  const [
    clientAccount,
    bookmarkedStylists,
    favoriteRecords,
    pairingHistory,
    sessionShares,
  ] = await Promise.all([
    DB_CLIENT.use.clientAccount.findUnique({
      where: { created_by_user_id: userId },
      select: {
        contact_phone: true,
        contact_email: true,
        dashboard_note: true,
        created_at: true,
      },
    }),
    DB_CLIENT.use.favoriteStylist.findMany({
      where: { client_user_id: userId },
      select: {
        created_at: true,
        stylist: { select: { display_name: true } },
      },
      orderBy: { created_at: 'desc' },
      take: COLLECTION_LIMIT,
    }),
    DB_CLIENT.use.favoriteGalleryRecord.findMany({
      where: { client_user_id: userId },
      select: {
        created_at: true,
        note: true,
        record: {
          select: {
            asset_url: true,
            nail_length: true,
            created_by_account: { select: { display_name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: COLLECTION_LIMIT,
    }),
    DB_CLIENT.use.clientStylistPair.findMany({
      where: { client_user_id: userId },
      select: {
        paired_at: true,
        status: true,
        revoked_at: true,
        stylist_account: { select: { display_name: true } },
      },
      orderBy: { paired_at: 'desc' },
      take: COLLECTION_LIMIT,
    }),
    DB_CLIENT.use.sessionContainer.findMany({
      where: {
        client_account: { created_by_user_id: userId },
        shared_at: { not: null },
      },
      select: {
        shared_at: true,
        expires_at: true,
        stylist_account: { select: { display_name: true } },
        photos: {
          select: {
            gallery_record: { select: { asset_url: true, nail_length: true } },
          },
          take: 1,
        },
      },
      orderBy: { shared_at: 'desc' },
      take: COLLECTION_LIMIT,
    }),
  ]);

  return {
    profile: clientAccount ?? {},
    dashboard_note: clientAccount?.dashboard_note ?? null,
    favorite_stylists: bookmarkedStylists.map(fav => ({
      stylist_name: fav.stylist.display_name,
      added_at: fav.created_at.toISOString(),
    })),
    favorite_records: favoriteRecords.map(fav => ({
      asset_url: fav.record.asset_url,
      nail_length: fav.record.nail_length,
      stylist_name: fav.record.created_by_account.display_name,
      note: fav.note,
      added_at: fav.created_at.toISOString(),
    })),
    pairing_history: pairingHistory.map(pair => ({
      stylist_name: pair.stylist_account.display_name,
      paired_at: pair.paired_at.toISOString(),
      status: pair.status,
      revoked_at: pair.revoked_at?.toISOString() ?? null,
    })),
    session_share_history: sessionShares.map(share => ({
      stylist_name: share.stylist_account?.display_name ?? null,
      record_url: share.photos[0]?.gallery_record?.asset_url ?? null,
      record_nail_length: share.photos[0]?.gallery_record?.nail_length ?? null,
      shared_at: share.shared_at
        ? new Date(share.shared_at).toISOString()
        : null,
      expires_at: share.expires_at
        ? new Date(share.expires_at).toISOString()
        : null,
    })),
  };
}
