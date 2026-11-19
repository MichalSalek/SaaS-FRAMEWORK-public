import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { deleteAssetFromVendor_IO } from '@domain/gallery/operations/gallery-asset.operations';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

// DECISION: standalone Cloudinary delete (without DB record cleanup), reserved for "cancel upload
// mid-flow" (before the record is committed). Has retry logic. Different from DELETE_GALLERY_RECORD,
// which deletes the DB record plus async cleanup.
export default defineEndpoint(GALLERY_CONTRACTS.DELETE_ASSET_FROM_VENDOR, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const guard = requireStylistAccount(currentUser);
    if (!guard.success) {
      mapErrorToResponse(res, guard.error);
      return;
    }

    const result = await deleteAssetFromVendor_IO({
      assetID: input.asset_id,
      userID: currentUser.id,
      stylistAccountId: guard.data.account_id,
    });

    if (!result.success) {
      mapErrorToResponse(res, result.error);
      return;
    }

    audit(APP_EVENTS.INFO.GALLERY.ASSET_DELETED_FROM_VENDOR, {
      user: { id: currentUser.id },
      requestBody: input,
    });

    ok(undefined, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
