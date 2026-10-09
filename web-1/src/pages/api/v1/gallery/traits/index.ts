import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { getActiveTraits_IO } from '@domain/gallery/operations/gallery-reference-data.operations';
import type { TraitCategory } from '@kernel/models/db_models.manual.dto';
import { TRAIT_CATEGORIES } from '@kernel/domain/admin/traits.config';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
export default defineHandler<
  undefined,
  GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.GALLERY.GET_TRAITS,
  method: 'get',
  validate: VALIDATION_POLICY.validators.getTraits,
  handle: async (_body, _ctx, _metadata, res, req) => {
    const rawCategory =
      typeof req.query.category === 'string' ? req.query.category : undefined;
    const categoryFilter =
      rawCategory &&
      (TRAIT_CATEGORIES as readonly string[]).includes(rawCategory)
        ? (rawCategory as TraitCategory)
        : undefined;

    const result = await getActiveTraits_IO(
      categoryFilter ? { category: categoryFilter } : {}
    );
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.GALLERY.TRAITS_FETCHED);
  },
});
