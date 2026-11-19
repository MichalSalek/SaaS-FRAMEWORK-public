import type { Prisma } from '../../../prisma/js-client';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type {
  SessionContainerInvalidStateError,
  SessionContainerNotAuthorizedError,
} from '@kernel/domain/session-container/session-container-errors.types';
import { lockSessionActivityContext } from '../session-activity.lock';
import { writeSessionActivity } from '../session-activity.write';
import {
  isClosedOrExpired,
  isPastTtl,
  toDtoLifecycleState,
  type SessionRowWithClient,
} from './session-container-shared.operations';
/** Called only inside the note operation's transaction, after its actor guard. */
export const writeSessionNoteLocked_IO = async (
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string;
    userId: string;
    side: 'client' | 'stylist';
    noteValue: string | null;
  }
): Promise<
  OperationResult<
    SessionRowWithClient,
    SessionContainerInvalidStateError | SessionContainerNotAuthorizedError
  >
> => {
  const activity = await lockSessionActivityContext(tx, input.sessionId);
  if (
    !activity ||
    (input.side === 'stylist' && !activity.activePairId) ||
    (activity.session.shared_at && !activity.activePairId)
  ) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: input.sessionId,
      userId: input.userId,
    });
  }
  const fresh = activity.session;
  if (
    isClosedOrExpired(toDtoLifecycleState(fresh.lifecycle_state)) ||
    isPastTtl(fresh.expires_at)
  ) {
    return failure({
      type: 'SESSION_CONTAINER_INVALID_STATE',
      sessionId: input.sessionId,
      currentState: toDtoLifecycleState(fresh.lifecycle_state),
      attemptedAction: 'SET_NOTE',
    });
  }
  if (
    (input.side === 'stylist' ? fresh.stylist_note : fresh.client_note) ===
    input.noteValue
  ) {
    return success(fresh);
  }
  const updated = await tx.sessionContainer.update({
    where: { id: input.sessionId },
    data:
      input.side === 'stylist'
        ? { stylist_note: input.noteValue }
        : { client_note: input.noteValue },
  });
  if (input.side === 'client' && activity.activePairId) {
    await writeSessionActivity(tx, {
      sessionId: input.sessionId,
      pairId: activity.activePairId,
      kind: 'SESSION_CHANGED',
      changeScope: 'NOTE',
      activityAt: activity.activityAt,
    });
    if (fresh.accepted_at) {
      return success(
        await tx.sessionContainer.findUniqueOrThrow({
          where: { id: input.sessionId },
        })
      );
    }
  }
  return success(updated);
};
