import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  failure,
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import type {
  SessionContainerInvalidStateError,
  SessionContainerNotAuthorizedError,
} from '@kernel/domain/session-container/session-container-errors.types';
import { lockSessionActivityContext } from '../session-activity.lock';
import { writeSessionActivity } from '../session-activity.write';
import {
  mapSessionToDTO,
  toDtoLifecycleState,
} from './session-container-shared.operations';

export const acceptSessionContainer_IO = async (input: {
  session_id: string;
  stylist_account_id: string;
  user_id: string;
}): Promise<
  OperationResult<
    SessionContainerDTO,
    | SessionContainerInvalidStateError
    | SessionContainerNotAuthorizedError
    | DatabaseError
  >
> => {
  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      const context = await lockSessionActivityContext(tx, input.session_id);
      const denied = () =>
        failure({
          type: 'SESSION_CONTAINER_NOT_AUTHORIZED' as const,
          sessionId: input.session_id,
          userId: input.user_id,
        });
      if (
        !context ||
        context.session.stylist_account_id !== input.stylist_account_id ||
        !context.activePairId ||
        !context.session.shared_at
      ) {
        return denied();
      }
      const { session, activePairId, activityAt } = context;
      const count = await tx.sessionContainerPhoto.count({
        where: { session_id: session.id },
      });
      if (session.accepted_at) {
        return success(mapSessionToDTO(session, count, 'stylist'));
      }
      if (
        !['SHARED', 'ACTIVE'].includes(session.lifecycle_state) ||
        session.closed_at ||
        !session.expires_at ||
        session.expires_at <= new Date()
      ) {
        return failure({
          type: 'SESSION_CONTAINER_INVALID_STATE' as const,
          sessionId: session.id,
          currentState: toDtoLifecycleState(session.lifecycle_state),
          attemptedAction: 'ACCEPT',
        });
      }
      const updated = await tx.sessionContainer.update({
        where: { id: session.id },
        data: { accepted_at: activityAt },
      });
      await writeSessionActivity(tx, {
        sessionId: session.id,
        pairId: activePairId,
        kind: 'SESSION_ACCEPTED',
        activityAt,
      });
      return success(mapSessionToDTO(updated, count, 'stylist'));
    });
  } catch (error) {
    return databaseFailure('acceptSessionContainer', error);
  }
};
