import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { getActiveColors_IO } from '@domain/gallery/operations/gallery-reference-data.operations';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
export default defineHandler<
  undefined,
  GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.GALLERY.GET_COLORS,
  method: 'get',
  validate: VALIDATION_POLICY.validators.getColors,
  handle: async (_body, _ctx, _metadata, res) => {
    const result = await getActiveColors_IO();
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.GALLERY.COLORS_FETCHED);
  },
});
