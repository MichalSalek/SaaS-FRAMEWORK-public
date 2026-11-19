import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import {
  respondSuccess,
  respondGeneralError,
} from '@app/http/http.responses.utils';
import { createDeleteConfirmToken } from '@app/email-handler/email-delete-confirm.token';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { runEmailRequestOnce } from '@app/email-handler/email-request-dedup';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { requireAuthenticatedContext } from '@domain/user/user.types';

const buildConfirmUrl = (token: string): string =>
  `${buildFrontendBaseUrl()}/api/v1/user/delete/confirm?token=${encodeURIComponent(token)}`;
export default defineEndpoint(USER_CONTRACTS.USER_REQUEST_DELETE, {
  handle: async ({ ctx, meta: metadata, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Impersonation gate runs centrally in request.middleware (5c).

    // Bind the current per-user delete epoch into the token (single-use nonce).
    // currentUser is DB-backed (request middleware), so this is the live version.
    const token = createDeleteConfirmToken(
      currentUser.id,
      currentUser.delete_confirm_version
    );
    const confirmUrl = buildConfirmUrl(token);

    // A repeat for the SAME pending request (same user, same `delete_confirm_version`)
    // within the dedup window = the same success without a second mail; the first link is
    // valid for 24 h. A new epoch (after reactivation) has a different key. See the
    // DECISION in email-request-dedup.ts.
    const dedupKey = `account-delete:${currentUser.id}:${currentUser.delete_confirm_version}`;
    // DECISION: infoEvent is the EMAIL-sent fact (EMAIL_ACCOUNT_DELETE_CONFIRM_SENT), not the lifecycle
    // USER_DELETE_REQUESTED. sendTransactionalEmail logs infoEvent on every successful send; passing the
    // lifecycle event would double the audit row (once from the mail, once from runAfterResponse below).
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
      // DECISION: the failure mechanism is not disclosed (info leak ul-3): the client gets a generic 500 with
      // no hint that e-mail is involved; details go only to server logs.
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

    // RESPONSE DTO is { message: string }. The observable result is that a
    // confirmation email was dispatched, same shape as REQUEST_EMAIL_CHANGE
    // ({ message: 'VERIFICATION_EMAIL_SENT' }). useDeleteSelf reacts to the
    // event, not the body.
    respondSuccess(
      res,
      { message: 'CONFIRMATION_EMAIL_SENT' },
      APP_EVENTS.INFO.USER.USER_DELETE_REQUESTED
    );
  },
});
