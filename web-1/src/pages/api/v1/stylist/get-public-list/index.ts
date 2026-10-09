import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { PUBLIC_DTO_API_V1 } from '@kernel/models/public/public.dto';
import { getPublicStylistsList_IO } from '@domain/public/operations/public-stylists-list.operations';
import { qStr, qInt } from '@app/http/query-params.utils';
export default defineHandler<
  PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['REQUEST'],
  PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.PUBLIC.GET_PUBLIC_STYLISTS_LIST,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, _ctx, _metadata, res, req) => {
    // SECURITY: PUBLIC endpoint — no userId required, no auth wiring needed.
    // Permission for NOT_LOGGED_IN role provided via BASE_PERMISSIONS.
    // Operation returns ONLY public-safe fields (no email/phone/address).
    res.setHeader(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=300'
    );

    const cursor = qStr(req.query, 'cursor') ?? undefined;
    // DECISION (nie usuwaj tego komentarza):
    // Lower clamp Math.max(...,1) jest OBOWIAZKOWY (parytet z get-gallery-by-account /
    // gallery-explore). Bez niego take<=0 powodowalo 500: take<0 -> Prisma findMany({take:<0})
    // bez cursor rzuca -> DATABASE_ERROR; take===0 -> effectiveTake=0 -> pageItems=[] ->
    // nextCursor=pageItems[-1].account_id -> TypeError. Public no-auth endpoint, wiec malformed
    // ?take= bylo trywialnym wektorem 500-noise + log-spam (DATABASE_ERROR maskujacy realne awarie DB).
    // Upper clamp (50) i tak nakladany w operacji (effectiveTake); duplikujemy go tu jako defense-in-depth.
    const take = Math.min(Math.max(qInt(req.query, 'take') ?? 20, 1), 50);
    const city = qStr(req.query, 'city') ?? undefined;
    const searchQuery = qStr(req.query, 'searchQuery') ?? undefined;

    const result = await getPublicStylistsList_IO({
      ...(cursor !== undefined && { cursor }),
      take,
      ...(city !== undefined && { city }),
      ...(searchQuery !== undefined && { searchQuery }),
    });

    if (!result.success) {
      mapErrorToResponse(res, result.error);
      return;
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.PUBLIC.PUBLIC_STYLISTS_LIST_FETCHED
    );
  },
});
