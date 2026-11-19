import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getSitemapProfiles_IO } from '@domain/gallery/operations/sitemap-profiles.operations';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.PUBLIC_GET_SITEMAP_PROFILES, {
  handle: async ({ res, ok }) => {
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

    ok(result.data, APP_EVENTS.INFO.GALLERY.SITEMAP_PROFILES_FETCHED);
  },
});
