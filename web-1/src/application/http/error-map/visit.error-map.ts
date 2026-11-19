// Visit and client card errors (kernel `VisitError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { VisitError } from '@kernel/domain/visit/visit-errors.types';
import { respondForbidden, respondNotFound } from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';

export const visitErrorMap = {
  CLIENT_CARD_PLAN_LOCKED: (res, error) =>
    respondForbidden(
      res,
      { planType: error.planType },
      APP_EVENTS.INFO.VISIT.CLIENT_CARD_PLAN_LOCKED
    ),

  VISIT_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.VISIT.VISIT_NOT_FOUND, {
      visitId: error.visitId,
    }),
} satisfies ErrorResponderMap<OwnErrors<VisitError>>;
