import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { calculateDistance } from '@app/maps/distance.utils';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { countPublicGalleryRecordsByAccount } from '@domain/gallery/public-gallery-count';
import { VALIDATION_GEO } from '@kernel/policies/validation.config';

// DECISION: coordinates are stored at ~7 decimals (a solo stylist's home), so the response
// carries them rounded to 3 decimals (~110 m); do not remove the rounding. The radius filter must
// read the SAME rounded values: membership in the result is itself an output, and filtering on
// full precision let a caller shrink the radius around probe centers and trilaterate the address.
const COORD_PRECISION_DP = 3;
const roundCoord = (value: number): number => {
  const factor = 10 ** COORD_PRECISION_DP;
  return Math.round(value * factor) / factor;
};

// Coupled invariant: the fetch ceiling AND the truncation sentinel below MUST use the same
// number — `take: GEO_FETCH_CAP` bounds the query, and `accounts.length === GEO_FETCH_CAP`
// detects a saturated result so the warn-log can fire before the JS radius filter silently
// drops geolocated stylists. Bumping one without the other breaks the truncation alarm (the
// documented trigger for the post-launch SQL earthdistance migration).
const GEO_FETCH_CAP = 500;

/**
 * Get stylists with location data, filtered by distance.
 *
 * Requires a search center (latitude + longitude). An empty/centerless query
 * returns [] — see the minimum-filter gate below.
 */
export const getStylistsWithLocation_IO = async ({
  latitude,
  longitude,
  radiusKm,
}: {
  latitude?: number | undefined;
  longitude?: number | undefined;
  radiusKm?: number | undefined;
}): Promise<
  OperationResult<
    ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['RESPONSE'],
    never
  >
