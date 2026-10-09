import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { getStylistsWithLocation_IO } from '@domain/account/operations/account-query.operations';

// DECISION (nie usuwaj tego komentarza):
// POST method with body (latitude, longitude, radius_km) is intentional, despite this being a CQRS query.
// Reasons: (1) Geo coordinates are floating-point numbers that URL-encode awkwardly and may contain
// precision characters (e.g. 52.2296756, 21.0122287) that require encoding, making GET query strings
// fragile and verbose. (2) Coordinates can be considered sensitive personal data (user location) —
// sending them in a GET URL means they appear in server access logs, browser history, and CDN logs
// without opt-in. A POST body is excluded from these logs by default. (3) The request payload may
// grow (bbox, filters) — POST body scales better. CQRS "query" refers to semantics (read-only), not
// HTTP method. ACCOUNT_GET_STYLISTS_WITH_LOCATION stays POST intentionally.
export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ACCOUNT.ACCOUNT_GET_STYLISTS_WITH_LOCATION,
  method: 'post',
  validate: VALIDATION_POLICY.validators.accountGetStylistsWithLocation,
  handle: async (body, _ctx, _metadata, res) => {
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
});
