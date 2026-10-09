import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import { toSafeCurrentUser } from '@domain/user/user.utils.api';
export default defineHandler<
  SESSION_DTO_API_V1['SESSION_GET_CURRENT']['REQUEST'],
  SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.SESSION.SESSION_GET_CURRENT,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, { currentUser, session }, _metadata, res) => {
    // DECISION (nie usuwaj tego komentarza): get-current to gorący poll endpoint
    // (sprawdzany przy każdej nawigacji/odświeżeniu sesji) — NIE logujemy e-maila
    // (PII) na każdym wywołaniu. id + session_id wystarczają do diagnostyki; e-mail
    // w info-logu na tej ścieżce to zbędny, powtarzalny wyciek PII do Event Log Store.
    reportIssueBackend({
      namespace: 'SESSION_GET_CURRENT',
      message:
        currentUser != null
          ? 'Session check: active'
          : 'Session check: no active session',
      payload:
        currentUser != null
          ? { id: currentUser.id, session_id: session?.id }
          : null,
      mode: 'info',
    });

    // Jeden sanitizer dla każdej odpowiedzi z CurrentUser (token sesji, relacje
    // spoza kontraktu, allowlista `stylist_account`) — inline destructure tutaj
    // przepuszczał cały wiersz StylistAccount razem z polami billingowymi.
    const safeData =
      currentUser != null ? toSafeCurrentUser(currentUser) : undefined;

    respondSuccess(res, safeData, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