> => {
  reportIssueBackend({
    namespace: 'getStylistsWithLocation',
    message: 'Fetching stylists with location',
    payload: { has_user_location: Boolean(latitude && longitude) },
    mode: 'info',
  });

  // DECISION: no search center = []. This is a "near you" search, not a catalog; without the gate
  // an empty body dumped every geolocated stylist. The map UI always sends a location.
  if (latitude === undefined || longitude === undefined) {
    reportIssueBackend({
      namespace: 'getStylistsWithLocation',
      message: 'Rejected centerless query (no search center provided)',
      payload: {},
      mode: 'info',
    });
    return success([]);
  }

  // DECISION: an absent or non-positive radius defaults to VALIDATION_GEO.RADIUS_KM_MAX, so every
  // query is distance-bounded. Otherwise a throwaway center (0,0) plus no radius skipped the
  // filter and returned the whole directory.
  const effectiveRadiusKm =
    radiusKm !== undefined && radiusKm > 0
      ? radiusKm
      : VALIDATION_GEO.RADIUS_KM_MAX;

  // DECISION: error union `never` on purpose: a DB failure surfaces as the middleware 500, since
  // there is no meaningful partial answer. Not wrapped in databaseFailure.
  const accounts = await DB_CLIENT.use.stylistAccount.findMany({
    where: {
      // Visibility-cascade parity: account_status:ACTIVE alone would leak a stylist whose
      // owning user is soft-deleted (is_active=false) before the account_status flip lands
      // (the cascade is not atomic across both columns). Spread the shared public-visibility
      // invariant so this map endpoint stays in lockstep with every other public reader and
      // a removed stylist's PII (display_name, business_name, address_city, coords) can never
      // surface here. SSOT: STYLIST_PUBLICLY_VISIBLE — do NOT drop either predicate.
      ...STYLIST_PUBLICLY_VISIBLE,
      latitude: { not: null },
      longitude: { not: null },
      address_city: { not: null },
    },
    select: {
      account_id: true,
      business_name: true,
      address_city: true,
      display_name: true,
      latitude: true,
      longitude: true,
      created_by_user: { select: { name: true } },
    },
    // DECISION: take GEO_FETCH_CAP + a JS radius filter is a known stopgap for the current directory
    // size; ordering by cached_gallery_count keeps the most active stylists if the cap is hit, and
    // the truncation sentinel below is the trigger for moving distance into SQL.
    orderBy: { cached_gallery_count: 'desc' },
    take: GEO_FETCH_CAP,
  });

  reportIssueBackend({
    namespace: 'getStylistsWithLocation',
    message: 'Found accounts with location',
    payload: { count: accounts.length },
    mode: 'info',
  });

  // Truncation sentinel: when exactly GEO_FETCH_CAP rows came back, the directory may
  // have exceeded the cap and some geolocated stylists dropped out BEFORE the JS radius
  // filter (silent truncation, incomplete results). The alarm signals it is time for the
  // SQL earthdistance migration (post-launch backlog, see the DECISION above).
  if (accounts.length === GEO_FETCH_CAP) {
    reportIssueBackend({
      namespace: 'getStylistsWithLocation',
      message:
        'take:500 limit hit — geolocated stylist results may be truncated (consider SQL earthdistance migration)',
      payload: { fetched_count: accounts.length },
      mode: 'warn',
    });
  }

  // latitude/longitude filtered to non-null by Prisma WHERE above, but TS column types
  // remain nullable — runtime guard narrows defensively (avoids `as number` cast).
  let stylists = accounts.flatMap(account => {
    if (account.latitude == null || account.longitude == null) {
      return [];
    }
    // Privacy: emit rounded (~110 m) coordinates, never exact ones, AND measure the
    // distance from those same rounded values — see COORD_PRECISION_DP DECISION at
    // the top of this file (the radius filter must not be an exact-location oracle).
    const accountLat = roundCoord(account.latitude);
    const accountLon = roundCoord(account.longitude);
    return [
      {
        account_id: account.account_id,
        business_name: account.business_name,
        address_city: account.address_city,
        latitude: accountLat,
        longitude: accountLon,
        display_name: account.display_name || account.created_by_user.name,
        distance_km: calculateDistance(
          latitude,
          longitude,
          accountLat,
          accountLon
        ),
      },
    ];
  });

  // Radius filter is now unconditional: the center gate guarantees a defined
  // center reached this point, and effectiveRadiusKm always carries a bounded
  // value (caller-supplied or RADIUS_KM_MAX default). No query escapes distance
  // bounding — see the anti-harvest DECISION above.
  // distance_km is always a number (calculateDistance returns number, never undefined) —
  // the filter is unconditional on distance, only bounding by radius.
  stylists = stylists.filter(
    stylist => stylist.distance_km <= effectiveRadiusKm
  );

  reportIssueBackend({
    namespace: 'getStylistsWithLocation',
    message: 'Filtered by radius',
    payload: {
      radius_km: effectiveRadiusKm,
      radius_defaulted: radiusKm === undefined || radiusKm <= 0,
      filtered_count: stylists.length,
    },
    mode: 'info',
  });

  stylists.sort((a, b) => a.distance_km - b.distance_km);

  // gallery_count = public portfolio size (non-hidden works, counted from the DB, not from
  // cache); see the DECISION in public-gallery-count.ts. One groupBy over the FILTERED
  // accounts, no N+1.
  const publicGalleryCounts =
    await countPublicGalleryRecordsByAccount(stylists);

  const responsePayload: ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['RESPONSE'] =
    stylists.map(({ distance_km, ...stylist }) => ({
      ...stylist,
      gallery_count: publicGalleryCounts.get(stylist.account_id) ?? 0,
    }));

  reportIssueBackend({
    namespace: 'getStylistsWithLocation',
    message: 'Stylists fetched successfully',
    payload: {
      total_count: responsePayload.length,
      has_location_filter: Boolean(latitude && longitude),
      radius_km: effectiveRadiusKm,
      radius_defaulted: radiusKm === undefined || radiusKm <= 0,
    },
    mode: 'info',
  });

  return success(responsePayload);
};
