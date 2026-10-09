import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { getGalleryRecords_IO } from '@domain/gallery/operations/gallery-list.query';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { qStr, qBool, qInt, qStrArray } from '@app/http/query-params.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { VALIDATION_GALLERY } from '@kernel/policies/validation.config';
export default defineHandler<
  GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['REQUEST'],
  GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.GALLERY.GET_GALLERY_RECORDS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      mapErrorToResponse(res, accountCheck.error);
      return;
    }

    const gallery_record_id = qStr(req.query, 'gallery_record_id') ?? undefined;
    // Cap DoS: filtry rozwijają się w osobny warunek per identyfikator, więc
    // koszt zapytania rośnie nieliniowo (zmierzone: 200 identyfikatorów = 7 s
    // na jedno żądanie). SSOT limitu: VALIDATION_GALLERY.MAX_FILTER_*.
    const color_ids =
      qStrArray(req.query, 'color_ids')?.slice(
        0,
        VALIDATION_GALLERY.MAX_FILTER_COLOR_IDS
      ) ?? [];
    const trait_ids =
      qStrArray(req.query, 'trait_ids')?.slice(
        0,
        VALIDATION_GALLERY.MAX_FILTER_TRAIT_IDS
      ) ?? [];
    const apply_strict_filter =
      qBool(req.query, 'apply_strict_filter') ?? false;
    const cursor = qStr(req.query, 'cursor') ?? undefined;
    // Clamp take to prevent negative/zero take reaching Prisma. Default (50) +
    // cap (100) preserved: clamp keeps take in [1, 100]. The operation also
    // re-clamps via Math.min(Math.max(take, 1), 100) (defense in depth).
    const take = Math.min(Math.max(qInt(req.query, 'take') ?? 50, 1), 100);

    const result = await getGalleryRecords_IO({
      props: {
        created_by_account_id: accountCheck.data.account_id,
        ...(gallery_record_id !== undefined && { gallery_record_id }),
        color_ids,
        trait_ids,
        apply_strict_filter,
        ...(cursor !== undefined && { cursor }),
        take,
      },
    });

    if (!result.success) {
      mapErrorToResponse(res, result.error);
      return;
    }

    respondSuccess(res, result.data);
  },
});
