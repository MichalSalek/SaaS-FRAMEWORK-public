# Stylist location and opening hours

> Archival example: recorded proposals and statuses are not a current roadmap or instructions for this export.

**Recorded status:** partial implementation. Public-profile coordinates and
structured-data output were added on 2026-10-17. Opening hours remain planned.

## Purpose

Expose the relevant stylist-profile fields through the shared API contract and
include available location and opening-hours data in the profile's `NailSalon`
structured data. Structured data describes the page; it does not guarantee a
particular search result or map placement.

## Existing behavior

`StylistAccount` already stores coordinates. Profile updates can geocode changed
addresses through the map adapter. Nearby search and the public profile use
rounded values according to their separate policies.

The public profile returns coordinates rounded to two decimal places. Its JSON-LD
includes `GeoCoordinates` when both values are present, plus available profile
images. The API retains the underlying coordinates. The precision choice is
intentional and should remain consistent when extending the response.

## Remaining implementation

1. Define the opening-hours format and editing behavior, including absent or closed
   days and validation of time ranges.
2. Add schema fields and a migration without reintroducing existing coordinates.
3. Extend the shared profile request and response DTOs and their validators.
4. Propagate the kernel, then implement profile writes and reads.
5. Add the settings editor and `openingHoursSpecification` output.
6. Test missing, valid and invalid hours and inspect the rendered structured data.

## Acceptance criteria

- [x] Available public coordinates are emitted in the profile JSON-LD.
- [ ] A stylist can save validated opening hours in settings.
- [ ] The API returns those hours through the shared contract.
- [ ] Non-empty hours are emitted as `openingHoursSpecification`.
- [ ] Relevant unit tests, typechecks, audits and builds pass.
- [ ] A live profile's structured data is checked after release.

## Reading guide

Paths are relative to the repository root:

- `web-1/src/prisma/schema.prisma`
- `.shared-kernel/models/account/account.dto.ts`
- `web-1/src/domain/account/operations/account-profile.operations.ts`
- `web-1/src/domain/account/operations/account-stylist-profile.operations.ts`
- `main/src/UI/features/stylist/_jsonld.helpers.ts`
- `main/src/UI/features/stylist/_jsonld.helpers.test.ts`
