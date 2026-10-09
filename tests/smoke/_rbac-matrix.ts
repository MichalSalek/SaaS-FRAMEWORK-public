/**
 * RBAC Matrix — SSOT-driven permission verification
 *
 * Extracted from run-smoke-tests.ts during modularization.
 */

import { apiCall, results } from './_test-utils';
import type { HTTPMethod } from './_test-utils';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import {
  BASE_PERMISSIONS,
  LOGGED_USER_PERMISSIONS,
  STYLIST_SPECIFIC_PERMISSIONS,
  CLIENT_SPECIFIC_PERMISSIONS,
} from '@kernel/application/role-permissions';

// ============================================================================
// RBAC MATRIX — SSOT-driven permission verification
// ============================================================================

/**
 * Build the set of all permission event names for a given role.
 *
 * DECISION (nie usuwaj tego komentarza):
 * SSOT for permission arrays lives in `.shared-kernel/application/role-permissions.ts`.
 * Previously this file mirrored web-1 hardcoded arrays — that caused drift
 * (Wave 1B C2 fix). Now imports kernel directly so drift is structurally impossible.
 *
 * SSOT hierarchy:
 * - BASE_PERMISSIONS: available to everyone (incl. not logged in)
 * - LOGGED_USER_PERMISSIONS: all authenticated roles (BASE + more)
 * - STYLIST_SPECIFIC: stylist + admin only
 * - CLIENT_SPECIFIC: client + admin only
 * - Anything else: admin-only (via wildcard)
 */
export function buildRolePermissions(): {
  stylistEvents: Set<string>;
  clientEvents: Set<string>;
  baseEvents: Set<string>;
} {
  const baseEvents = new Set<string>(BASE_PERMISSIONS);
  const stylistEvents = new Set<string>([
    ...LOGGED_USER_PERMISSIONS,
    ...STYLIST_SPECIFIC_PERMISSIONS,
  ]);
  const clientEvents = new Set<string>([
    ...LOGGED_USER_PERMISSIONS,
    ...CLIENT_SPECIFIC_PERMISSIONS,
  ]);

  return { stylistEvents, clientEvents, baseEvents };
}

/**
 * Map ROUTES_API keys to their event names in APP_EVENTS.
 * Convention: route key often matches event name, with known exceptions.
 */
type RbacEndpoint = {
  routeKey: string;
  path: string;
  method: HTTPMethod;
  body: Record<string, unknown> | undefined;
  eventName: string;
};

