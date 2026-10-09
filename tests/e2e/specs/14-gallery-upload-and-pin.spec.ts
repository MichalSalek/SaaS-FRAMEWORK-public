// tests/e2e/specs/14-gallery-upload-and-pin.spec.ts
//
// CRITICAL PATH #14 (Gallery: create record → pin → unpin):
//   1. Stylist creates a gallery record via the backend.
//   2. The record appears in the stylist's gallery listing.
//   3. Stylist pins the record (pin-record endpoint).
//   4. Stylist unpins the record (unpin-record endpoint).
//   5. Gallery upload asset page renders in the browser without error.
//
// SCOPE NOTE (Wave 6A pragmatic limit): "upload" in the full user flow means
// opening the Cloudinary upload widget (a third-party iframe), choosing a
// file, and waiting for the CDN callback. That flow is not scriptable without
// a live Cloudinary account + real file I/O. We exercise the API path:
//   - create-gallery-record (metadata only, no actual asset upload),
//   - pin / unpin lifecycle (the critical pin flow from the product spec),
//   - the /app/gallery/upload-asset page renders without 5xx.
// The Cloudinary widget integration is covered separately by tests/smoke/.
//
// DECISION (nie usuwaj tego komentarza):
// create-gallery-record is SINGLE-phase: its validator (gallery.validation.ts)
// requires asset_url (must start with the Cloudinary prefix), at least one
// color_id, at least one trait_id, and a nail_length — the real frontend flow
// uploads the asset via the Cloudinary widget FIRST, then creates the record
// carrying that asset_url plus the picked colors/traits. So this spec seeds a
// valid record with a STUB Cloudinary URL (validator is format-only, it does
// not verify the asset exists) + real seeded color/trait IDs (fetched in
// beforeAll). That lets the create → listing → pin/unpin lifecycle run for real
// without driving the third-party Cloudinary iframe. (A missing asset_url /
// color_ids / trait_ids is a 400 VALIDATION_FAILED, not a two-phase draft.)

import { test, expect } from '@playwright/test';
import {
  fetchDevLoginToken,
  loginViaDevToken,
  waitForAuthedSessionRoundTrip,
} from '../helpers/auth';
import { apiCall } from '../helpers/api';
import { cleanupGalleryForToken } from '../helpers/cleanup';
import { E2E_ENV } from '../helpers/env';
import { ROUTES_API } from '../../../.shared-kernel/domain/routing/routing.config';

// A stub Cloudinary URL. The create path runs the asset-ownership gate
// (`_shared/guards/cloudinary-asset.guard`), which must be able to parse a
// public id out of the address, so the stub carries the version segment
// (`/upload/v<digits>/`) a real upload has. The gate does NOT check that the
// file exists, so this seeds a valid record without the Cloudinary widget;
// re-using it on the same test account is a legal re-use of one's own file.
const STUB_ASSET_URL =
  'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1700000000/e2e-gallery-stub.jpg';

