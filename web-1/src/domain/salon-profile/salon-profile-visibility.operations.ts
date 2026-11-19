import { reconcileSalonDerivedPairingsAfterCommit_IO } from '@domain/pairing/salon-derived-cleanup.operations';
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';

export async function updateSalonProfileVisibility_IO({
  userId,
  visible,
}: {
  userId: string;
  visible: boolean;
}): Promise<OperationResult<{ visible: boolean }, DatabaseError>> {
  try {
    const memberships = !visible
      ? await DB_CLIENT.use.staffMember.findMany({
          where: {
            user_id: userId,
            is_active: true,
            accepted_at: { not: null },
          },
          select: { stylist_account_id: true },
        })
      : [];
    await DB_CLIENT.use.staffMember.updateMany({
      where: { user_id: userId, is_active: true, accepted_at: { not: null } },
      data: { public_profile_visible: visible },
    });
    for (const membership of memberships) {
      await reconcileSalonDerivedPairingsAfterCommit_IO(
        { salonAccountId: membership.stylist_account_id },
        'updateSalonProfileVisibility'
      );
    }
    return success({ visible });
  } catch (error) {
    return databaseFailure('updateSalonProfileVisibility_IO', error);
  }
}

export async function getSalonProfileVisibility_IO({
  userId,
}: {
  userId: string;
}): Promise<OperationResult<{ visible: boolean | null }, DatabaseError>> {
  try {
    const membership = await DB_CLIENT.use.staffMember.findFirst({
      where: { user_id: userId, is_active: true, accepted_at: { not: null } },
      select: { public_profile_visible: true },
      orderBy: { invited_at: 'asc' },
    });
    return success({ visible: membership?.public_profile_visible ?? null });
  } catch (error) {
    return databaseFailure('getSalonProfileVisibility_IO', error);
  }
}
