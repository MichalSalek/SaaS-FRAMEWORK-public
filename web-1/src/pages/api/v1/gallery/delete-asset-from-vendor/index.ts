import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { deleteAssetFromVendor_IO } from '@domain/gallery/operations/gallery-asset.operations';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// DECISION (nie usuwaj tego komentarza):
// Standalone Cloudinary delete (without DB record cleanup) — reserved for "cancel upload mid-flow"
// capability (before record is committed to DB). Has retry logic (DD3-F5, 2026-05-26).
// Different from DELETE_GALLERY_RECORD which deletes DB record + async cleanup.
export default defineHandler<
  GALLERY_DTO_API_V1['DELETE_ASSET_FROM_VENDOR']['REQUEST'],
  GALLERY_DTO_API_V1['DELETE_ASSET_FROM_VENDOR']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.GALLERY.DELETE_ASSET_FROM_VENDOR,
  method: 'post',
  validate: VALIDATION_POLICY.validators.deleteAssetFromVendor,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const guard = requireStylistAccount(currentUser);
    if (!guard.success) {
      mapErrorToResponse(res, guard.error);
      return;
    }

    const result = await deleteAssetFromVendor_IO({
      assetID: body.asset_id,
      userID: currentUser.id,
      stylistAccountId: guard.data.account_id,
    });

    if (!result.success) {
      mapErrorToResponse(res, result.error);
      return;
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.GALLERY.ASSET_DELETED_FROM_VENDOR,
        user: { id: currentUser.id },
        requestBody: body,
        metadata,
      })
    );

    respondSuccess(res, undefined);
  },
});
