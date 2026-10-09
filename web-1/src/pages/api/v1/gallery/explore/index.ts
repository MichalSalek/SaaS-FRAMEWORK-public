import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { exploreGalleryRecords_IO } from '@domain/gallery/operations/gallery-explore.query';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { qStr, qInt, qBool, qStrArray } from '@app/http/query-params.utils';
import { isNailLengthNarrower } from '@kernel/models/type_narrowing';
import { VALIDATION_GALLERY } from '@kernel/policies/validation.config';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { requireExploreEnabled } from '@app/feature-flags/feature-flags.guard';
export default defineHandler<
  GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['REQUEST'],
  GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.GALLERY.EXPLORE_GALLERY_RECORDS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    // EXPLORE_ENABLED back-guard (after auth, before query). 404 when the discovery
    // feature is off — prevents serving the explore feed past the front route gate
    // (mirrors salon-staff kill-switch; closes the IDOR-class gap flagged in r31).
    if (!(await requireExploreEnabled(res))) {
      return;
    }

    res.setHeader('Cache-Control', 'no-store');

    // Nazwana stała zamiast gołej 50 — ten sam limit obowiązuje teraz wszystkie
    // trasy filtrujące galerię (patrz DECISION przy VALIDATION_GALLERY).
    const color_ids =
      qStrArray(req.query, 'color_ids')?.slice(
        0,
        VALIDATION_GALLERY.MAX_FILTER_COLOR_IDS
      ) ?? undefined;
    const trait_ids =
      qStrArray(req.query, 'trait_ids')?.slice(
        0,
        VALIDATION_GALLERY.MAX_FILTER_TRAIT_IDS
      ) ?? undefined;
    const nail_length_raw = qStr(req.query, 'nail_length');
    const nail_length = isNailLengthNarrower(nail_length_raw)
      ? nail_length_raw
      : undefined;
    const apply_strict_filter =
      qBool(req.query, 'apply_strict_filter') ?? false;
    const cursor = qStr(req.query, 'cursor') ?? undefined;
    // Clamp take to prevent negative/zero take reaching Prisma (would surface as
    // HTTP 503). Default (30) + cap (50) preserved: clamp keeps take in [1, 50].
    const take = Math.min(Math.max(qInt(req.query, 'take') ?? 30, 1), 50);
    const city = qStr(req.query, 'city') ?? undefined;
    const searchQuery = qStr(req.query, 'searchQuery') ?? undefined;

    const result = await exploreGalleryRecords_IO({
      ...(color_ids !== undefined && { color_ids }),
      ...(trait_ids !== undefined && { trait_ids }),
      ...(nail_length !== undefined && { nail_length }),
      apply_strict_filter,
      ...(cursor !== undefined && { cursor }),
      take,
      ...(city !== undefined && { city }),
      ...(searchQuery !== undefined && { searchQuery }),
      currentUserId: currentUser.id,
    });

    if (!result.success) {
      mapErrorToResponse(res, result.error);
      return;
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.GALLERY.EXPLORE_GALLERY_RECORDS_FETCHED
    );
  },
});
