import { defineEndpoint } from '@app/http/define-endpoint';
import { SESSION_CONTRACTS } from '@kernel/domain/session/session.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { deleteSession_IO } from '@domain/user/operations/user-session.operations';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(SESSION_CONTRACTS.SESSION_DELETE_EXACTLY, {
  handle: async ({ input: body, ctx, meta: metadata, res }) => {
    const { currentUser, session } = requireAuthenticatedContext(ctx);
    const result = await deleteSession_IO({
      id: currentUser.id,
      session_id: body.id,
      viewerSessionToken: session.token,
    });

    if (!result.success) {
      reportIssueBackend({
        namespace: 'SESSION_DELETE_EXACTLY',
        message: `Failed to delete session for user ${currentUser.id}`,
        payload: { id: currentUser.id, error: result.error },
        mode: 'error',
      });
      respondSuccess(
        res,
        undefined,
        APP_EVENTS.INFO.SESSION.CANNOT_DELETE_SESSION
      );
      return;
    }

    reportIssueBackend({
      namespace: 'SESSION_DELETE_EXACTLY',
      message: `Deleted session ${body.id} for user ${currentUser.id}`,
      payload: {
        session_id: body.id,
        id: currentUser.id,
      },
      mode: 'info',
    });

    // DECISION: deleteSession_IO uses a composite WHERE {id, session_id}, so a user can delete ONLY her own
    // session (IDOR protection at DB level). A session that does not exist or belongs to another user gives
    // success + data=null (no-op); we answer CANNOT_DELETE_SESSION instead of SESSION_DELETED_EXACTLY (event
    // fidelity: we do not claim a deletion) and write no audit (nothing was deleted).
    if (result.success && result.data === null) {
      respondSuccess(
        res,
        undefined,
        APP_EVENTS.INFO.SESSION.CANNOT_DELETE_SESSION
      );
      return;
    }

    // DECISION: the audit log carries no token. The identifier is Session.id (DB PK), safe to persist in
    // event_payload (90d retention). responseBody.data (the Session row) holds the token in plaintext, so it
    // is stripped to { id, userId } before persisting (defense in depth if the recorder got the full object).
    const auditResponse =
      result.success && result.data
        ? { id: result.data.id, userId: result.data.userId }
        : null;

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.SESSION.SESSION_DELETED_EXACTLY,
        user: currentUser,
        requestBody: { session_id: body.id },
        responseBody: auditResponse,
        metadata,
      })
    );

    respondSuccess(
      res,
      undefined,
      APP_EVENTS.INFO.SESSION.SESSION_DELETED_EXACTLY
    );
  },
});
