import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { unpinGalleryRecord_IO } from '@domain/gallery/operations/gallery-pin.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.GALLERY_UNPIN_RECORD, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await unpinGalleryRecord_IO({
      gallery_record_id: input.gallery_record_id,
      stylist_account_id: accountCheck.data.account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_UNPINNED, {
      user: currentUser,
      requestBody: input,
    });

    ok(
      { success: true, pinned_count: result.data.pinnedCount },
      APP_EVENTS.INFO.APPLICATION.SUCCESS
    );
  },
});
