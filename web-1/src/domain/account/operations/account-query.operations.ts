import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { calculateDistance } from '@app/maps/distance.utils';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { countPublicGalleryRecordsByAccount } from '@domain/gallery/public-gallery-count';
import { VALIDATION_GEO } from '@kernel/policies/validation.config';

// DECISION (nie usuwaj tego komentarza):
// Coordinate precision cap. Raw lat/lng are stored at ~7 decimals (sub-meter),
// which exposes the exact home/business address of solo stylists (doxxing/stalking
// risk). The consumer-facing map only needs an approximate pin: 3 decimals ≈ 110 m
// at the equator, well below the resolution a map marker conveys. We round on the
// way OUT so the response contract never carries exact coordinates, while the DB
// keeps full precision. If the map ever needs finer placement, raise
// COORD_PRECISION_DP here (and re-review the privacy trade-off) — do NOT remove
// the rounding.
// The radius filter reads the SAME rounded coordinates the response emits, never the
// stored ones. Membership in the result set is itself an output: radius_km only has to
// be > 0, so filtering on full precision let a caller shrink the radius around probe
// centers and trilaterate the exact address from which queries still returned the
// stylist, defeating the rounding. On rounded input the answer is a function of the
// public ~110 m pin alone; a normal search radius (kilometres) is unaffected.
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

  // DECISION (nie usuwaj tego komentarza):
  // Minimum-filter gate. This endpoint is a "find a stylist near you" map search,
  // NOT a catalog dump. Without a search center an empty body returned the entire
  // set of active geolocated stylists (full enumeration). Require a center
  // (latitude + longitude); a centerless query short-circuits to [] so the
  // endpoint can never be used to harvest the whole directory. The map UI always
  // supplies the user's location before querying, so legit flows are unaffected.
  if (latitude === undefined || longitude === undefined) {
    reportIssueBackend({
      namespace: 'getStylistsWithLocation',
      message: 'Rejected centerless query (no search center provided)',
      payload: {},
      mode: 'info',
    });
    return success([]);
  }

  // DECISION (nie usuwaj tego komentarza):
  // Bounded-radius default closes the anti-harvest bypass. The center gate above
  // only rejects a *missing* center — a throwaway center (e.g. 0,0) + omitted
  // radius_km previously skipped the radius filter entirely (the old
  // `&& radiusKm` truthiness check), returning the ENTIRE geolocated directory
  // (up to take:500) and defeating the documented "can never harvest the whole
  // directory" guarantee. An absent (or non-positive) radius now defaults to the
  // canonical max (VALIDATION_GEO.RADIUS_KM_MAX = 1000 km ≈ national search), so
  // every query is distance-bounded. Legit "find a stylist near me" flows always
  // supply a radius, and an explicit national search (radius_km: 1000) is still
  // honoured unchanged — but it is then a genuine distance match around a REAL
  // center, not an unfiltered dump from a bogus one. The validator already caps
  // radius_km at RADIUS_KM_MAX, so this default never exceeds the allowed ceiling.
  const effectiveRadiusKm =
    radiusKm !== undefined && radiusKm > 0
      ? radiusKm
      : VALIDATION_GEO.RADIUS_KM_MAX;

  // DECISION (nie usuwaj tego komentarza): union `never` celowo — publiczny katalog
  // stylistów; awaria DB (Neon) celowo wypływa jako middleware 500, bo brak sensownej
  // częściowej odpowiedzi. Nie owijamy w databaseFailure.
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
    // DECISION (nie usuwaj tego komentarza): take:500 + JS radius filter —
    // bezpieczne <500 geolocated active stylists. Pełna SQL earthdistance migracja
    // = post-launch backlog. Sentinel log alarmuje gdy limit osiągnięty.
    // H9 (run 28) — take: 500 jest workaround dla radius filtering wykonywanego
    // w JS PO fetch. ORDER BY cached_gallery_count DESC gwarantuje, że gdy katalog
    // przekroczy 500 stylistów (np. po launch + skalowaniu), w wynikach znajdą się
    // najaktywniejsi (najwięcej galerii = najwyższa wartość dla user search).
    // Long-term: SQL-side dystans via earth_distance/ST_DWithin (PostGIS/cube
    // ext) — usuwa potrzebę JS post-filter i pozwala na unlimited result set
    // z natywnym radius WHERE. Post-launch backlog.
    orderBy: { cached_gallery_count: 'desc' },
    take: GEO_FETCH_CAP,
  });

  reportIssueBackend({
    namespace: 'getStylistsWithLocation',
    message: 'Found accounts with location',
    payload: { count: accounts.length },
    mode: 'info',
  });

  // Truncation sentinel — gdy zwrócono dokładnie take:500, katalog mógł
  // przekroczyć limit i część geolocated stylists wypadła PRZED JS radius
  // filtrem (silent truncation, wyniki niepełne). Alarm = sygnał, że czas
  // na SQL earthdistance migrację (post-launch backlog, patrz DECISION wyżej).
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

  // gallery_count = publiczny rozmiar portfolio (nieukryte prace, liczone z bazy, nie z
  // cache) — DECISION w public-gallery-count.ts. Jeden groupBy po PRZEFILTROWANYCH
  // kontach, bez N+1.
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
