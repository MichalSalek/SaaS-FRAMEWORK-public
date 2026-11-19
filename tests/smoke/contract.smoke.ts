/**
 * Contract smoke tests for DELETE_ASSET_FROM_VENDOR
 *
 * Tests auth/RBAC/validation only — no actual Cloudinary calls.
 */

import { test, apiCall, assert } from './_test-utils';
import type { TestContext } from './_test-utils';

export async function runContractTests(ctx: TestContext): Promise<void> {
  // ── DELETE_ASSET_FROM_VENDOR ──

  await test('DELETE_ASSET_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/delete-asset-from-vendor',
      method: 'POST',
      body: { asset_id: 'fake_asset' },
    });
    assert.status(res, 401);
  });

  await test('DELETE_ASSET_REQUIRES_STYLIST', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/delete-asset-from-vendor',
      method: 'POST',
      token: ctx.clientToken,
      body: { asset_id: 'fake_asset' },
    });
    assert.status(res, 403);
  });

  await test('DELETE_ASSET_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/delete-asset-from-vendor',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 400);
  });

  await test('DELETE_ASSET_INVALID_ID_NO_CRASH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/gallery/delete-asset-from-vendor',
      method: 'POST',
      token: ctx.stylistToken,
      body: { asset_id: 'invalid_no_marker' },
    });
    if (res.status >= 500) {
      throw new Error(
        `Expected non-500 for invalid asset_id, got ${res.status}`
      );
    }
  });
}
