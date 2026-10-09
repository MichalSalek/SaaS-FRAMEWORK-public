/**
 * Pure-policy unit test — PERMISSIONS_POLICY route-template matcher
 * (permissions.policy.ts).
 *
 * WHAT THIS PROTECTS
 * ──────────────────
 * `GET_PERMISSION_APPROVAL_FOR_ROUTE` is the FRONT-END route gate: given a role (or
 * roleId) and a requested path, it answers "may this role render this route?". It is
 * DISTINCT from the CQRS `checkPermission` (API-event RBAC). Its non-trivial part is
 * the dynamic-template fallback: a concrete path like `/stylist/abc` must resolve to
 * the `/stylist/[identifier]` template entry in PERMISSIONS_FOR_ROLE_BY_ROUTE and
 * inherit that template's allowed-role set. A regression in NORMALIZE_PATH /
 * FIND_MATCHING_ROUTE / MATCH_DYNAMIC_ROUTE silently breaks this — these rows pin it.
 *
 * The three IS_ROUTE_* predicates (delegating to ROUTING_POLICY) classify a path as
 * app-only / static-for-everyone / not-for-logged; characterized here too.
 *
 * METHOD: pure — imports `@kernel/policies/permissions.policy` + the route SSOT
 * (`@kernel/domain/routing/routing.config`) and role ids; no harness mocks.
 */

import { describe, it, expect } from 'vitest';
import { PERMISSIONS_POLICY } from '@kernel/policies/permissions.policy';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

const { GET_PERMISSION_APPROVAL_FOR_ROUTE } = PERMISSIONS_POLICY.utils;

describe('GET_PERMISSION_APPROVAL_FOR_ROUTE — direct (static) path match by role', () => {
  it('ADMIN route: granted to MASTER_ADMIN, denied to STYLIST and anonymous', () => {
    // ROUTES_FRONT.ADMIN → ADMIN_ONLY = { MASTER_ADMIN }.
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.MASTER_ADMIN,
        requestedRoutePath: ROUTES_FRONT.ADMIN,
      })
    ).toBe(true);
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.STYLIST_ROLE,
        requestedRoutePath: ROUTES_FRONT.ADMIN,
      })
    ).toBe(false);
    // No roleId AND no role → defaults to NOT_LOGGED_IN → denied.
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        requestedRoutePath: ROUTES_FRONT.ADMIN,
      })
    ).toBe(false);
  });

  it('public static route (FOR_STYLISTS, ALL_ROLES): granted to everyone incl. anonymous', () => {
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        requestedRoutePath: ROUTES_FRONT.FOR_STYLISTS,
      })
    ).toBe(true);
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.CLIENT_ROLE,
        requestedRoutePath: ROUTES_FRONT.FOR_STYLISTS,
      })
    ).toBe(true);
  });

  it('account-holder route (SALON_STAFF): STYLIST + ADMIN yes, CLIENT no', () => {
    // ROUTES_FRONT.SALON_STAFF → ACCOUNT_HOLDER_AND_ADMIN_SET = { STYLIST, MASTER_ADMIN }.
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.STYLIST_ROLE,
        requestedRoutePath: ROUTES_FRONT.SALON_STAFF,
      })
    ).toBe(true);
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.MASTER_ADMIN,
        requestedRoutePath: ROUTES_FRONT.SALON_STAFF,
      })
    ).toBe(true);
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.CLIENT_ROLE,
        requestedRoutePath: ROUTES_FRONT.SALON_STAFF,
      })
    ).toBe(false);
  });

  it('not-logged-only route (USER_LOG): anonymous yes, any logged role no', () => {
    // ROUTES_FRONT.USER_LOG → NOT_LOGGED_ONLY = { NOT_LOGGED_IN }.
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        requestedRoutePath: ROUTES_FRONT.USER_LOG,
      })
    ).toBe(true);
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.STYLIST_ROLE,
        requestedRoutePath: ROUTES_FRONT.USER_LOG,
      })
    ).toBe(false);
  });

  it('unknown role id falls back to NOT_LOGGED_IN (ROLE_ID_TO_NAME miss)', () => {
    // An admin route with a garbage roleId resolves to NOT_LOGGED_IN → denied.
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: 'role_does_not_exist',
        requestedRoutePath: ROUTES_FRONT.ADMIN,
      })
    ).toBe(false);
  });

  it('route not present in the permission map → false', () => {
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.MASTER_ADMIN,
        requestedRoutePath: '/this/route/is/not/registered',
      })
    ).toBe(false);
  });
});

describe('GET_PERMISSION_APPROVAL_FOR_ROUTE — DYNAMIC route-template fallback', () => {
  it('concrete /stylist/<id> matches the /stylist/[identifier] template (ALL_ROLES → anyone)', () => {
    // STYLIST_PROFILE template = '/stylist/[identifier]', mapped to ALL_ROLES_SET.
    // A concrete identifier must resolve via FIND_MATCHING_ROUTE → template's role set.
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        requestedRoutePath: '/stylist/jane-doe-123',
      })
    ).toBe(true);
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.CLIENT_ROLE,
        requestedRoutePath: '/stylist/another-id',
      })
    ).toBe(true);
  });

  it('concrete admin-support thread /app/admin/support/<id> inherits ADMIN_ONLY from its template', () => {
    // ADMIN_SUPPORT_THREAD template = '/app/admin/support/[threadId]' → ADMIN_ONLY.
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.MASTER_ADMIN,
        requestedRoutePath: '/app/admin/support/th_123',
      })
    ).toBe(true);
    // A stylist hitting the same dynamic admin route is denied via the template set.
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        roleId: SystemRoleId.STYLIST_ROLE,
        requestedRoutePath: '/app/admin/support/th_123',
      })
    ).toBe(false);
  });

  it('trailing slash is normalized before matching (NORMALIZE_PATH)', () => {
    expect(
      GET_PERMISSION_APPROVAL_FOR_ROUTE({
        requestedRoutePath: '/for-clients/',
      })
    ).toBe(true);
  });

  // REGRESSION GUARD: if MATCH_DYNAMIC_ROUTE's `[param]`→`([^/]+)` rewrite breaks, the
  // concrete-id rows above flip to false (dynamic profile pages would 403 for all),
  // while the static rows stay green — isolating the failure to the template matcher.
});
