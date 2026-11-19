import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { failure, success } from '@kernel/application/result.types';
import type { CurrentUser } from '@kernel/models/user/user.types';
import { sendMessage_IO } from '@domain/messaging/operations/messaging-write.operations';
import { ensureSalonPairing_IO } from './salon-access.resolver';
class ContactMessageFailure extends Error {
  constructor(readonly result: Awaited<ReturnType<typeof sendMessage_IO>>) {
    super('Salon first message rejected');
  }
}
// DECISION: a colleague gets the client only after the first message commits. Pair creation and the existing
// message writer share ONE serializable transaction, so a rate limit or failure rolls back the prospective
// contact too.
export async function contactSalonStylist_IO(
  currentUser: CurrentUser,
  stylistAccountId: string,
  content: string
) {
  try {
    return await DB_CLIENT.use.$transaction(
      async tx => {
        const pair = await ensureSalonPairing_IO(
          currentUser.id,
          stylistAccountId,
          tx
        );
        if (!pair) {
          return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
        }
        const sent = await sendMessage_IO({
          currentUser,
          pairId: pair.id,
          content,
          tx,
        });
        if (!sent.success) {
          throw new ContactMessageFailure(sent);
        }
        return success({ pairId: pair.id, sent: sent.data });
      },
      { isolationLevel: 'Serializable' }
    );
  } catch (error) {
    if (error instanceof ContactMessageFailure && !error.result.success) {
      return error.result;
    }
    if (isSerializationConflict(error)) {
      return failure({ type: 'SERIALIZATION_CONFLICT' as const });
    }
    return databaseFailure('salonContact', error);
  }
}
