import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { exploreGalleryRecords_IO } from '@domain/gallery/operations/gallery-explore.query';
import { VALIDATION_GALLERY } from '@kernel/policies/validation.config';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { requireExploreEnabled } from '@app/feature-flags/feature-flags.guard';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.EXPLORE_GALLERY_RECORDS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    // EXPLORE_ENABLED back-guard (after auth, before query). 404 when the discovery
    // feature is off — prevents serving the explore feed past the front route gate
    // (mirrors salon-staff kill-switch; closes the IDOR-class gap flagged in r31).
    if (!(await requireExploreEnabled(res))) {
      return;
    }

    res.setHeader('Cache-Control', 'no-store');

    const color_ids = input.color_ids?.slice(
      0,
      VALIDATION_GALLERY.MAX_FILTER_COLOR_IDS
    );
    const trait_ids = input.trait_ids?.slice(
      0,
      VALIDATION_GALLERY.MAX_FILTER_TRAIT_IDS
    );
    const apply_strict_filter = input.apply_strict_filter ?? false;
    // Clamp take to prevent negative/zero take reaching Prisma (would surface as
    // HTTP 503). Default (30) + cap (50) preserved: clamp keeps take in [1, 50].
    const take = Math.min(Math.max(input.take, 1), 50);

    const result = await exploreGalleryRecords_IO({
      ...(color_ids !== undefined && { color_ids }),
      ...(trait_ids !== undefined && { trait_ids }),
      ...(input.nail_length !== undefined && {
        nail_length: input.nail_length,
      }),
      apply_strict_filter,
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      take,
      ...(input.city !== undefined && { city: input.city }),
      ...(input.searchQuery !== undefined && {
        searchQuery: input.searchQuery,
      }),
      currentUserId: currentUser.id,
    });

    if (!result.success) {
      mapErrorToResponse(res, result.error);
      return;
    }

    ok(result.data, APP_EVENTS.INFO.GALLERY.EXPLORE_GALLERY_RECORDS_FETCHED);
  },
});
