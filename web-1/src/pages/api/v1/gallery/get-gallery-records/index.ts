import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { getGalleryRecords_IO } from '@domain/gallery/operations/gallery-list.query';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { VALIDATION_GALLERY } from '@kernel/policies/validation.config';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.GET_GALLERY_RECORDS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      mapErrorToResponse(res, accountCheck.error);
      return;
    }

    // DoS cap: each filter id becomes its own condition, so query cost grows
    // non-linearly (measured: 200 ids = 7s per request). Limit SSOT:
    // VALIDATION_GALLERY.MAX_FILTER_*.
    const color_ids = (input.color_ids ?? []).slice(
      0,
      VALIDATION_GALLERY.MAX_FILTER_COLOR_IDS
    );
    const trait_ids = (input.trait_ids ?? []).slice(
      0,
      VALIDATION_GALLERY.MAX_FILTER_TRAIT_IDS
    );
    const apply_strict_filter = input.apply_strict_filter ?? false;
    // Clamp take to prevent negative/zero take reaching Prisma. Default (50) +
    // cap (100) preserved: clamp keeps take in [1, 100]. The operation also
    // re-clamps via Math.min(Math.max(take, 1), 100) (defense in depth).
    const take = Math.min(Math.max(input.take, 1), 100);

    const result = await getGalleryRecords_IO({
      props: {
        created_by_account_id: accountCheck.data.account_id,
        ...(input.gallery_record_id !== undefined && {
          gallery_record_id: input.gallery_record_id,
        }),
        color_ids,
        trait_ids,
        apply_strict_filter,
        ...(input.cursor !== undefined && { cursor: input.cursor }),
        take,
      },
    });

    if (!result.success) {
      mapErrorToResponse(res, result.error);
      return;
    }

    ok(result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
