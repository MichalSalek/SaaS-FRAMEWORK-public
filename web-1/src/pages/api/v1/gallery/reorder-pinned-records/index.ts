import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reorderPinnedGalleryRecords_IO } from '@domain/gallery/operations/gallery-pinned-order.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(
  GALLERY_CONTRACTS.GALLERY_REORDER_PINNED_RECORDS,
  {
    handle: async ({ input, ctx, res, ok }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const accountCheck = requireStylistAccount(currentUser);
      if (!accountCheck.success) {
        return mapErrorToResponse(res, accountCheck.error);
      }

      // The account comes from the session, never from the body: the operation
      // writes only rows of this account and only after the set check.
      const result = await reorderPinnedGalleryRecords_IO({
        stylist_account_id: accountCheck.data.account_id,
        gallery_record_ids: input.gallery_record_ids,
      });

      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }

      ok(
        { success: true, gallery_record_ids: result.data.galleryRecordIds },
        APP_EVENTS.INFO.GALLERY.GALLERY_PINNED_ORDER_UPDATED
      );
    },
  }
);
