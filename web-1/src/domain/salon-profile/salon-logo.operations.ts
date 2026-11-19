import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';
import { DB_CLIENT } from '@app/db/db.client';
import { lockStylistAccount } from '@app/db/lock-rows';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { findForeignAssetOwner } from '@domain/_shared/guards/cloudinary-asset.guard';
import { cleanupCloudinaryAsset } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import { failure, success } from '@kernel/application/result.types';
import { canManageSalonProfile } from './salon-profile.policy';

export async function setSalonLogo_IO({
  accountId,
  userId,
  logo_url,
}: {
  accountId: string;
  userId: string;
  logo_url: string | null;
}) {
  try {
    if (logo_url !== null) {
      const ownership = await findForeignAssetOwner(logo_url, { userId });
      if (ownership !== 'OWN') {
        return failure({
          type: 'VALIDATION_ERROR' as const,
          field: 'logo_url',
          message:
            ownership === 'FOREIGN'
              ? 'Logo URL belongs to another account'
              : 'Logo URL is not a recognized Cloudinary upload address',
        });
      }
    }
    const result = await DB_CLIENT.use.$transaction(async tx => {
      await lockStylistAccount(tx, accountId);
      const owner = await tx.stylistAccount.findUnique({
        where: { account_id: accountId },
      });
      if (
        !owner ||
        owner.created_by_user_id !== userId ||
        !canManageSalonProfile(owner)
      ) {
        return null;
      }
      if (owner.salon_logo_url !== logo_url) {
        await tx.stylistAccount.update({
          where: { account_id: accountId },
          data: {
            salon_logo_url: logo_url,
            salon_logo_public_id:
              logo_url === null ? null : extractPublicIdFromUrl(logo_url),
          },
        });
      }
      return { previous: owner.salon_logo_url };
    });
    if (!result) {
      return failure({ type: 'ACCOUNT_NOT_FOUND' as const, accountId });
    }
    if (result.previous !== null && result.previous !== logo_url) {
      cleanupCloudinaryAsset(result.previous);
    }
    return success({ account_id: accountId, logo_url });
  } catch (error) {
    return databaseFailure('setSalonLogo_IO', error);
  }
}
