// Pairing errors (kernel `PairingError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { PairingError } from '@kernel/domain/pairing/pairing-errors.types';
import {
  respondBadRequest,
  respondNotFound,
  respondTooManyRequests,
} from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';
import { respondPlanLimit } from './shared.responders';

export const pairingErrorMap = {
  // Permanent QR code (2026-07-11): anti-oracle 404. A request (someone else's or not PENDING) and
  // a request target (missing, inactive or own stylist) share one shape.
  PAIR_REQUEST_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_NOT_FOUND, {
      pairId: error.pairId,
    }),

  // D3 (2026-09-05): the mask STAYS (404, one shape for a missing / inactive / own stylist AND a
  // disconnection on her side); only the event differs, so the front shows a neutral "could not
  // send the request" that reveals no refusal and leaves no lasting "disabled" state.
  PAIR_REQUEST_STYLIST_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_UNAVAILABLE, {
      stylistAccountId: error.stylistAccountId,
    }),

  PAIRING_SESSION_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.PAIRING.PAIRING_NOT_FOUND, {
      sessionId: error.sessionId,
    }),

  PAIRING_LIMIT_REACHED: respondPlanLimit,

  PAIRING_CODE_INVALID: (res, error) => {
    const pairingCodeEventMap = {
      NOT_FOUND: APP_EVENTS.INFO.PAIRING.INVALID_PAIRING_TOKEN,
      EXPIRED: APP_EVENTS.INFO.PAIRING.PAIRING_TOKEN_EXPIRED,
      REVOKED: APP_EVENTS.INFO.PAIRING.PAIRING_TOKEN_REVOKED,
      ALREADY_CLAIMED: APP_EVENTS.INFO.PAIRING.PAIRING_TOKEN_ALREADY_CLAIMED,
      STYLIST_INACTIVE: APP_EVENTS.INFO.PAIRING.PAIRING_STYLIST_INACTIVE,
    } as const;
    return respondBadRequest(res, pairingCodeEventMap[error.reason], {
      code: error.code,
      reason: error.reason,
    });
  },

  PAIRING_TOO_MANY_ACTIVE_SESSIONS: (res, error) =>
    respondTooManyRequests(
      res,
      APP_EVENTS.INFO.PAIRING.TOO_MANY_ACTIVE_SESSIONS,
      { currentCount: error.currentCount, limit: error.limit }
    ),
} satisfies ErrorResponderMap<OwnErrors<PairingError>>;
