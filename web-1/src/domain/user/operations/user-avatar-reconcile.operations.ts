import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';
import { findForeignAssetOwner } from '@domain/_shared/guards/cloudinary-asset.guard';
import { DB_CLIENT } from '@app/db/db.client';
import { lockStylistAccountByOwnerUser, lockUserRow } from '@app/db/lock-rows';
import { cleanupCloudinaryAsset } from '@domain/gallery/operations/gallery-cloudinary-cleanup';

/** Only after every old backend writer is drained: copy the legacy last-write bridge, including clears. */
export async function reconcileLegacyAvatarForUser_IO(
  userId: string
): Promise<void> {
  const previous = await DB_CLIENT.use.$transaction(async tx => {
    const userLock = await lockUserRow(tx, userId);
    if (!userLock) {
      return null;
    }
    const accountLock = await lockStylistAccountByOwnerUser(tx, userId);
    if (!accountLock) {
      return null;
    }
    const [user, account] = await Promise.all([
      tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatar_url: true, avatar_public_id: true },
      }),
      tx.stylistAccount.findUniqueOrThrow({
        where: { account_id: accountLock.account_id },
        select: { avatar_url: true, avatar_public_id: true },
      }),
    ]);
    const publicId =
      account.avatar_url === null
        ? null
        : extractPublicIdFromUrl(account.avatar_url);
    if (
      user.avatar_url === account.avatar_url &&
      user.avatar_public_id === publicId &&
      account.avatar_public_id === publicId
    ) {
      return null;
    }
    if (account.avatar_url !== null) {
      const ownership = await findForeignAssetOwner(
        account.avatar_url,
        { userId },
        tx
      );
      if (ownership !== 'OWN' || publicId === null) {
        throw new Error(
          `Legacy avatar reconciliation denied: ${ownership === 'OWN' ? 'UNRECOGNIZED_URL' : ownership}`
        );
      }
    }
    if (account.avatar_public_id !== publicId) {
      await tx.stylistAccount.update({
        where: { account_id: accountLock.account_id },
        data: { avatar_public_id: publicId },
      });
    }
    await tx.user.update({
      where: { id: userId },
      data: {
        avatar_url: account.avatar_url,
        avatar_public_id: publicId,
      },
    });
    return user.avatar_url === account.avatar_url ? null : user.avatar_url;
  });
  if (previous !== null) {
    cleanupCloudinaryAsset(previous);
  }
}
