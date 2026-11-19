import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { updateGalleryRecord_IO } from '@domain/gallery/operations/gallery-update.operation';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.UPDATE_GALLERY_RECORD, {
  handle: async ({ input, ctx, res, ok, audit }) => {
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
        ...input,
        created_by_account_id: accountCheck.data.account_id,
      },
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_UPDATED, {
      user: currentUser,
      requestBody: input,
    });

    ok(
      {
        gallery_record_id: result.data.gallery_record_id,
        nail_length: result.data.nail_length,
        colors: result.data.colors,
        traits: result.data.traits,
      },
      APP_EVENTS.INFO.APPLICATION.SUCCESS
    );
  },
});