test.describe('gallery: create record + pin lifecycle', () => {
  let stylistToken = '';
  let createdRecordId: string | undefined;
  // Real seeded IDs — create requires ≥1 color and ≥1 trait (validator min(1)).
  let validColorId = '';
  let validTraitId = '';

  test.beforeAll(async () => {
    stylistToken = await fetchDevLoginToken(E2E_ENV.USERS.STYLIST);
    // Clear any gallery records left from a previous failed run so the FREE
    // plan quota (5 records) does not block creation.
    await cleanupGalleryForToken(stylistToken);

    // Fetch a valid color + trait id to satisfy the create validator. Both are
    // seeded in dev (GET_COLORS / GET_TRAITS return bare arrays of {id,...}).
    const colors = await apiCall<{ data?: Array<{ id: string }> }>(
      ROUTES_API.GET_COLORS,
      { token: stylistToken }
    );
    const traits = await apiCall<{ data?: Array<{ id: string }> }>(
      ROUTES_API.GET_TRAITS,
      { token: stylistToken }
    );
    validColorId = colors.body?.data?.[0]?.id ?? '';
    validTraitId = traits.body?.data?.[0]?.id ?? '';
  });

  test.afterAll(async () => {
    // Best-effort cleanup — remove the record we created so subsequent runs
    // start from a clean slate.
    if (createdRecordId) {
      await apiCall(ROUTES_API.DELETE_GALLERY_RECORD, {
        method: 'POST',
        token: stylistToken,
        body: { gallery_record_id: createdRecordId },
      }).catch(() => undefined);
    }
  });

  test('create-gallery-record succeeds and returns a record ID', async () => {
    expect(
      validColorId && validTraitId,
      'no seeded color/trait available — dev DB not seeded?'
    ).toBeTruthy();

    const created = await apiCall<{
      data?: {
        record?: { gallery_record_id?: string; id?: string };
        gallery_record_id?: string;
        id?: string;
      };
      event?: string;
    }>(ROUTES_API.CREATE_GALLERY_RECORD, {
      method: 'POST',
      token: stylistToken,
      // Full valid payload — the create validator requires all of these
      // (asset_url Cloudinary-format + ≥1 color + ≥1 trait + nail_length).
      body: {
        asset_url: STUB_ASSET_URL,
        color_ids: [validColorId],
        trait_ids: [validTraitId],
        nail_length: 'SHORT',
      },
    });

    // create = respondCreated (201) per the CQRS create-command convention.
    expect(
      [200, 201].includes(created.status),
      `create-gallery-record returned ${created.status}: ${JSON.stringify(created.body).slice(0, 300)}`
    ).toBe(true);

    const recordId =
      created.body?.data?.record?.gallery_record_id ??
      created.body?.data?.record?.id ??
      created.body?.data?.gallery_record_id ??
      created.body?.data?.id;
    expect(
      recordId,
      `create payload missing record ID: ${JSON.stringify(created.body).slice(0, 200)}`
    ).toBeTruthy();
    createdRecordId = recordId;
  });

  test('created record appears in stylist gallery listing', async () => {
    // HARD FAIL, not skip: a cascaded skip would let the run go green while
    // the listing step silently never executed (masked regression in the
    // creation test). The failure message points at the real culprit.
    expect(
      createdRecordId,
      'record creation failed in the prior test — failing the dependent listing check instead of skipping it'
    ).toBeTruthy();
    if (!createdRecordId) {
      return; // unreachable (expect above threw) — TypeScript narrowing only
    }

    const list = await apiCall<{
      data?: {
        records?: Array<{ gallery_record_id?: string; id?: string }>;
      };
    }>(ROUTES_API.GET_GALLERY_RECORDS, { token: stylistToken });

    expect(list.status).toBe(200);
    const records = list.body?.data?.records ?? [];
    const found = records.some(
      r => r.gallery_record_id === createdRecordId || r.id === createdRecordId
    );
    expect(
      found,
      `record ${createdRecordId} not in listing: ${JSON.stringify(records.map(r => r.gallery_record_id ?? r.id)).slice(0, 200)}`
    ).toBe(true);
  });

  test('pin-record and unpin-record lifecycle succeeds for the created record', async () => {
    // HARD FAIL, not skip — same rationale as the listing check above.
    expect(
      createdRecordId,
      'record creation failed in the prior test — failing the dependent pin lifecycle instead of skipping it'
    ).toBeTruthy();
    if (!createdRecordId) {
      return; // unreachable (expect above threw) — TypeScript narrowing only
    }

    // Pin the record.
    const pinned = await apiCall<{ event?: string; data?: unknown }>(
      ROUTES_API.GALLERY_PIN_RECORD,
      {
        method: 'POST',
        token: stylistToken,
        body: { gallery_record_id: createdRecordId },
      }
    );

    expect(
      [200, 409].includes(pinned.status),
      `pin-record returned ${pinned.status}: ${JSON.stringify(pinned.body).slice(0, 200)}`
    ).toBe(true);
    expect(pinned.status).not.toBe(401);
    expect(pinned.status).toBeLessThan(500);

    // Unpin the record — should be 200 even if not currently pinned (idempotent).
    const unpinned = await apiCall<{ event?: string; data?: unknown }>(
      ROUTES_API.GALLERY_UNPIN_RECORD,
      {
        method: 'POST',
        token: stylistToken,
        body: { gallery_record_id: createdRecordId },
      }
    );

    expect(
      [200, 409, 404].includes(unpinned.status),
      `unpin-record returned ${unpinned.status}: ${JSON.stringify(unpinned.body).slice(0, 200)}`
    ).toBe(true);
    expect(unpinned.status).not.toBe(401);
    expect(unpinned.status).toBeLessThan(500);
  });

  test('gallery upload-asset page renders without error for authenticated stylist', async ({
    page,
    context,
  }) => {
    await loginViaDevToken(context, E2E_ENV.USERS.STYLIST);

    // The upload asset page hosts the Cloudinary widget. In a dev environment
    // without a Cloudinary API key, the widget placeholder still renders —
    // what must NOT happen is a 5xx crash or a blank page. Deterministic boot
    // signal (replaces networkidle): the get-session round-trip returned a
    // live session — see helpers/auth.ts (the third-party widget iframe makes
    // a content-based marker unreliable here).
    const authedBoot = waitForAuthedSessionRoundTrip(page);
    await page.goto('/app/gallery/upload-asset');
    await authedBoot;

    await expect(page).not.toHaveTitle(/404|not found/i);

    const bodyText = (await page.textContent('body')) ?? '';
    expect(bodyText.length).toBeGreaterThan(30);
    expect(bodyText.toLowerCase()).not.toContain('internal server error');
    expect(bodyText.toLowerCase()).not.toContain('application error');

    // URL must remain inside the authenticated app shell.
    expect(page.url()).not.toMatch(/\/user\/login/);
  });

  test('gallery listing page renders correctly for authenticated stylist', async ({
    page,
    context,
  }) => {
    await loginViaDevToken(context, E2E_ENV.USERS.STYLIST);
    await page.goto('/app/gallery');
    // Deterministic render signal (replaces networkidle): gallery is a bottom
    // tab route — the active tab (aria-current="page") appears once the route
    // hydrates (same ARIA-only doctrine as spec 18).
    await expect(
      page.locator('nav button[aria-current="page"]').first()
    ).toBeVisible({ timeout: 15_000 });

    await expect(page).not.toHaveTitle(/404|not found/i);

    const bodyText = (await page.textContent('body')) ?? '';
    expect(bodyText.length).toBeGreaterThan(30);
    expect(bodyText.toLowerCase()).not.toContain('internal server error');

    // Page must be inside the app shell.
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);
  });
});

