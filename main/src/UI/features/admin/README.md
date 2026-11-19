# Admin interface

**English** | [Polski](README.pl.md)

This directory contains administration screens for users, moderation, support,
email, logs, health, configuration and permissions. Route entry points live in
`src/pages/app/admin/`; `AdminPageLayout` supplies the shared frame and navigation.

## Structure

Screens use `Admin<Name>Page.composition.tsx`. Reusable parts live in `components/`,
data hooks in `hooks/`, and pure filtering, export and state logic in model files
with adjacent tests. API declarations are in `src/domain/admin/`.

## Permissions and editing

System-role permissions come from kernel configuration and are read-only in the
panel. Custom-role changes are saved through the API, which enforces the same rule.
Filtering the matrix changes visible rows without discarding the full draft.

Editors track pending saves per record. URL-synchronized filters preserve a view
across reloads. Export and pagination use the data for the current filter state.
Frontend controls complement backend permissions and ownership checks.

## CSV exports

`admin-csv.ts` handles quoting and formula-like cells. `users-csv.ts` fetches pages
under the active filters and sort, with an explicit row cap. Column definitions
supply export values; dates use UTC ISO 8601. The interface reports truncated exports.

## Reading guide

- [User screen](AdminUsersPage.composition.tsx)
- [Permissions matrix](components/AdminPermissionsMatrix.organism.tsx)
- [CSV helper](admin-csv.ts)
- [Feature flags](AdminFeatureFlagsPage/README.md)
