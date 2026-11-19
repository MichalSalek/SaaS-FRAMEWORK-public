// Client errors (kernel `ClientError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { ClientError } from '@kernel/domain/client/client-errors.types';
import { respondForbidden, respondNotFound } from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';

export const clientErrorMap = {
  CLIENT_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
      clientId: error.clientId,
    }),

  CLIENT_UNAUTHORIZED_ACCESS: (res, error) =>
    // SECURITY: do NOT echo stylistAccountId: it is an internal cuid resolved server-side from the
    // stylist's user id (not caller input), and leaking it in a 403 body exposes an internal
    // account identifier. clientId is the caller's own input.
    respondForbidden(
      res,
      { clientId: error.clientId },
      APP_EVENTS.INFO.CLIENT.NOT_PAIRED_WITH_CLIENT
    ),
} satisfies ErrorResponderMap<OwnErrors<ClientError>>;
