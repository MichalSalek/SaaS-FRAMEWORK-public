import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { updateGalleryRecord_IO } from '@domain/gallery/operations/gallery-update.operation';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['REQUEST'],
  GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.GALLERY.UPDATE_GALLERY_RECORD,
  method: 'post',
  validate: VALIDATION_POLICY.validators.updateGalleryRecord,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    // SECURITY: session-derived account_id MUST override any body field of the
    // same name. Spreading body LAST would let attackers target other users'
    // records by injecting body.created_by_account_id.
    const result = await updateGalleryRecord_IO({
      props: {
        ...body,
        created_by_account_id: accountCheck.data.account_id,
      },
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['RESPONSE'] =
      {
        gallery_record_id: result.data.gallery_record_id,
        nail_length: result.data.nail_length,
        colors: result.data.colors,
        traits: result.data.traits,
      };

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_UPDATED,
        user: currentUser,
        requestBody: body,
        metadata,
      })
    );

    respondSuccess(res, responsePayload);
  },
});
