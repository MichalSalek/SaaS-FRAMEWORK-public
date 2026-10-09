# Plan: Stylist Geo Fields (SGF)

> Date created: 2026-05-14 | Priority: MEDIUM (post-launch enhancement)
> Status: PENDING (scope halved after a code check on 2026-08-02, see Prerequisites)
> Effort: ~5-8h (was ~10-15h)
> Dependency: none recorded. Source: an SEO audit finding (the `NailSalon` JSON-LD has no geo and no opening hours).

## DOCUMENTATION CASCADE (after the plan is finished)

> **MANDATORY: READ BEFORE IMPLEMENTING.** These updates are part of "done".

1. **`_MASTER_IMPLEMENTATION_INDEX.md`**: change the status to `DONE` plus the date
2. **Domain docs**: update the public profile section of the private domain docs
3. **Changelog**: add an entry with a summary
4. **Delete** this plan file (git history keeps it)

- [ ] `_MASTER_IMPLEMENTATION_INDEX.md`, row SGF: status to DONE
- [ ] `main/src/UI/features/stylist/_jsonld.helpers.ts`: remove the "geo is DEFERRED" annotation

---

## Goal

The `NailSalon` JSON-LD on public stylist profiles (`/stylist/[identifier]`) currently carries only
the city and the phone number. Without `geo` (latitude and longitude) and
`openingHoursSpecification` a search engine does not treat the profile as a complete local
business, so the profile does not qualify for map results on local-intent queries. This plan
exposes the coordinates that already exist, adds opening hours end to end, and emits both.

## Prerequisites

The executor MUST verify these before starting. They were true on 2026-08-02; do not rebuild them.

1. `latitude` and `longitude` already exist on `StylistAccount`, with a composite index, in
   `web-1/src/prisma/schema.prisma`. Note: the model is `StylistAccount`, not `Account` (that one
   belongs to the auth library).
2. Geocoding already works: `geocodeAddress()` in `web-1/src/application/maps/geocoding.utils.ts`
   (Nominatim on OpenStreetMap data, no key, no cost) is called from
   `web-1/src/domain/account/operations/account-stylist-profile.operations.ts` on profile save,
   only when the address changed, and it fails soft. The stylist types an address; coordinates
   follow. The old question "manual input or a paid geocoding API" is therefore settled.
3. `buildNailSalonJsonLd()` in `main/src/UI/features/stylist/_jsonld.helpers.ts` already emits
   `NailSalon`.
4. Coordinates already drive nearby search: `ACCOUNT_GET_STYLISTS_WITH_LOCATION` in
   `.shared-kernel/models/account/account.dto.ts` returns them, with
   `web-1/src/application/maps/distance.utils.ts`. That is the pattern to copy.
5. The blocker: the `ACCOUNT_GET_PUBLIC_PROFILE` response is a `Pick` of `StylistAccount` fields
   without `latitude` and `longitude`. Opening hours do not exist anywhere (schema, kernel, UI).

Open decisions to settle first:

- [ ] Round public coordinates (for example to about 100 m) for stylists who work from home?
- [ ] Opening hours editor: time pickers, presets, or free text?

## Scope

### Step 1: Schema (web-1)

- [ ] Add to `StylistAccount` in `web-1/src/prisma/schema.prisma`: `opening_hours Json?` and
      `geo_updated_at DateTime?` (cache invalidation). Coordinates are NOT part of this migration.
- [ ] Stored format follows schema.org, for example
      `[{ "dayOfWeek": ["Tuesday", "Wednesday"], "opens": "10:00", "closes": "20:00" }]`
- [ ] Create the migration, then `npm run system:kernel:full` to regenerate DTOs and propagate

### Step 2: Shared kernel contract

- [ ] `.shared-kernel/models/account/account.dto.ts`: add an `OpeningHoursSpecification` type with
      `dayOfWeek` as a literal union; add `latitude`, `longitude` and `opening_hours` to the
      `ACCOUNT_GET_PUBLIC_PROFILE` response; add `opening_hours` to the profile update request
- [ ] `.shared-kernel/policies/validation/account.validation.ts`: latitude -90..90, longitude
      -180..180, opening hours at most 7 entries, valid day names, valid HH:MM
- [ ] `npm run system:kernel:full`, then the kernel audits

### Step 3: Backend slice (web-1)

- [ ] Public profile: return the new fields from
      `web-1/src/domain/account/operations/account-profile.operations.ts`; the handler in
      `web-1/src/pages/api/v1/public/get-stylist-profile/index.ts` is bound to the response type,
      so it stops compiling until the operation returns them
- [ ] Profile update: accept and persist `opening_hours` in
      `web-1/src/domain/account/operations/account-stylist-profile.operations.ts`; maintain
      `geo_updated_at`

### Step 4: Frontend feature (main)

- [ ] Opening hours editor (seven days, opens and closes) in the stylist profile settings
      (`main/src/UI/features/account/components/StylistProfileSection.organism.tsx`)
- [ ] No latitude or longitude inputs: the geocoder derives them from the address
- [ ] Copy next to the address: the location is public and may be left empty

### Step 5: Structured data (main)

- [ ] In `buildNailSalonJsonLd()` emit `geo` as `GeoCoordinates` when both coordinates are present
- [ ] Emit `openingHoursSpecification` when the list is non-empty
- [ ] Extend `main/src/UI/features/stylist/_jsonld.helpers.test.ts` for both branches

### Step 6: Verification and follow-up

- [ ] Run a rich results validator on a profile with complete data
- [ ] Consider a higher sitemap priority for profiles with complete geo data
      (`main/src/pages/sitemap-profiles.xml.ts`)

## Acceptance Criteria

- [ ] `npm run typecheck`: zero errors (main/ and web-1/)
- [ ] Build succeeds for both apps; `npm run audit:all` passes; `npm run test:unit` passes in both
- [ ] A stylist can set opening hours in settings; coordinates follow from the address
- [ ] The public profile JSON-LD contains `geo` (when data exists) and `openingHoursSpecification`
- [ ] The rich results validator detects a local business type without warnings

## References

- `.shared-kernel/SHARED_KERNEL_GUIDE.md` (contract first, then propagation)
- `web-1/README.md` (handler and operation conventions)
- `main/src/UI/UI_ARCHITECTURE.md` (feature and component layering)
- schema.org: `NailSalon`, `GeoCoordinates`, `OpeningHoursSpecification`

## Execution Notes

**Delegation:** Steps 1 to 3 are sequential (schema, kernel, backend). Steps 4 and 5 can run in
parallel once the kernel contract is propagated, since they touch different files.
**Staging:** exposing coordinates carries most of the value and can ship first; opening hours can
follow as a second increment.
**Risk:** privacy for home-based stylists: decide rounding before exposing coordinates.
