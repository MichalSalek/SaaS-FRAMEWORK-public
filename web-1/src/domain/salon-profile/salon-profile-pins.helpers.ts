import type { Prisma } from '../../prisma/js-client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';

/** Validate every supplied showcase work against the owner and current contributors. */
export async function validateSalonShowcasePins(
  tx: Prisma.TransactionClient,
  accountId: string,
  pinnedRecordIds: string[]
): Promise<void> {
  const contributingMembers = await tx.stylistAccount.findMany({
    where: {
      ...STYLIST_PUBLICLY_VISIBLE,
      created_by_user: {
        is_active: true,
        disabled_at: null,
        staff_memberships: {
          some: {
            stylist_account_id: accountId,
            is_active: true,
            accepted_at: { not: null },
            public_profile_visible: true,
          },
        },
      },
    },
    select: { account_id: true },
  });
  const contributorIds = [
    accountId,
    ...contributingMembers.map(member => member.account_id),
  ];
  const owned = await tx.galleryRecord.count({
    where: {
      gallery_record_id: { in: pinnedRecordIds },
      created_by_account_id: { in: contributorIds },
      is_hidden: false,
    },
  });
  if (owned !== pinnedRecordIds.length) {
    throw new Error('SALON_PIN_OWNERSHIP');
  }
}