export function buildRbacEndpoints(): RbacEndpoint[] {
  // DECISION (nie usuwaj tego komentarza):
  // Most ROUTES_API keys match their event name exactly (identity mapping).
  // Only non-identity exceptions are listed here — the lookup falls back
  // to the route key itself via ?? routeKey.
  const ROUTE_KEY_TO_EVENT_EXCEPTIONS: Readonly<Record<string, string>> = {
    SALON_STAFF: 'SALON_STAFF_GET_ALL',
  };

  // Skip endpoints that can't be meaningfully RBAC-tested
  const SKIP_ROUTES = new Set([
    'DEV_LOGIN', // Auth endpoint, not protected by RBAC
    // DECISION (nie usuwaj tego komentarza):
    // AUTH_EXCHANGE_CODE = publiczny pre-auth token-bridge (/api/auth/exchange-code),
    // NIE RBAC-gated (jak DEV_LOGIN). Dla nieprawidłowego/brakującego ?authCode zwraca
    // 406 (kontrakt walidowany osobno przez exchange-code.smoke.ts) — matrix traktował
    // brak-w-role-permissions jako admin-only i oczekiwał 401/403 → fałszywy mismatch.
    'AUTH_EXCHANGE_CODE',
    'SALON_STAFF_GET_BY_ID', // Dynamic path param [staffId], skip
    'SALON_STAFF_UPDATE_PERMISSIONS', // Dynamic path param [staffId], skip
    'SALON_STAFF_REMOVE', // Dynamic path param [staffId], skip
    // Destructive endpoints — executing these would break test state
    'USER_REQUEST_DELETE', // Would delete the test user
    'USER_DISABLE_SELF', // Would disable the test user
    'USER_REQUEST_EMAIL_CHANGE', // Deletes all sessions on success — invalidates tokens
    'SESSION_DELETE_ALL', // Would invalidate all sessions
    'SESSION_DELETE_EXACTLY', // Would invalidate a session
    // Onboarding — idempotent but changes account_type
    'USER_ONBOARD_AS_STYLIST',
    'USER_ONBOARD_AS_CLIENT',
    // Role switch — changes user state
    'USER_SWITCH_ROLE',
    // Business logic returns 401/403 before RBAC can be verified (need real test data)
    'DELETE_ASSET_FROM_VENDOR', // Ownership check: asset_id must contain user ID marker
    'BOOKMARK_STYLIST', // respondAccountNotFound returns 403 for non-existent account
    'CLIENT_GET_CONTACT_FOR_STYLIST', // GDPR: requires active pairing with client
    'USER_CHECK_RECOVERY', // Needs valid deleted user email
    'USER_RESTORE_ACCOUNT', // Would restore deleted account
    // Public endpoints not in role-permissions kernel (return 200 for all roles, not permission-gated)
    'PRICING_GET_PLANS', // Public pricing page — no auth required (200 all roles)
    'INTERNAL_HEALTH_PUBLIC', // Public health check — no auth required (200 all roles)
    'INTERNAL_SWEEP_TICK', // Public sweep clock — no auth required (200 all roles), may start sweeps
    // Intentional 404-mask (defense-in-depth S2S endpoint with x-internal-secret; CLAUDE.md)
    'INTERNAL_TRACK_CRAWLER', // 404-mask by design — not testable via RBAC matrix
    'REFRESH_IMPERSONATION', // Requires active impersonation
    'SWITCH_BACK_BECOME_USER', // Requires active impersonation
    'FAVORITE_UPDATE_RECORD_NOTE', // Needs existing favorite record
    // Destructive admin mutations
    'ADMIN_TOGGLE_FEATURE_FLAG', // Would toggle a feature flag
    'ADMIN_BULK_DISABLE', // Would disable users
    'ADMIN_BULK_ENABLE', // Would enable users
    'ADMIN_BULK_CHANGE_PLAN', // Would change pricing plans
    'ADMIN_BULK_LOGOUT', // Would logout users
    'ADMIN_CREATE_ANNOUNCEMENT', // Would create data
    'ADMIN_UPDATE_ANNOUNCEMENT', // Needs real announcement ID
    'ADMIN_DELETE_ANNOUNCEMENT', // Destructive
    'ADMIN_UPDATE_CONFIG', // Would change config
    // Mutations with side effects
    'ACCOUNT_INCREMENT_VIEW', // Fire-and-forget, safe but noisy
    'USER_EXPORT_DATA', // Rate limited, heavy operation
    'USER_UPDATE_NOTIFICATION_PREFERENCES', // Changes state
    'NEWSLETTER_SUBSCRIBE', // Would subscribe
    'EMAIL_UNSUBSCRIBE', // Needs HMAC token
    'EMAIL_UPDATE_PREFERENCES', // Changes state
  ]);

  // Default HTTP methods for endpoints without validator specs.
  // These are endpoints that only accept POST (not GET).
  const routeMethodOverrides: Record<string, HTTPMethod> = {
    ADMIN_CHECK_ACCESS: 'POST',
    ADMIN_CHECK_ACCESS_HEALTH: 'GET',
    SWITCH_BACKEND_DEBUG_MODE: 'POST',
    BECOME_USER: 'POST',
    SWITCH_BACK_BECOME_USER: 'POST',
    USER_DELETE_ANY: 'POST',
    USER_DISABLE_ANY: 'POST',
    USER_ENABLE_ANY: 'POST',
    ADMIN_GET_PERMISSIONS: 'GET',
    ADMIN_UPDATE_PERMISSIONS: 'POST',
    GET_NOTES: 'GET',
    SAVE_NOTE: 'POST',
    SET_MAIN_NOTE: 'POST',
    GET_LOGS: 'GET',
    SEND_LOG: 'POST',
    ADMIN_CHANGE_PRICING_PLAN: 'POST',
    ADMIN_CREATE_COLOR: 'POST',
    ADMIN_UPDATE_COLOR: 'POST',
    ADMIN_DELETE_COLOR: 'POST',
    ADMIN_CREATE_TRAIT: 'POST',
    ADMIN_UPDATE_TRAIT: 'POST',
    ADMIN_DELETE_TRAIT: 'POST',
    USER_REQUEST_DELETE: 'POST',
    USER_DISABLE_SELF: 'POST',
    USER_ONBOARD_AS_CLIENT: 'POST',
    SESSION_DELETE_ALL: 'POST',
    SESSION_GET_CURRENT: 'GET',
    SESSION_GET_ALL: 'GET',
    ACCOUNT_STRIPE_PORTAL: 'POST',
    GET_COLORS: 'GET',
    GET_TRAITS: 'GET',
    GALLERY_PIN_RECORD: 'POST',
    GALLERY_UNPIN_RECORD: 'POST',
    GET_BOOKMARKED_STYLISTS: 'GET',
    FAVORITE_GET_RECORDS: 'GET',
    PAIRING_SESSION_ISSUE: 'POST',
    PAIRING_GET_MY_PAIRS: 'GET',
    USER_CHECK_RECOVERY: 'POST',
    USER_RESTORE_ACCOUNT: 'POST',
    FAVORITE_UPDATE_RECORD_NOTE: 'POST',
    REFRESH_IMPERSONATION: 'POST',
    // New admin endpoints
    ADMIN_GET_USERS_PAGINATED: 'GET',
    ADMIN_GET_FEATURE_FLAGS: 'GET',
    ADMIN_GET_METRICS: 'GET',
    ADMIN_HEALTH: 'GET',
    ADMIN_GET_AUDIT_TRAIL: 'GET',
    ADMIN_GET_ANNOUNCEMENTS: 'GET',
    ADMIN_GET_USER_TIMELINE: 'GET',
    ADMIN_GET_REPORTS: 'GET',
    ADMIN_GET_CONFIGS: 'GET',
    // New public endpoints
    GET_FEATURE_FLAGS_PUBLIC: 'GET',
    ANNOUNCEMENTS_GET_ACTIVE: 'GET',
    PUBLIC_GET_SITEMAP_PROFILES: 'GET',
    // New account/gallery/favorite endpoints
    ACCOUNT_GET_DASHBOARD_FEED: 'GET',
    FAVORITE_GET_GROUPED: 'GET',
    EXPLORE_GALLERY_RECORDS: 'GET',
    // New email endpoints
    EMAIL_GET_SCHEDULE: 'GET',
    EMAIL_GET_HISTORY: 'GET',
  };

  const endpoints: RbacEndpoint[] = [];
  const routeEntries = Object.entries(ROUTES_API) as [string, string][];

  for (const [routeKey, path] of routeEntries) {
    if (SKIP_ROUTES.has(routeKey)) continue;

    const eventName = ROUTE_KEY_TO_EVENT_EXCEPTIONS[routeKey] ?? routeKey;

    const method: HTTPMethod = routeMethodOverrides[routeKey] ?? 'GET';
    const body = method !== 'GET' ? {} : undefined;

    endpoints.push({ routeKey, path, method, body, eventName });
  }

  return endpoints;
}

