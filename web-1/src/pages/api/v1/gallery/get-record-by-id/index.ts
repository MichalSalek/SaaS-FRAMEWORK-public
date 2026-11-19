import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { getGalleryRecordByID_IO } from '@domain/gallery/operations/gallery-detail.query';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.GET_GALLERY_RECORD_BY_ID, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    if (!input.gallery_record_id) {
      return respondValidationFailed(res, { gallery_record_id: 'Required' });
    }

    const result = await getGalleryRecordByID_IO({
      gallery_record_id: input.gallery_record_id,
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_FETCHED);
  },
});
