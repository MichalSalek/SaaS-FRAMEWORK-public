import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { getGalleryRecordByID_IO } from '@domain/gallery/operations/gallery-detail.query';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { qStr } from '@app/http/query-params.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['REQUEST'],
  GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.GALLERY.GET_GALLERY_RECORD_BY_ID,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const gallery_record_id = qStr(req.query, 'gallery_record_id');
    if (!gallery_record_id) {
      return respondValidationFailed(res, { gallery_record_id: 'Required' });
    }

    const result = await getGalleryRecordByID_IO({
      gallery_record_id,
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_FETCHED
    );
  },
});
