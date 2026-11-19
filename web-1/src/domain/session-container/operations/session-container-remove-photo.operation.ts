import { lockSessionActivityContext } from '../session-activity.lock';
import { writeSessionActivity } from '../session-activity.write';
/**
 * SessionContainer REMOVE-PHOTO operation (R8)
 *
 * The mirror of session-container-add-photo.operation.ts: the owning client takes
 * a photo back out of her inspiration session while the session is still open.
 * Own file for the same reason as add-photo and share (ESLint max-lines).
 */

import { DB_CLIENT } from '@app/db/db.client';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { failure } from '@kernel/application/result.types';
import type {
  SessionContainerNotAuthorizedError,
  SessionContainerNotFoundError,
  SessionContainerInvalidStateError,
} from '@kernel/domain/session-container/session-container-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  toDtoLifecycleState,
  isClosedOrExpired,
  isPastTtl,
} from './session-container-shared.operations';
import { loadSessionDetail_IO } from './session-container-queries.operations';

type RemovalOutcome =
  | { closed: false }
  | { closed: true; freshState: ReturnType<typeof toDtoLifecycleState> | null };

export const removePhotoFromSessionContainer_IO = async ({
  client_user_id,
  client_account_id,
  session_id,
  gallery_record_id,
}: {
  client_user_id: string;
  client_account_id: string;
  session_id: string;
  gallery_record_id: string;
}): Promise<
  OperationResult<
    SessionContainerDetailDTO,
    | SessionContainerNotFoundError
    | SessionContainerNotAuthorizedError
    | SessionContainerInvalidStateError
    | DatabaseError
  >
> => {
  let session;
  try {
    session = await DB_CLIENT.use.sessionContainer.findUnique({
      where: { id: session_id },
      select: {
        client_account_id: true,
        lifecycle_state: true,
        expires_at: true,
      },
    });
  } catch (error) {
    return databaseFailure('removePhotoFromSessionContainer:fetch', error);
  }

  if (!session) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_FOUND',
      sessionId: session_id,
    });
  }

  // Same answers as add-photo for a missing and for a foreign session.
  if (session.client_account_id !== client_account_id) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: session_id,
      userId: client_user_id,
    });
  }

  // Same state and TTL guard as add-photo: a CLOSED / EXPIRED session, or one past expires_at that the sweep has not reached
  // yet, is frozen in both directions.
  const currentState = toDtoLifecycleState(session.lifecycle_state);
  if (isClosedOrExpired(currentState) || isPastTtl(session.expires_at)) {
    return failure({
      type: 'SESSION_CONTAINER_INVALID_STATE',
      sessionId: session_id,
      currentState,
      attemptedAction: 'REMOVE_PHOTO',
    });
  }

  // DECISION: no pairing check and no gallery-record lookup, unlike add-photo. Removal only takes the client's own choice back,
  // so it must keep working after the pairing was revoked, after the stylist was taken down and after the record was hidden by
  // moderation: those are exactly the photos she may want out of her session. The record id is only a key of her own session rows.

  let outcome: RemovalOutcome;
  try {
    outcome = await DB_CLIENT.use.$transaction(
      async (tx): Promise<RemovalOutcome> => {
        // DECISION: the same per-session row lock add-photo takes, FIRST in the TX. It serializes this removal with concurrent
        // add-photo / remove-photo calls, so "no photos left" and the READY -> DRAFT step below are decided against committed state.
        // Without it, removing the last photo could demote the session while a concurrent add-photo, which saw READY, inserted a
        // photo and left the state alone: a DRAFT with photos.
        const activity = await lockSessionActivityContext(tx, session_id);
        const locked = activity?.session;
        if (!locked) {
          return { closed: true, freshState: null };
        }

        // Re-read the state inside the TX: a close or an expiry may have landed
        // between the pre-flight read and the lock (same window as add-photo).
        const freshSession = await tx.sessionContainer.findUnique({
          where: { id: session_id },
          select: { lifecycle_state: true, expires_at: true },
        });
        if (!freshSession) {
          return { closed: true, freshState: null };
        }
        const freshState = toDtoLifecycleState(freshSession.lifecycle_state);
        if (
          isClosedOrExpired(freshState) ||
          isPastTtl(freshSession.expires_at)
        ) {
          return { closed: true, freshState };
        }

        // Idempotent: deleteMany on the unique pair removes one row or none and
        // never throws on a miss.
        //
        // DECISION: the remaining photos keep their `position`; the gap is deliberate. Every reader only ORDERS by position
        // (loadSessionDetail_IO, mapSessionToDetailDTO), nothing reads it as a dense index, and add-photo appends at
        // max(position)+1, which stays unique with gaps. Renumbering would rewrite rows under @@unique([session_id, position]) for
        // no reader.
        const removed = await tx.sessionContainerPhoto.deleteMany({
          where: { session_id, gallery_record_id },
        });

        // The inverse of add-photo's DRAFT → READY on the first photo. SHARED and
        // ACTIVE keep their state with zero photos (the stylist's screen has an
        // empty state for it); stylist_account_id is never touched here.
        if (
          removed.count > 0 &&
          freshState === SessionContainerLifecycleStateValue.READY
        ) {
          const remaining = await tx.sessionContainerPhoto.count({
            where: { session_id },
          });
          if (remaining === 0) {
            await tx.sessionContainer.update({
              where: { id: session_id },
              data: {
                lifecycle_state: SessionContainerLifecycleStateValue.DRAFT,
              },
            });
          }
        }

        if (removed.count > 0 && activity?.activePairId) {
          await writeSessionActivity(tx, {
            sessionId: session_id,
            pairId: activity.activePairId,
            kind: 'SESSION_CHANGED',
            changeScope: 'PHOTOS',
            activityAt: activity.activityAt,
          });
        }
        return { closed: false };
      }
    );
  } catch (error) {
    return databaseFailure(
      'removePhotoFromSessionContainer:transaction',
      error
    );
  }

  // The lock found no row, or the session was closed / expired in the TX window.
  // Nothing was written; answer like the pre-flight guard (add-photo does the same).
  if (outcome.closed) {
    return failure({
      type: 'SESSION_CONTAINER_INVALID_STATE',
      sessionId: session_id,
      currentState: outcome.freshState ?? currentState,
      attemptedAction: 'REMOVE_PHOTO',
    });
  }

  return await loadSessionDetail_IO(session_id);
};
