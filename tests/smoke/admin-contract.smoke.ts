/**
 * Admin domain contract smoke tests
 *
 * Contract tests for admin endpoints not covered by existing smoke tests.
 * Tests auth (401), RBAC (403), and body validation (400) boundaries.
 *
 * Covered endpoints:
 * - SWITCH_BACKEND_DEBUG_MODE (auth + RBAC)
 * - SAVE_NOTE (auth + RBAC + validation)
 * - SET_MAIN_NOTE (auth + RBAC + validation)
 * - ADMIN_CHANGE_PRICING_PLAN (auth + RBAC + validation)
 * - ADMIN_CREATE_COLOR (auth + RBAC + validation)
 * - ADMIN_UPDATE_COLOR (auth + RBAC + validation)
 * - ADMIN_DELETE_COLOR (auth + RBAC + validation)
 * - ADMIN_CREATE_TRAIT (auth + RBAC + validation)
 * - ADMIN_UPDATE_TRAIT (auth + RBAC + validation)
 * - ADMIN_DELETE_TRAIT (auth + RBAC + validation)
 * - ADMIN_PURGE_DELETED_USER (auth + RBAC + validation)
 * - ADMIN_UPDATE_PERMISSIONS (auth + RBAC + validation)
 */

import { test, apiCall, assert } from './_test-utils';
import type { TestContext } from './_test-utils';

export async function runAdminContractTests(ctx: TestContext): Promise<void> {
  // ── SWITCH_BACKEND_DEBUG_MODE ──

  await test('DEBUG_MODE_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/debug-mode',
      method: 'POST',
      body: {},
    });
    assert.status(res, 401);
  });

  await test('DEBUG_MODE_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/debug-mode',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 403);
  });

  // ── SAVE_NOTE ──

  await test('SAVE_NOTE_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/save-note',
      method: 'POST',
      body: { notes: 'test' },
    });
    assert.status(res, 401);
  });

  await test('SAVE_NOTE_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/save-note',
      method: 'POST',
      token: ctx.stylistToken,
      body: { notes: 'test' },
    });
    assert.status(res, 403);
  });

  await test('SAVE_NOTE_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/save-note',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── SET_MAIN_NOTE ──

  await test('SET_MAIN_NOTE_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/set-main-note',
      method: 'POST',
      body: { id: 'fake_id' },
    });
    assert.status(res, 401);
  });

  await test('SET_MAIN_NOTE_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/set-main-note',
      method: 'POST',
      token: ctx.stylistToken,
      body: { id: 'fake_id' },
    });
    assert.status(res, 403);
  });

  await test('SET_MAIN_NOTE_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/set-main-note',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── ADMIN_CHANGE_PRICING_PLAN ──

  await test('CHANGE_PRICING_PLAN_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/user/change-pricing-plan',
      method: 'POST',
      body: { id: 'fake_id', pricing_plan: 'PRO' },
    });
    assert.status(res, 401);
  });

  await test('CHANGE_PRICING_PLAN_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/user/change-pricing-plan',
      method: 'POST',
      token: ctx.stylistToken,
      body: { id: 'fake_id', pricing_plan: 'PRO' },
    });
    assert.status(res, 403);
  });

  await test('CHANGE_PRICING_PLAN_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/user/change-pricing-plan',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── ADMIN_CREATE_COLOR ──

  await test('CREATE_COLOR_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/create-color',
      method: 'POST',
      body: { name: 'Test', hex_code: '#FF0000' },
    });
    assert.status(res, 401);
  });

  await test('CREATE_COLOR_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/create-color',
      method: 'POST',
      token: ctx.stylistToken,
      body: { name: 'Test', hex_code: '#FF0000' },
    });
    assert.status(res, 403);
  });

  await test('CREATE_COLOR_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/create-color',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── ADMIN_UPDATE_COLOR ──

  await test('UPDATE_COLOR_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/update-color',
      method: 'POST',
      body: { color_id: 'fake_id', name: 'Updated' },
    });
    assert.status(res, 401);
  });

  await test('UPDATE_COLOR_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/update-color',
      method: 'POST',
      token: ctx.stylistToken,
      body: { color_id: 'fake_id', name: 'Updated' },
    });
    assert.status(res, 403);
  });

  await test('UPDATE_COLOR_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/update-color',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── ADMIN_DELETE_COLOR ──

  await test('DELETE_COLOR_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/delete-color',
      method: 'POST',
      body: { color_id: 'fake_id' },
    });
    assert.status(res, 401);
  });

  await test('DELETE_COLOR_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/delete-color',
      method: 'POST',
      token: ctx.stylistToken,
      body: { color_id: 'fake_id' },
    });
    assert.status(res, 403);
  });

  await test('DELETE_COLOR_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/delete-color',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── ADMIN_CREATE_TRAIT ──

  await test('CREATE_TRAIT_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/create-trait',
      method: 'POST',
      body: { name: 'Test', category: 'style' },
    });
    assert.status(res, 401);
  });

  await test('CREATE_TRAIT_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/create-trait',
      method: 'POST',
      token: ctx.stylistToken,
      body: { name: 'Test', category: 'style' },
    });
    assert.status(res, 403);
  });

  await test('CREATE_TRAIT_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/create-trait',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── ADMIN_UPDATE_TRAIT ──

  await test('UPDATE_TRAIT_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/update-trait',
      method: 'POST',
      body: { trait_id: 'fake_id', name: 'Updated' },
    });
    assert.status(res, 401);
  });

  await test('UPDATE_TRAIT_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/update-trait',
      method: 'POST',
      token: ctx.stylistToken,
      body: { trait_id: 'fake_id', name: 'Updated' },
    });
    assert.status(res, 403);
  });

  await test('UPDATE_TRAIT_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/update-trait',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── ADMIN_DELETE_TRAIT ──

  await test('DELETE_TRAIT_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/delete-trait',
      method: 'POST',
      body: { trait_id: 'fake_id' },
    });
    assert.status(res, 401);
  });

  await test('DELETE_TRAIT_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/delete-trait',
      method: 'POST',
      token: ctx.stylistToken,
      body: { trait_id: 'fake_id' },
    });
    assert.status(res, 403);
  });

  await test('DELETE_TRAIT_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/delete-trait',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── ADMIN_PURGE_DELETED_USER ──

  await test('PURGE_DELETED_USER_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/deleted-user/purge',
      method: 'POST',
      body: { user_id: 'fake_user_id' },
    });
    assert.status(res, 401);
  });

  await test('PURGE_DELETED_USER_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/deleted-user/purge',
      method: 'POST',
      token: ctx.stylistToken,
      body: { user_id: 'fake_user_id' },
    });
    assert.status(res, 403);
  });

  await test('PURGE_DELETED_USER_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/deleted-user/purge',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });

  // ── ADMIN_UPDATE_PERMISSIONS ──

  await test('UPDATE_PERMISSIONS_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/permissions/update',
      method: 'POST',
      body: { role_id: 'fake_role_id', permission_ids: [] },
    });
    assert.status(res, 401);
  });

  await test('UPDATE_PERMISSIONS_REQUIRES_ADMIN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/permissions/update',
      method: 'POST',
      token: ctx.stylistToken,
      body: { role_id: 'fake_role_id', permission_ids: [] },
    });
    assert.status(res, 403);
  });

  await test('UPDATE_PERMISSIONS_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/admin/permissions/update',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(res, 400);
  });
}
