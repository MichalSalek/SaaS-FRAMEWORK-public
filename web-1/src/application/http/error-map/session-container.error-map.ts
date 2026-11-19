// Inspiration Session errors (kernel `SessionContainerError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { SessionContainerError } from '@kernel/domain/session-container/session-container-errors.types';
import {
  respondBadRequest,
  respondConflict,
  respondForbidden,
  respondNotFound,
  respondTooManyRequests,
} from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';

export const sessionContainerErrorMap = {
  SESSION_CONTAINER_NOT_FOUND: (res, error) =>
    respondNotFound(
      res,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_FOUND,
      {
        sessionId: error.sessionId,
      }
    ),

  SESSION_CONTAINER_NOT_AUTHORIZED: (res, error) =>
    respondForbidden(
      res,
      { sessionId: error.sessionId },
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_AUTHORIZED
    ),

  SESSION_CONTAINER_NOT_PAIRED: (res, error) =>
    respondForbidden(
      res,
      {
        clientUserId: error.clientUserId,
        stylistAccountId: error.stylistAccountId,
      },
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_PAIRED
    ),

  SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED: (res, error) =>
    respondTooManyRequests(
      res,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED,
      {
        clientAccountId: error.clientAccountId,
        currentCount: error.currentCount,
        limit: error.limit,
      }
    ),

  SESSION_CONTAINER_INVALID_STATE: (res, error) =>
    respondBadRequest(
      res,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_INVALID_STATE,
      {
        sessionId: error.sessionId,
        currentState: error.currentState,
        attemptedAction: error.attemptedAction,
      }
    ),

  SESSION_CONTAINER_EMPTY: (res, error) =>
    respondBadRequest(
      res,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_EMPTY,
      {
        sessionId: error.sessionId,
      }
    ),

  SESSION_CONTAINER_PHOTO_OWNERSHIP: (res, error) =>
    respondForbidden(
      res,
      {
        sessionId: error.sessionId,
        galleryRecordId: error.galleryRecordId,
        expectedStylistAccountId: error.expectedStylistAccountId,
      },
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_OWNERSHIP
    ),

  SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED: (res, error) =>
    respondTooManyRequests(
      res,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED,
      {
        stylistAccountId: error.stylistAccountId,
        currentCount: error.currentCount,
        limit: error.limit,
      }
    ),

  // A pair conflict, not a quota: the client owns the other open session, so its id is hers to
  // read (the front leads into it).
  SESSION_CONTAINER_PAIR_SESSION_EXISTS: (res, error) =>
    respondConflict(
      res,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PAIR_SESSION_EXISTS,
      {
        sessionId: error.sessionId,
        existingSessionId: error.existingSessionId,
      }
    ),
} satisfies ErrorResponderMap<OwnErrors<SessionContainerError>>;
