import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { deleteGalleryRecord_IO } from '@domain/gallery/operations/gallery-delete.operation';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineHandler<
  GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['REQUEST'],
  GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.GALLERY.DELETE_GALLERY_RECORD,
  method: 'post',
  validate: VALIDATION_POLICY.validators.deleteGalleryRecord,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await deleteGalleryRecord_IO({
      gallery_record_id: body.gallery_record_id,
      id: currentUser.id,
      account_id: accountCheck.data.account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['RESPONSE'] =
      {
        success: true,
        gallery_record_id: body.gallery_record_id,
      };

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_DELETED,
        user: currentUser,
        requestBody: body,
        metadata,
      })
    );

    respondSuccess(res, responsePayload);
  },
});
