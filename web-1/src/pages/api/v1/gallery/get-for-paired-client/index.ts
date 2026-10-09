import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { getGalleryForPairedClient_IO } from '@domain/gallery/operations/gallery-paired-client.operations';
import { qStr, qInt, clampOffset } from '@app/http/query-params.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['REQUEST'],
  GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.GALLERY.GALLERY_GET_FOR_PAIRED_CLIENT,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const stylist_account_id = qStr(req.query, 'stylist_account_id');
    if (!stylist_account_id) {
      return respondValidationFailed(res, { stylist_account_id: 'Required' });
    }

    // Clamp pagination params before they reach Prisma. Lower bound prevents a
    // negative skip/take (Postgres error -> HTTP 503); upper bound (clampOffset)
    // prevents a huge offset overflowing Postgres bigint OFFSET (-> unmapped 500).
    // Defaults (limit 50) + cap (100) stay in the operation: clamp only runs
    // when the param is present, so omitted params still hit the operation default.
    const limitRaw = qInt(req.query, 'limit');
    const offsetRaw = qInt(req.query, 'offset');
    const limit =
      limitRaw !== null ? Math.min(Math.max(limitRaw, 1), 100) : null;
    const offset = offsetRaw !== null ? clampOffset(offsetRaw) : null;

    const result = await getGalleryForPairedClient_IO({
      props: {
        stylist_account_id,
        ...(limit !== null && { limit }),
        ...(offset !== null && { offset }),
      },
      currentUserId: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.GALLERY.GALLERY_FOR_PAIRED_CLIENT_FETCHED
    );
  },
});
