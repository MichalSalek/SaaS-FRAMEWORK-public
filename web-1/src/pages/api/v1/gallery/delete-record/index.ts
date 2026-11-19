import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { deleteGalleryRecord_IO } from '@domain/gallery/operations/gallery-delete.operation';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.DELETE_GALLERY_RECORD, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await deleteGalleryRecord_IO({
      gallery_record_id: input.gallery_record_id,
      id: currentUser.id,
      account_id: accountCheck.data.account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_DELETED, {
      user: currentUser,
      requestBody: input,
    });

    ok(
      { success: true, gallery_record_id: input.gallery_record_id },
      APP_EVENTS.INFO.APPLICATION.SUCCESS
    );
  },
});
