import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { getAllSessionsOfUser_IO } from '@domain/user/operations/user-session.operations';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { qStr, qInt } from '@app/http/query-params.utils';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SESSION_DTO_API_V1['SESSION_GET_ALL']['REQUEST'],
  SESSION_DTO_API_V1['SESSION_GET_ALL']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.SESSION.SESSION_GET_ALL,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser, session } = requireAuthenticatedContext(ctx);
    const cursor = qStr(req.query, 'cursor') ?? undefined;
    const take = Math.min(Math.max(qInt(req.query, 'take') ?? 50, 1), 100);

    const { sessions, nextCursor } = await getAllSessionsOfUser_IO({
      id: currentUser.id,
      ...(cursor !== undefined && { cursor }),
      take,
      viewerSessionToken: session.token,
    });

    // getAllSessionsOfUser_IO returns ONLY live sessions (expires > now, newest
    // first) — no active/expired split needed here anymore.
    reportIssueBackend({
      namespace: 'SESSION_GET_ALL',
      message: 'User sessions fetched successfully',
      payload: {
        id: currentUser.id,
        session_count: sessions.length,
        latest_expiry: sessions[0]?.expires ?? null,
      },
      mode: 'info',
    });

    // DECISION (nie usuwaj tego komentarza):
    // Token MUSI byc strippowany z odpowiedzi (token leak via XSS na jednym device
    // = harvest tokenow wszystkich device'ow). is_current liczone server-side po
    // Session.id (PK, bezpieczne do ekspozycji) — frontend nie potrzebuje tokenu
    // do oznaczenia biezacej sesji. Identyfikacja "current" przez session.id
    // pochodzacy z auth context (Better Auth → currentUser.session.id).
    const currentSessionId = session?.id ?? null;
    const safeSessions = sessions.map(
      ({ userId: _uid, token: _tok, ...safe }) => ({
        ...safe,
        is_current: currentSessionId !== null && safe.id === currentSessionId,
      })
    );

    respondSuccess(
      res,
      { sessions: safeSessions, nextCursor },
      APP_EVENTS.INFO.APPLICATION.SUCCESS
    );
  },
});