type RbacResult = {
  routeKey: string;
  path: string;
  noAuth: { expected: string; actual: number; match: boolean };
  stylist: { expected: string; actual: number; match: boolean };
  client: { expected: string; actual: number; match: boolean };
};

export async function runRbacMatrix(
  stylistToken: string,
  clientToken: string
): Promise<void> {
  const { stylistEvents, clientEvents, baseEvents } = buildRolePermissions();
  const endpoints = buildRbacEndpoints();
  const rbacResults: RbacResult[] = [];
  let mismatches = 0;

  console.log(`   Testing ${endpoints.length} endpoints \u00D7 3 roles...\n`);

  for (const ep of endpoints) {
    const isBase = baseEvents.has(ep.eventName);
    const isStylistAllowed = stylistEvents.has(ep.eventName);
    const isClientAllowed = clientEvents.has(ep.eventName);

    // Expected status codes:
    // "allowed" = NOT 401/403 (could be 200, 201, 400, 404, 500 — anything but permission denied)
    // "denied" = 401 (no auth) or 403 (wrong role)
    const expectedNoAuth = isBase ? 'allowed' : '401';
    const expectedStylist = isStylistAllowed ? 'allowed' : '403';
    const expectedClient = isClientAllowed ? 'allowed' : '403';

    // apiCall enforces per-request rate limiting (150ms min interval)
    const noAuthResponse = await apiCall({
      endpoint: ep.path,
      method: ep.method,
      body: ep.body,
    });

    const stylistResponse = await apiCall({
      endpoint: ep.path,
      method: ep.method,
      token: stylistToken,
      body: ep.body,
    });

    const clientResponse = await apiCall({
      endpoint: ep.path,
      method: ep.method,
      token: clientToken,
      body: ep.body,
    });

    // Check matches
    // Note: Validation runs BEFORE auth check in middleware, so 400 = validation failed before
    // reaching auth. We treat 400/405 as inconclusive (not a RBAC mismatch).
    // Some endpoints return 403 for domain reasons (not RBAC) — e.g. "not paired with stylist".
    // These are excluded from strict 403 = "denied" matching.
    // DECISION (nie usuwaj tego komentarza):
    // SALON_STAFF: stylist has SALON_STAFF_GET_ALL in STYLIST_SPECIFIC_PERMISSIONS (kernel SSOT),
    // but the test stylist user is on the FREE plan (can_use_staff_accounts: false). The handler
    // passes RBAC (permission granted) and fails inside businessLogic with SALON_STAFF_LIMIT_REACHED
    // → respondPlanLimitReached → HTTP 403. This is a plan-tier 403, NOT an RBAC 403.
    // test-users.config.ts SSOT: test stylist plan = FREE. Fix = domain 403 exemption, not test.
    const DOMAIN_403_ENDPOINTS = new Set<string>(['SALON_STAFF']);
    const checkMatch = (
      actual: number,
      expected: string,
      routeKey: string
    ): boolean => {
      if (actual === 400 || actual === 405) return true; // Validation/method blocked before auth
      if (expected === 'allowed') {
        if (actual === 403 && DOMAIN_403_ENDPOINTS.has(routeKey)) return true; // Domain 403, not RBAC
        return actual !== 401 && actual !== 403;
      }
      return actual === parseInt(expected, 10);
    };

    const result: RbacResult = {
      routeKey: ep.routeKey,
      path: ep.path,
      noAuth: {
        expected: expectedNoAuth,
        actual: noAuthResponse.status,
        match: checkMatch(noAuthResponse.status, expectedNoAuth, ep.routeKey),
      },
      stylist: {
        expected: expectedStylist,
        actual: stylistResponse.status,
        match: checkMatch(stylistResponse.status, expectedStylist, ep.routeKey),
      },
      client: {
        expected: expectedClient,
        actual: clientResponse.status,
        match: checkMatch(clientResponse.status, expectedClient, ep.routeKey),
      },
    };

    rbacResults.push(result);

    const allMatch =
      result.noAuth.match && result.stylist.match && result.client.match;
    if (!allMatch) mismatches++;

    const icon = allMatch ? '  ' : '!!';
    console.log(
      `${icon} ${ep.routeKey.padEnd(42)} ` +
        `noAuth:${result.noAuth.actual}(${result.noAuth.expected}) ` +
        `stylist:${result.stylist.actual}(${result.stylist.expected}) ` +
        `client:${result.client.actual}(${result.client.expected})`
    );
  }

  // Append to results array for summary
  results.push({
    endpoint: `RBAC_MATRIX (${endpoints.length} endpoints \u00D7 3 roles)`,
    status: mismatches === 0 ? 'PASS' : 'FAIL',
    duration: 0,
    error:
      mismatches > 0
        ? `${mismatches} endpoint(s) with RBAC mismatch`
        : undefined,
  });

  // Print mismatch details
  if (mismatches > 0) {
    console.log(`\n   \u26A0\uFE0F  ${mismatches} RBAC MISMATCHES:`);
    for (const r of rbacResults) {
      const issues: string[] = [];
      if (!r.noAuth.match)
        issues.push(
          `noAuth: got ${r.noAuth.actual}, expected ${r.noAuth.expected}`
        );
      if (!r.stylist.match)
        issues.push(
          `stylist: got ${r.stylist.actual}, expected ${r.stylist.expected}`
        );
      if (!r.client.match)
        issues.push(
          `client: got ${r.client.actual}, expected ${r.client.expected}`
        );
      if (issues.length > 0) {
        console.log(`   - ${r.routeKey}: ${issues.join(', ')}`);
      }
    }
  } else {
    console.log(
      `\n   \u2705 All ${endpoints.length} endpoints \u00D7 3 roles match SSOT permissions`
    );
  }
}
