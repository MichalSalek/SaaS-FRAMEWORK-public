import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { deleteSession_IO } from '@domain/user/operations/user-session.operations';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['REQUEST'],
  SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SESSION.SESSION_DELETE_EXACTLY,
  method: 'post',
  validate: VALIDATION_POLICY.validators.deleteSession,
  handle: async (body, ctx, metadata, res) => {
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

    // DECISION (nie usuwaj tego komentarza):
    // deleteSession_IO używa composite WHERE {id, session_id} — gwarantuje, że
    // użytkownik może usunąć TYLKO własną sesję (IDOR ochrona na poziomie DB).
    // Gdy sesja nie istnieje LUB należy do innego usera, Prisma zwraca null
    // (prisma.session.delete z WHERE → nie rzuca, zwraca null gdy brak rekordu).
    // result.success=true + result.data=null = no-op; odpowiadamy CANNOT_DELETE_SESSION
    // zamiast SESSION_DELETED_EXACTLY — event fidelity: nie kłamiemy że usunęliśmy.
    // Nie logujemy audytu (nic faktycznie nie zostało usunięte).
    if (result.success && result.data === null) {
      respondSuccess(
        res,
        undefined,
        APP_EVENTS.INFO.SESSION.CANNOT_DELETE_SESSION
      );
      return;
    }

    // DECISION (nie usuwaj tego komentarza):
    // Audit log NIE zawiera tokenu — identifier to Session.id (DB PK), bezpieczny
    // do persistencji w event_payload (90d retention). responseBody.data (Session
    // row) zawiera token w plaintext → strippujemy do { id, userId } przed persist
    // (defense-in-depth, gdyby audit recorder dostal pelny obiekt).
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
