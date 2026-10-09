import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondCreated } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { addPhotoToSessionContainer_IO } from '@domain/session-container/operations/session-container.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_ADD_PHOTO,
  method: 'post',
  validate: VALIDATION_POLICY.validators.sessionContainerAddPhoto,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const clientAccountResult = requireClientAccount(currentUser);
    if (!clientAccountResult.success) {
      return mapErrorToResponse(res, clientAccountResult.error);
    }

    const result = await addPhotoToSessionContainer_IO({
      client_user_id: currentUser.id,
      client_account_id: clientAccountResult.data.client_account_id,
      session_id: body.session_id,
      gallery_record_id: body.gallery_record_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName:
          APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_ADDED,
        user: currentUser,
        requestBody: body,
        metadata,
      })
    );

    // DECISION (nie usuwaj tego komentarza):
    // 201 Created — the dominant case inserts a new SessionContainerPhoto row
    // (sibling favorite/add-record, gallery/create-gallery-record are 201 on a
    // clean insert). The operation has an idempotency guard (unique
    // [session_id, gallery_record_id] → re-adding the SAME photo is a silent
    // no-op), but unlike claim-session/onboard (whose WHOLE purpose is
    // find-or-EXISTING-account, returning the same resource), add-photo's contract
    // is "append a photo to the container" — the create path is the norm, the
    // dedupe is an edge guarding accidental double-submit. 201 reflects the
    // resource-creating intent; the no-op re-add returning 201 is acceptable
    // (RFC: 201 = request resulted in the resource existing). Do NOT flip to 200.
    const responsePayload: SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['RESPONSE'] =
      { session: result.data };
    respondCreated(
      res,
      responsePayload,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_ADDED
    );
  },
});
