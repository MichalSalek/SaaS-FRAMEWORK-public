import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getPublicStylistsList_IO } from '@domain/public/operations/public-stylists-list.operations';
import { PUBLIC_CONTRACTS } from '@kernel/domain/public/public.contracts';

export default defineEndpoint(PUBLIC_CONTRACTS.GET_PUBLIC_STYLISTS_LIST, {
  handle: async ({ input, res, ok }) => {
    res.setHeader(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=300'
    );
    // DECISION: the lower clamp Math.max(..., 1) is MANDATORY (parity with get-gallery-by-account /
    // gallery-explore). Without it take<=0 caused a 500: take<0 makes Prisma findMany({take:<0}) without a
    // cursor throw => DATABASE_ERROR; take===0 gives effectiveTake=0 => pageItems=[] => nextCursor =
    // pageItems[-1].account_id => TypeError. On a public no-auth endpoint a malformed ?take= was a trivial
    // 500-noise and log-spam vector (DATABASE_ERROR masking real DB outages). The upper clamp (50) is also
    // applied in the operation (effectiveTake); duplicated here as defense in depth.
    const take = Math.min(Math.max(input.take, 1), 50);
    const result = await getPublicStylistsList_IO({
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      take,
      ...(input.city !== undefined && { city: input.city }),
      ...(input.searchQuery !== undefined && {
        searchQuery: input.searchQuery,
      }),
    });
    if (!result.success) {
      mapErrorToResponse(res, result.error);
      return;
    }
    ok(result.data, APP_EVENTS.INFO.PUBLIC.PUBLIC_STYLISTS_LIST_FETCHED);
  },
});
