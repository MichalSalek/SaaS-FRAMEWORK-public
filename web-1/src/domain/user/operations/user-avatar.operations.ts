import type { Prisma } from '../../../prisma/js-client';
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';
import { DB_CLIENT } from '@app/db/db.client';
import { lockStylistAccountByOwnerUser, lockUserRow } from '@app/db/lock-rows';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { findForeignAssetOwner } from '@domain/_shared/guards/cloudinary-asset.guard';
import { cleanupCloudinaryAssets } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { UserNotFoundError } from '@kernel/domain/user-and-account/user-errors.types';
import {
  failure,
  success,
  type OperationResult,
} from '@kernel/application/result.types';

export async function userSetAvatar_IO({
  userId,
  avatar_url,
}: {
  userId: string;
  avatar_url: string | null;
}): Promise<
  OperationResult<
    { user_id: string; avatar_url: string | null },
    UserNotFoundError | ValidationError | DatabaseError
  >
> {
  try {
    // DECISION: client-provided URLs need the shared ownership gate before they can later drive a cloud delete.
    if (avatar_url !== null) {
      const ownership = await findForeignAssetOwner(avatar_url, { userId });
      if (ownership !== 'OWN') {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'avatar_url',
          message:
            ownership === 'FOREIGN'
              ? 'Avatar URL belongs to another account'
              : 'Avatar URL is not a recognized Cloudinary upload address',
        });
      }
    }
    const outcome = await DB_CLIENT.use.$transaction(async tx => {
      // DECISION: serialize the read and both writes under row locks. The previous CAS loop
      // ensured cleanup received the displaced value; this transaction preserves that invariant
      // while also synchronizing the legacy mirror. Match the global User → StylistAccount order.
      await lockUserRow(tx, userId);
      const stylist = await lockStylistAccountByOwnerUser(tx, userId);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          avatar_url: true,
          is_active: true,
          disabled_at: true,
          deleted_at: true,
        },
      });
      if (
        !user ||
        !user.is_active ||
        user.disabled_at !== null ||
        user.deleted_at !== null
      ) {
        return null;
      }
      const publicId =
        avatar_url === null ? null : extractPublicIdFromUrl(avatar_url);
      const legacy = stylist
        ? await tx.stylistAccount.findUnique({
            where: { account_id: stylist.account_id },
            select: { avatar_url: true },
          })
        : null;
      if (stylist) {
        await tx.stylistAccount.update({
          where: { account_id: stylist.account_id },
          data: { avatar_url, avatar_public_id: publicId },
        });
      }
      // Keep the canonical row and transitional mirror in the same transaction.
      await tx.user.update({
        where: { id: userId },
        data: { avatar_url, avatar_public_id: publicId },
      });
      return { previous: [user.avatar_url, legacy?.avatar_url ?? null] };
    });
    if (!outcome) {
      return failure({ type: 'USER_NOT_FOUND', userId });
    }
    const displaced = [
      ...new Set(
        outcome.previous.filter(
          (url): url is string => url !== null && url !== avatar_url
        )
      ),
    ];
    if (displaced.length) {
      cleanupCloudinaryAssets(displaced);
    }
    return success({ user_id: userId, avatar_url });
  } catch (error) {
    return databaseFailure('userSetAvatar_IO', error);
  }
}

/** Read the owning user under the onboarding lock before creating its legacy mirror. */
export async function readPersonalAvatarMirror(
  tx: Prisma.TransactionClient,
  userId: string
) {
  const photo = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { avatar_url: true, avatar_public_id: true },
  });
  return { created_by_user_id: userId, ...photo };
}
