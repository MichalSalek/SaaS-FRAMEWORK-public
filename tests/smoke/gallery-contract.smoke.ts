/**
 * Gallery domain contract smoke tests
 *
 * Contract tests for gallery endpoints not covered by existing smoke tests.
 * Tests auth (401), RBAC (403), and body validation (400) boundaries.
 *
 * Covered endpoints:
 * - UPDATE_GALLERY_RECORD (auth + RBAC + validation)
 * - DELETE_GALLERY_RECORD (auth + RBAC + validation)
 * - GET_GALLERY_RECORD_BY_ID (auth + validation)
 * - PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT (public, validation)
 * - PUBLIC_GET_SITEMAP_PROFILES (public GET, no validation needed)
 */

import { test, apiCall, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';

export async function runGalleryContractTests(ctx: TestContext): Promise<void> {
  // ── UPDATE_GALLERY_RECORD ──

  await test('UPDATE_GALLERY_RECORD_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/update-record',
      method: 'POST',
      body: {
        gallery_record_id: 'fake_id',
        trait_ids: ['1'],
        color_ids: ['1'],
        nail_length: NAIL_LENGTHS.MEDIUM,
      },
    });
    assert.status(res, 401);
  });

  await test('UPDATE_GALLERY_RECORD_REQUIRES_STYLIST', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/update-record',
      method: 'POST',
      token: ctx.clientToken,
      body: {
        gallery_record_id: 'fake_id',
        trait_ids: ['1'],
        color_ids: ['1'],
        nail_length: NAIL_LENGTHS.MEDIUM,
      },
    });
    assert.status(res, 403);
  });

  await test('UPDATE_GALLERY_RECORD_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/update-record',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── DELETE_GALLERY_RECORD ──

  await test('DELETE_GALLERY_RECORD_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/delete-record',
      method: 'POST',
      body: { gallery_record_id: 'fake_id' },
    });
    assert.status(res, 401);
  });

  await test('DELETE_GALLERY_RECORD_REQUIRES_STYLIST', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/delete-record',
      method: 'POST',
      token: ctx.clientToken,
      body: { gallery_record_id: 'fake_id' },
    });
    assert.status(res, 403);
  });

  await test('DELETE_GALLERY_RECORD_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/delete-record',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── GET_GALLERY_RECORD_BY_ID ──

  await test('GET_GALLERY_RECORD_BY_ID_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/get-record-by-id?gallery_record_id=fake_id',
      method: 'GET',
    });
    assert.status(res, 401);
  });

  await test('GET_GALLERY_RECORD_BY_ID_VALIDATES_BODY', async () => {
    // No gallery_record_id in query — handler returns 400
    const res = await apiCall({
      endpoint: '/api/v1/gallery/get-record-by-id',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(res, 400);
  });

  // ── PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT ──

  await test('PUBLIC_GET_GALLERY_BY_ACCOUNT_VALIDATES_BODY', async () => {
    // Public endpoint — no auth required, but account_id query param is required
    const res = await apiCall({
      endpoint: '/api/v1/public/get-gallery-by-account',
      method: 'GET',
    });
    assert.status(res, 400);
  });

  await test('PUBLIC_GET_GALLERY_BY_ACCOUNT_INVALID_ID_NO_CRASH', async () => {
    // Public endpoint with non-existent account_id — should return 200 empty or 404, not 500
    const res = await apiCall({
      endpoint:
        '/api/v1/public/get-gallery-by-account?account_id=nonexistent_account_id_12345',
      method: 'GET',
    });
    if (res.status >= 500) {
      throw new Error(
        `Expected non-500 for invalid account_id, got ${res.status}`
      );
    }
  });

  // ── PUBLIC_GET_SITEMAP_PROFILES ──

  await test('PUBLIC_SITEMAP_PROFILES_ACCESSIBLE', async () => {
    // Public GET endpoint — no auth needed, should return 200
    const res = await apiCall({
      endpoint: '/api/v1/public/sitemap-profiles',
      method: 'GET',
    });
    assert.status(res, 200);
  });
}
