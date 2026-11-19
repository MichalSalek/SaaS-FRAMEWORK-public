# Feature flag management

**English** | [Polski](README.pl.md)

The admin page displays feature flags, their categories, enabled state and expiry
metadata. Flags allow selected behavior to be enabled independently of a code
release. Their definitions live in the shared kernel.

## Definition and expiry

`.shared-kernel/domain/feature-flags/feature-flags.config.ts` defines keys, defaults,
categories and descriptions. Typed records require metadata for registered keys.
The `FeatureFlag` database model also has nullable `expires_at` metadata.

A throttled expiry sweep disables enabled flags whose date has passed, invalidates
the cache and records the change. Expiry depends on that sweep running; it is not
an immediate database-enforced deadline. Re-enabling a flag from the page clears
its expiry date. The page displays dates but does not edit them.

## Retirement

Expiry disables behavior; it does not remove the associated branch. Retirement
removes the key, remaining references and database row in a coordinated change.
Deleting the typed key exposes remaining typed references during compilation.
Permanent operational switches may intentionally have no expiry.

## Files

- `feature-flags.model.ts`: grouping, expiry status and ordering.
- `AdminFeatureFlagsPage.row.molecule.tsx`: one row and its save state.
- `AdminFeatureFlagsPage.group.organism.tsx`: category grouping.
- The parent page composition: filtering, counters and mutation coordination.

The overdue filter supports periodic review. Failed optimistic toggles restore
the previous state and display a row-level error.
