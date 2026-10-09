import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getSitemapProfiles_IO } from '@domain/gallery/operations/sitemap-profiles.operations';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
export default defineHandler<
  undefined,
  GALLERY_DTO_API_V1['PUBLIC_GET_SITEMAP_PROFILES']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.GALLERY.PUBLIC_GET_SITEMAP_PROFILES,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, _currentUser, _metadata, res) => {
    const result = await getSitemapProfiles_IO();

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    reportIssueBackend({
      namespace: 'PUBLIC_GET_SITEMAP_PROFILES',
      message: 'Sitemap profiles fetched successfully',
      payload: {
        profiles_count: result.data.profiles.length,
      },
      mode: 'info',
    });

    // Cache for 5 minutes, serve stale for 10 minutes while revalidating
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=600'
    );

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.GALLERY.SITEMAP_PROFILES_FETCHED
    );
  },
});
