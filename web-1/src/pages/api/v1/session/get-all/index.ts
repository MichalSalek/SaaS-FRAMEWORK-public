import { defineEndpoint } from '@app/http/define-endpoint';
import { SESSION_CONTRACTS } from '@kernel/domain/session/session.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { getAllSessionsOfUser_IO } from '@domain/user/operations/user-session.operations';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(SESSION_CONTRACTS.SESSION_GET_ALL, {
  handle: async ({ input, ctx, ok }) => {
    const { currentUser, session } = requireAuthenticatedContext(ctx);
    const cursor = input.cursor;
    const take = Math.min(Math.max(input.take, 1), 100);

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

    // DECISION: the token MUST be stripped from the response (a token leaked via XSS on one device would
    // harvest the tokens of all devices). is_current is computed server-side from Session.id (PK, safe to
    // expose), so the frontend needs no token to mark the current session; the id comes from the auth
    // context (Better Auth -> currentUser.session.id).
    const currentSessionId = session?.id ?? null;
    const safeSessions = sessions.map(
      ({ userId: _uid, token: _tok, ...safe }) => ({
        ...safe,
        is_current: currentSessionId !== null && safe.id === currentSessionId,
      })
    );

    ok(
      { sessions: safeSessions, nextCursor },
      APP_EVENTS.INFO.APPLICATION.SUCCESS
    );
  },
});
