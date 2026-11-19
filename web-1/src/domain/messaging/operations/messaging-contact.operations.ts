import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isP2002 } from '@app/db/prisma-error';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { failure, success } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { MessagingError } from '@kernel/domain/messaging/messaging-errors.types';
import {
  AccountStatusValue,
  AccountTypeValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';
import type { CurrentUser } from '@kernel/models/user/user.types';
import { resolvePairSide } from '../messaging.helpers';

/** Open the existing conversation or create only a contact, never a request. */
export async function openContact_IO(params: {
  currentUser: CurrentUser;
  stylistAccountId: string;
}): Promise<
  OperationResult<{ pair_id: string }, MessagingError | DatabaseError>
> {
  const { currentUser, stylistAccountId } = params;
  if (!currentUser.is_active || currentUser.client_account == null) {
    return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await DB_CLIENT.use.$transaction(
        async tx => {
          const stylist = await tx.stylistAccount.findUnique({
            where: { account_id: stylistAccountId },
            select: {
              account_status: true,
              created_by_user_id: true,
              created_by_user: { select: { is_active: true } },
            },
          });
          if (
            !stylist ||
            stylist.account_status !== AccountStatusValue.ACTIVE ||
            !stylist.created_by_user.is_active ||
            stylist.created_by_user_id === currentUser.id
          ) {
            return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
          }
          const pair = await tx.clientStylistPair.findUnique({
            where: {
              client_user_id_stylist_account_id: {
                client_user_id: currentUser.id,
                stylist_account_id: stylistAccountId,
              },
            },
            select: { id: true, status: true, revoked_by: true },
          });
          if (!pair) {
            const created = await tx.clientStylistPair.create({
              data: {
                client_user_id: currentUser.id,
                stylist_account_id: stylistAccountId,
                status: PairingStatusValue.CONTACT,
              },
              select: { id: true },
            });
            return success({ pair_id: created.id });
          }
          if (pair.status === PairingStatusValue.REVOKED) {
            // DECISION [pair-revoked-by]: legacy NULL follows the existing
            // client-ended interpretation. A recorded stylist decision remains final.
            if (pair.revoked_by === AccountTypeValue.STYLIST) {
              return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
            }
            const updated = await tx.clientStylistPair.updateMany({
              where: {
                id: pair.id,
                status: PairingStatusValue.REVOKED,
                revoked_by: pair.revoked_by,
              },
              data: { status: PairingStatusValue.CONTACT },
            });
            if (updated.count !== 1) {
              return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
            }
          }
          return success({ pair_id: pair.id });
        },
        { isolationLevel: 'Serializable' }
      );
    } catch (error) {
      if ((isP2002(error) || isSerializationConflict(error)) && attempt < 2) {
        continue;
      }
      return databaseFailure('openContact', error);
    }
  }
  return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' });
}

/** A party may end only a contact, retaining its history and mute markers. */
export async function endContact_IO(params: {
  currentUser: CurrentUser;
  pairId: string;
}): Promise<
  OperationResult<{ pair_id: string }, MessagingError | DatabaseError>
> {
  try {
    const pair = await DB_CLIENT.use.clientStylistPair.findUnique({
      where: { id: params.pairId },
      select: { id: true, client_user_id: true, stylist_account_id: true },
    });
    const side = pair && resolvePairSide(pair, params.currentUser);
    if (!pair || !side) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' });
    }
    const result = await DB_CLIENT.use.clientStylistPair.updateMany({
      where: { id: pair.id, status: PairingStatusValue.CONTACT },
      data: {
        status: PairingStatusValue.REVOKED,
        revoked_by:
          side === 'CLIENT'
            ? AccountTypeValue.CLIENT
            : AccountTypeValue.STYLIST,
        revoked_at: new Date(),
      },
    });
    if (result.count !== 1) {
      return failure({ type: 'MESSAGING_NOT_ALLOWED' });
    }
    return success({ pair_id: pair.id });
  } catch (error) {
    return databaseFailure('endContact', error);
  }
}
