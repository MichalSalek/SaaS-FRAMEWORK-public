import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getStylistsWithLocation_IO } from '@domain/account/operations/account-query.operations';

// DECISION: POST with a body (latitude, longitude, radius_km) is intentional despite this being a CQRS
// query: coordinates are sensitive location data that would land in server access logs, browser history
// and CDN logs if sent in a GET URL, they URL-encode awkwardly, and the payload may grow (bbox, filters).
// CQRS "query" means read-only semantics, not the HTTP method. Stays POST.
export default defineEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_GET_STYLISTS_WITH_LOCATION,
  {
    handle: async ({ input: body, res }) => {
      const result = await getStylistsWithLocation_IO({
        latitude: body.latitude,
        longitude: body.longitude,
        radiusKm: body.radius_km,
      });
      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }

      respondSuccess(
        res,
        result.data,
        APP_EVENTS.INFO.ACCOUNT.STYLISTS_WITH_LOCATION_FETCHED
      );
    },
  }
);
