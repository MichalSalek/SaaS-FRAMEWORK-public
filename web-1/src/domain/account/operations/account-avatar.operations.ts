import {
  assetUrlReferencesPublicId,
  extractPublicIdFromUrl,
} from '@app/cloudinary/cloudinary-url.utils';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { userSetAvatar_IO } from '@domain/user/operations/user-avatar.operations';
import type { IDType } from '@kernel/application/application.types';
import { failure } from '@kernel/application/result.types';

/**
 * DECISION: the legacy stylist write remains a compatibility adapter, with account_id supplied
 * from the session at the handler boundary. It delegates the single person write and mirror.
 * The public cover is independent and is not uploaded by this command.
 */
export const accountSetAvatar_IO = async ({
  account_id,
  avatar_url,
}: {
  account_id: IDType;
  avatar_url: string | null;
}) => {
  const accountId = String(account_id);
  try {
    const account = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: accountId },
      select: { created_by_user_id: true },
    });
    if (!account) {
      return failure({ type: 'ACCOUNT_NOT_FOUND' as const, accountId });
    }
    const result = await userSetAvatar_IO({
      userId: account.created_by_user_id,
      avatar_url,
    });
    if (!result.success) {
      return result;
    }
    return {
      success: true as const,
      data: { account_id: accountId, avatar_url: result.data.avatar_url },
    };
  } catch (error) {
    return databaseFailure('accountSetAvatar_IO', error);
  }
};

/** Collect all custom assets before a terminal delete, never the OAuth image. */
export const collectStylistAvatarUrlsForUser_IO = async (
  userId: string
): Promise<string[]> => {
  try {
    const [accounts, user] = await Promise.all([
      DB_CLIENT.use.stylistAccount.findMany({
        where: { created_by_user_id: userId },
        select: { avatar_url: true, salon_logo_url: true },
      }),
      DB_CLIENT.use.user.findUnique({
        where: { id: userId },
        select: { avatar_url: true, image: true },
      }),
    ]);
    return [
      ...new Set(
        [
          user?.avatar_url,
          ...accounts.flatMap(account => [
            account.avatar_url,
            account.salon_logo_url,
          ]),
        ]
          .filter((url): url is string => typeof url === 'string')
          .filter(url => {
            const id = extractPublicIdFromUrl(url);
            return (
              !user?.image ||
              (url !== user.image &&
                (id === null || !assetUrlReferencesPublicId(user.image, id)))
            );
          })
      ),
    ];
  } catch (error) {
    reportIssueBackend({
      namespace: 'account-avatar-cleanup',
      message: `Could not collect avatar and logo URLs before account delete: ${userId}`,
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'warn',
    });
    return [];
  }
};
