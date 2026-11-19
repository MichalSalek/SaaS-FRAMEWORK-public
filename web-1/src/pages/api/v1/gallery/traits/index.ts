import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getActiveTraits_IO } from '@domain/gallery/operations/gallery-reference-data.operations';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.GET_TRAITS, {
  handle: async ({ input, res, ok }) => {
    const result = await getActiveTraits_IO(
      input.category ? { category: input.category } : {}
    );
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.GALLERY.TRAITS_FETCHED);
  },
});
