/**
 * Integration-handler tests — GET query ARCHETYPES (BDX W0.3 part B).
 *
 * One representative per query archetype, each driven through the REAL production
 * `HTTPRequestHandlerMiddleware` (CORS → rate-limit → method guard → auth → permission
 * → account-state → validation → business logic → error mapper). Only DB / auth /
 * permission / run-after-response are mocked (setup.ts) — the rest runs for real, so
 * each test asserts the TRUE `{ event, data }` HTTP contract.
 *
 * Archetypes covered:
 *   1. PUBLIC query, auth-OFF (no permission gate)  → pricing/get-plans
 *      LUKA CRITICAL: a public query reachable by anyone — characterize the 200 + payload.
 *   2. PUBLIC query, anonymous caller               → public/get-stylist-profile
 *   3. ADMIN-ONLY query (real SSOT permission gate)  → admin/users
 *      Uses __setPermission(null) to exercise the REAL O(1) config matrix:
 *      MASTER_ADMIN → 200, stylist → 403, anonymous → 401.
 *   4. PAGINATED query (cursor/items envelope)       → gallery/explore
 *
 * ADMIN RECOGNITION (documented for reviewers): an admin is a user whose
 * `role_id === SystemRoleId.MASTER_ADMIN` ('role_master_admin'). The middleware
 * permission gate resolves system roles via an O(1) config lookup
 * (permissions.cache.checkPermissionFromConfig: MASTER_ADMIN ⇒ every event except
 * SELF_ONLY_EVENTS), so `__setPermission(null)` exercises the genuine matrix WITHOUT
 * any DB query. The admin operation itself re-checks the same role via
 * `requireAdminPermission` (admin.guards.ts → PERMISSIONS_POLICY.utils.IS_ADMIN).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import {
  __setCurrentUser,
  __resetCurrentUser,
  __setPermission,
} from '../setup';
import {
  makeCurrentUserOutput,
  makeStylistCurrentUser,
  makeClientCurrentUser,
} from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';

import { invalidateFeatureFlagCache } from '@app/feature-flags/feature-flags.cache';

import getPlansHandler from '../../pages/api/v1/pricing/get-plans/index';
import getStylistProfileHandler from '../../pages/api/v1/public/get-stylist-profile/index';
import adminUsersHandler from '../../pages/api/v1/admin/users/index';
import exploreHandler from '../../pages/api/v1/gallery/explore/index';

// ─── Archetype 1: PUBLIC query, auth-OFF (pricing/get-plans) ─────────────────────
//
// AUTHENTICATION_CHECK_ENABLED:false ⇒ no permission gate; reachable by anyone.
// fetchPricingPlans() → getStripe() throws (no STRIPE_SECRET_KEY in test env) → the
// op falls back to buildFallbackResponse() ⇒ deterministic 200 + is_fallback:true.

describe('GET /api/v1/pricing/get-plans (PUBLIC auth-OFF archetype)', () => {
  beforeEach(() => {
    __resetCurrentUser(); // anonymous — proves auth-off reachability
    __setPermission(null);
  });

  it('returns 200 + plan list for an anonymous caller (no auth, no permission gate)', async () => {
    const { status, event, data } = await mockApiHandler<{
      plans: Array<{ plan_id: string }>;
      currency: string;
      is_fallback: boolean;
    }>(getPlansHandler, { method: 'GET' });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.PRICING.PRICING_PLANS_FETCHED);
    expect(Array.isArray(data.plans)).toBe(true);
    expect(data.plans.length).toBeGreaterThan(0);
    // The fallback list (no live Stripe in tests) always includes the FREE plan.
    expect(data.plans.some(p => p.plan_id === PricingPlanValue.FREE)).toBe(
      true
    );
    expect(data.is_fallback).toBe(true);
  });
});

// ─── Archetype 2: PUBLIC query, anonymous caller (public/get-stylist-profile) ────

describe('GET /api/v1/public/get-stylist-profile (PUBLIC profile archetype)', () => {
  beforeEach(() => {
    __resetCurrentUser(); // public endpoint — served to anonymous visitors
    __setPermission(null);
  });

  it('returns 200 + profile for an anonymous caller (mocked active stylist row)', async () => {
    mockDb({
      stylistAccount: {
        findFirst: async () => ({
          account_id: 'acc_public_1',
          account_status: AccountStatusValue.ACTIVE,
          display_name: 'Public Salon',
          business_name: null,
          address_city: 'Warsaw',
          address_country: 'PL',
          phone: null,
          website: null,
          description: null,
          vanity_url: 'public-salon',
          view_count: 42,
          instagram_handle: null,
          avatar_url: null,
          cached_bookmark_count: 3,
          // Cała galeria (także nieprzypięte) — NIE jest liczbą publiczną.
          cached_gallery_count: 40,
          cached_likes_count: 11,
          pricing_plan: PricingPlanValue.PRO,
        }),
      },
      galleryRecord: {
        // Nieukryte prace stylistki = publiczny rozmiar portfolio.
        count: async (args: { where: Record<string, unknown> }) => {
          expect(args.where).toEqual({
            created_by_account_id: 'acc_public_1',
            is_hidden: false,
          });
          return 7;
        },
      },
    });

    const { status, event, data } = await mockApiHandler<{
      account: { account_id: string; display_name: string };
      gallery_records_count: number;
      bookmark_count: number;
      total_likes: number;
    }>(getStylistProfileHandler, {
      method: 'GET',
      query: { identifier: 'public-salon' },
    });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.ACCOUNT.PUBLIC_PROFILE_FETCHED);
    expect(data.account.account_id).toBe('acc_public_1');
    expect(data.gallery_records_count).toBe(7);
    expect(data.total_likes).toBe(11);
  });

  it('gallery_records_count = all non-hidden works, NOT capped by the plan (profile says "featured N + M more")', async () => {
    // FREE shows 3 featured, and 12 non-hidden works exist: the profile says
    // "Wyróżnione (3) + jeszcze 9 w pełnej galerii", so 12 is the true number.
    // The stale cache (25) is not used.
    mockDb({
      stylistAccount: {
        findFirst: async () => ({
          account_id: 'acc_public_2',
          account_status: AccountStatusValue.ACTIVE,
          display_name: 'Downgraded Salon',
          business_name: null,
          address_city: null,
          address_country: null,
          phone: null,
          website: null,
          description: null,
          vanity_url: null,
          view_count: 0,
          instagram_handle: null,
          avatar_url: null,
          cached_bookmark_count: 0,
          cached_gallery_count: 25,
          cached_likes_count: 0,
          pricing_plan: PricingPlanValue.FREE,
        }),
      },
      galleryRecord: { count: async () => 12 },
    });

    const { status, data } = await mockApiHandler<{
      gallery_records_count: number;
    }>(getStylistProfileHandler, {
      method: 'GET',
      query: { identifier: 'acc_public_2' },
    });

    expect(status).toBe(200);
    expect(data.gallery_records_count).toBe(12);
  });

  it('returns 400 VALIDATION_FAILED when the identifier query param is missing', async () => {
    const { status, event } = await mockApiHandler(getStylistProfileHandler, {
      method: 'GET',
    });

    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
  });
});

// ─── Archetype 3: ADMIN-ONLY query, REAL permission gate (admin/users) ───────────
//
// __setPermission(null) → real O(1) SSOT matrix. MASTER_ADMIN passes; stylist & anon
// are rejected by the middleware permission gate (403 / 401) BEFORE business logic.

describe('GET /api/v1/admin/users (ADMIN-ONLY archetype, real SSOT gate)', () => {
  it('returns 200 + records envelope for a MASTER_ADMIN (real permission matrix)', async () => {
    __setCurrentUser(
      makeCurrentUserOutput(
        makeStylistCurrentUser({ user: { role_id: SystemRoleId.MASTER_ADMIN } })
      )
    );
    __setPermission(null); // exercise the genuine RBAC config lookup

    // adminGetUsersPaginated_IO queries user.findMany; empty list ⇒ clean envelope.
    mockDb({ user: { findMany: async () => [] } });

    const { status, event, data } = await mockApiHandler<{
      records: unknown[];
      nextCursor: string | null;
    }>(adminUsersHandler, { method: 'GET' });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.ADMIN.ADMIN_USERS_PAGINATED_FETCHED);
    expect(Array.isArray(data.records)).toBe(true);
    expect(data.nextCursor).toBeNull();
  });

  it('returns 403 for a non-admin stylist (real permission matrix denies)', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(null);

    const { status, event } = await mockApiHandler(adminUsersHandler, {
      method: 'GET',
    });

    // Authenticated-but-forbidden → 403 + UNAUTHORIZED (user exists, lacks the event).
    expect(status).toBe(403);
    expect(event).toBe(APP_EVENTS.INFO.USER.UNAUTHORIZED);
  });

  it('returns 401 for an anonymous caller (real permission matrix denies)', async () => {
    __resetCurrentUser();
    __setPermission(null);

    const { status, event } = await mockApiHandler(adminUsersHandler, {
      method: 'GET',
    });

    // No user → 401 + LOGIN_FIRST.
    expect(status).toBe(401);
    expect(event).toBe(APP_EVENTS.INFO.USER.LOGIN_FIRST);
  });
});

// ─── Archetype 4: PAGINATED query (gallery/explore) ──────────────────────────────
//
// Authenticated discovery feed. EXPLORE_ENABLED is OFF by kernel default, so the
// back-guard reads the live flag from featureFlag.findMany — mock it ON. Asserts the
// cursor/items pagination envelope ({ records, nextCursor }).

describe('GET /api/v1/gallery/explore (PAGINATED query archetype)', () => {
  beforeEach(() => {
    // Logged-in client browses the explore feed.
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    __setPermission(true); // focus on the pagination shape, not the RBAC matrix
    // The feature-flag cache is module-level (TTL 60s) and would otherwise bleed the
    // first test's ON value into the second test's OFF case. Reset it per test so each
    // mock featureFlag.findMany is actually read.
    invalidateFeatureFlagCache();
  });

  it('returns 200 + { records, nextCursor } pagination envelope', async () => {
    mockDb({
      // EXPLORE_ENABLED back-guard reads the live flag → return it enabled.
      featureFlag: {
        findMany: async () => [{ key: 'explore_enabled', is_enabled: true }],
      },
      // Empty feed: a clean end-of-list page (nextCursor === null).
      galleryRecord: { findMany: async () => [] },
    });

    const { status, event, data } = await mockApiHandler<{
      records: unknown[];
      nextCursor: string | null;
    }>(exploreHandler, { method: 'GET' });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.GALLERY.EXPLORE_GALLERY_RECORDS_FETCHED);
    expect(Array.isArray(data.records)).toBe(true);
    // End-of-list → no further page.
    expect(data.nextCursor).toBeNull();
  });

  it('returns 404 NOT_FOUND when EXPLORE_ENABLED is off (back-guard masks the feed)', async () => {
    mockDb({
      featureFlag: {
        findMany: async () => [{ key: 'explore_enabled', is_enabled: false }],
      },
    });

    const { status, event } = await mockApiHandler(exploreHandler, {
      method: 'GET',
    });

    expect(status).toBe(404);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.NOT_FOUND);
  });
});
