import { lockStylistAccountByOwnerUser } from '@app/db/lock-rows';
import type { Prisma } from '../../prisma/js-client';
import {
  claimProfileLink,
  isProfileLinkReservedByOther,
  lockProfileLinkSlugs,
} from './profile-link-alias.operations';

/** Caller holds the recovering user's row lock before entering this namespace. */
export const prepareRecoveredVanity = async (
  tx: Prisma.TransactionClient,
  userId: string,
  requested: string | null
): Promise<string | null> => {
  const locked = await lockStylistAccountByOwnerUser(tx, userId);
  const existing = locked
    ? await tx.stylistAccount.findUnique({
        where: { account_id: locked.account_id },
        select: { vanity_url: true },
      })
    : null;
  await lockProfileLinkSlugs(tx, 'STYLIST', [
    existing?.vanity_url ?? null,
    requested,
  ]);
  let vanity = requested;
  if (vanity) {
    const [occupied, reserved] = await Promise.all([
      tx.stylistAccount.findFirst({
        where: {
          OR: [{ vanity_url: vanity }, { account_id: vanity }],
          created_by_user_id: { not: userId },
        },
        select: { account_id: true },
      }),
      isProfileLinkReservedByOther(tx, {
        kind: 'STYLIST',
        slug: vanity,
        accountId: locked?.account_id ?? '',
      }),
    ]);
    if (occupied || reserved) {
      vanity = null;
    }
  }
  if (locked) {
    await claimProfileLink(tx, {
      kind: 'STYLIST',
      accountId: locked.account_id,
      previousSlug: existing?.vanity_url ?? null,
      nextSlug: vanity,
    });
  }
  return vanity;
};
