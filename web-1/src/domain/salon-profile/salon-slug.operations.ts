import { DB_CLIENT } from '@app/db/db.client';
import { isProfileLinkReservedByOther } from '@domain/account/profile-link-alias.operations';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import {
  RESERVED_VANITY_URLS,
  vanityUrlSchema,
} from '@kernel/domain/user-and-account/vanity-url.config';
export async function checkSalonSlug_IO({
  accountId,
  slug,
}: {
  accountId: string;
  slug: string;
}): Promise<OperationResult<{ available: boolean }, DatabaseError>> {
  if (
    !vanityUrlSchema.safeParse(slug).success ||
    RESERVED_VANITY_URLS.includes(slug)
  ) {
    return success({ available: false });
  }
  try {
    const [existing, reserved] = await Promise.all([
      DB_CLIENT.use.stylistAccount.findFirst({
        where: { salon_vanity_url: slug },
        select: { account_id: true },
      }),

      isProfileLinkReservedByOther(DB_CLIENT.use, {
        kind: 'SALON',
        slug,
        accountId,
      }),
    ]);
    return success({
      available: !reserved && (!existing || existing.account_id === accountId),
    });
  } catch (error) {
    return databaseFailure('checkSalonSlug_IO', error);
  }
}
