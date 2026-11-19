import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getGalleryForPairedClient_IO } from '@domain/gallery/operations/gallery-paired-client.operations';
import { clampOffset } from '@app/http/query-params.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.GALLERY_GET_FOR_PAIRED_CLIENT, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    if (!input.stylist_account_id) {
      return respondValidationFailed(res, { stylist_account_id: 'Required' });
    }

    // Clamp pagination params before they reach Prisma. Lower bound prevents a
    // negative skip/take (Postgres error -> HTTP 503); upper bound (clampOffset)
    // prevents a huge offset overflowing Postgres bigint OFFSET (-> unmapped 500).
    // A missing limit or offset decodes to the operation default (50 and 0).
    const limit = Math.min(Math.max(input.limit, 1), 100);
    const offset = clampOffset(input.offset);

    const result = await getGalleryForPairedClient_IO({
      props: {
        stylist_account_id: input.stylist_account_id,
        limit,
        offset,
      },
      currentUserId: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.GALLERY.GALLERY_FOR_PAIRED_CLIENT_FETCHED);
  },
});
