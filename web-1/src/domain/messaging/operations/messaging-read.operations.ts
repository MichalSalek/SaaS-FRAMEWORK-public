import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { MessagingError } from '@kernel/domain/messaging/messaging-errors.types';
import { StylistClientMessageSenderValue } from '@kernel/models/messaging/messaging.dto';
import type { CurrentUser } from '@kernel/models/user/user.types';
import { resolvePairSide, isCounterpartInactive } from '../messaging.helpers';
export const markRead_IO = async (params: {
  currentUser: CurrentUser;
  pairId: string;
  readThrough?: Date;
}): Promise<
  OperationResult<
    {
      pair_id: string;
      read_at: Date;
    },
    MessagingError | DatabaseError
  >
> => {
  const { currentUser, pairId } = params;
  try {
    const pair = await DB_CLIENT.use.clientStylistPair.findUnique({
      where: { id: pairId },
      select: {
        id: true,
        client_user_id: true,
        stylist_account_id: true,
        last_message_at: true,
        client_last_read_at: true,
        stylist_last_read_at: true,
        client_user: { select: { is_active: true } },
        stylist_account: {
          select: {
            account_status: true,
            created_by_user: { select: { is_active: true } },
          },
        },
      },
    });
    if (pair == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    const side = resolvePairSide(pair, currentUser);
    if (side == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    // Same gates as sendMessage_IO (see the counterpart visibility mask above).
    if (isCounterpartInactive(side, pair)) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    // With no activity there is nothing to read. A wall-clock watermark here
    // could pre-read the first message (or even all future messages if the
    // supplied cursor is in the future), including one committed concurrently.
    if (!pair.last_message_at) {
      return success({ pair_id: pairId, read_at: new Date(0) });
    }
    const requested = params.readThrough ?? new Date();
    const limit = pair.last_message_at;
    const readAt = requested < limit ? requested : limit;
    const field =
      side === StylistClientMessageSenderValue.CLIENT
        ? 'client_last_read_at'
        : 'stylist_last_read_at';
    await DB_CLIENT.use.clientStylistPair.updateMany({
      where: {
        id: pairId,
        OR: [{ [field]: null }, { [field]: { lt: readAt } }],
      },
      data: { [field]: readAt },
    });
    return success({ pair_id: pairId, read_at: readAt });
  } catch (error) {
    return databaseFailure('markRead', error);
  }
};
