import { DB_CLIENT } from '@app/db/db.client';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import {
  AccountTypeValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';
import {
  failure,
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import type {
  DatabaseError,
  SerializationConflictError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { CLEARED_PAIR_REQUEST_CONTEXT } from '../pair-request.context';

/** Withdraw the caller's pending request, preserving a thread with real messages. */
export const cancelPairRequest_IO = async ({
  client_user_id,
  stylist_account_id,
}: {
  client_user_id: string;
  stylist_account_id: string;
}): Promise<
  OperationResult<
    { success: boolean },
    DatabaseError | SerializationConflictError
  >
> => {
  const pending = {
    client_user_id,
    stylist_account_id,
    status: PairingStatusValue.PENDING,
  };
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await DB_CLIENT.use.$transaction(
        async tx => {
          // DECISION: a message and its pair activity are written together.
          // Use the same isolation level as sending so a concurrent first
          // message cannot commit while the withdrawal closes its thread.
          const pair = await tx.clientStylistPair.findFirst({
            where: pending,
            select: {
              id: true,
              paired_at: true,
              last_pair_request_at: true,
              messages: {
                where: { kind: 'TEXT' },
                select: { id: true },
                take: 1,
              },
            },
          });
          if (!pair) {
            return success({ success: false });
          }

          const { count } = await tx.clientStylistPair.updateMany({
            where: { ...pending, id: pair.id },
            data: {
              ...CLEARED_PAIR_REQUEST_CONTEXT,
              last_pair_request_at: pair.last_pair_request_at ?? pair.paired_at,
              ...(pair.messages.length > 0
                ? { status: PairingStatusValue.CONTACT }
                : {
                    status: PairingStatusValue.REVOKED,
                    revoked_at: new Date(),
                    revoked_by: AccountTypeValue.CLIENT,
                  }),
            },
          });
          return success({ success: count === 1 });
        },
        { isolationLevel: 'Serializable' }
      );
    } catch (error) {
      if (!isSerializationConflict(error)) {
        return databaseFailure('cancelPairRequest_IO', error);
      }
      if (attempt === maxAttempts) {
        return failure({ type: 'SERIALIZATION_CONFLICT' });
      }
    }
  }
  return failure({ type: 'SERIALIZATION_CONFLICT' });
};
