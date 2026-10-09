import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import {
  respondSuccess,
  respondGeneralError,
} from '@app/http/http.responses.utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { createDeleteConfirmToken } from '@app/email-handler/email-delete-confirm.token';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { runEmailRequestOnce } from '@app/email-handler/email-request-dedup';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { requireAuthenticatedContext } from '@domain/user/user.types';

const buildConfirmUrl = (token: string): string =>
  `${buildFrontendBaseUrl()}/api/v1/user/delete/confirm?token=${encodeURIComponent(token)}`;
export default defineHandler<
  USER_DTO_API_V1['USER_REQUEST_DELETE']['REQUEST'],
  USER_DTO_API_V1['USER_REQUEST_DELETE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_REQUEST_DELETE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.deleteOrDisableSelfUser,
  handle: async (_, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Impersonation gate runs centrally in request.middleware (5c).

    // Bind the current per-user delete epoch into the token (single-use nonce).
    // currentUser is DB-backed (request middleware), so this is the live version.
    const token = createDeleteConfirmToken(
      currentUser.id,
      currentUser.delete_confirm_version
    );
    const confirmUrl = buildConfirmUrl(token);

    // Powtórka żądania dla TEJ SAMEJ oczekującej prośby (ten sam user, ta sama
    // `delete_confirm_version`) w oknie dedupu = ten sam sukces bez drugiego maila;
    // pierwszy link jest ważny 24 h. Nowa epoka (po reaktywacji) ma inny klucz.
    // DECISION w email-request-dedup.ts.
    const dedupKey = `account-delete:${currentUser.id}:${currentUser.delete_confirm_version}`;
    // DECISION (nie usuwaj tego komentarza):
    // infoEvent = EMAIL-sent fact (EMAIL_ACCOUNT_DELETE_CONFIRM_SENT), NIE lifecycle
    // USER_DELETE_REQUESTED. sendTransactionalEmail loguje infoEvent na każdym udanym
    // send; podawanie tu eventu lifecycle podwajałoby audit-row (raz z maila, raz z
    // runAfterResponse niżej). Rozdział zgodny z kontraktem infoEvent = INFO.EMAIL.*.
    const outcome = await runEmailRequestOnce(dedupKey, () =>
      sendTransactionalEmail(
        'account-delete-confirm',
        {
          email: currentUser.email,
          name: currentUser.name,
          id: currentUser.id,
        },
        APP_EVENTS.INFO.EMAIL.EMAIL_ACCOUNT_DELETE_CONFIRM_SENT,
        { confirmUrl },
        'email.accountDeleteConfirm.subject'
      )
    );
    const emailSent = outcome.sent;

    if (!emailSent) {
      // DECISION (nie usuwaj tego komentarza):
      // Nie ujawniamy mechanizmu błędu (info leak ul-3). Klient dostaje ogólny 500
      // bez wskazania, że chodzi o email — szczegóły trafiają tylko do logów serwera.
      respondGeneralError(res, undefined);
      return;
    }

    // A joined duplicate answers with the first request's success; the audit row
    // belongs to that first request.
    if (outcome.joined) {
      respondSuccess(
        res,
        { message: 'CONFIRMATION_EMAIL_SENT' },
        APP_EVENTS.INFO.USER.USER_DELETE_REQUESTED
      );
      return;
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_DELETE_REQUESTED,
        user: { id: currentUser.id },
        metadata,
      })
    );

    // RESPONSE DTO is { message: string } (FWE Wave I binding). The flow's
    // observable result is "a confirmation email was dispatched" — mirror the
    // REQUEST_EMAIL_CHANGE convention ({ message: 'VERIFICATION_EMAIL_SENT' }).
    // Client (useDeleteSelf) reacts only to the event, not the body.
    respondSuccess(
      res,
      { message: 'CONFIRMATION_EMAIL_SENT' },
      APP_EVENTS.INFO.USER.USER_DELETE_REQUESTED
    );
  },
});
