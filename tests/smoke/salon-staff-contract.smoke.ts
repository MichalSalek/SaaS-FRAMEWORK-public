/**
 * Salon Staff domain contract smoke tests
 *
 * Contract tests for salon-staff endpoints not covered by existing smoke tests.
 * Tests auth (401), RBAC (403), and body validation (400) boundaries.
 *
 * Covered endpoints (coverage-checker canonical routes):
 * - SALON_STAFF_UPDATE_PERMISSIONS: endpoint: '/api/v1/salon/staff/[staffId]/update'
 *
 * Note: endpoint uses PATCH method and a dynamic [staffId] path param.
 * Tests use a fake staffId — auth/RBAC gates fire before any DB lookup.
 */

import { test, apiCall, assert } from './_test-utils';
import type { TestContext } from './_test-utils';

export async function runSalonStaffContractTests(
  ctx: TestContext
): Promise<void> {
  // ── SALON_STAFF_UPDATE_PERMISSIONS ──

  await test('SALON_STAFF_UPDATE_PERMISSIONS_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/salon/staff/fake_staff_id/update',
      method: 'PATCH',
      body: { permissions: ['VIEW_GALLERY'] },
    });
    assert.status(res, 401);
  });

  await test('SALON_STAFF_UPDATE_PERMISSIONS_REQUIRES_STYLIST', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/salon/staff/fake_staff_id/update',
      method: 'PATCH',
      token: ctx.clientToken,
      body: { permissions: ['VIEW_GALLERY'] },
    });
    assert.status(res, 403);
  });

  await test('SALON_STAFF_UPDATE_PERMISSIONS_VALIDATES_BODY', async () => {
    // Empty body: validator requires at least one of role or permissions
    const res = await apiCall({
      endpoint: '/api/v1/salon/staff/fake_staff_id/update',
      method: 'PATCH',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 400);
  });

  await test('SALON_STAFF_UPDATE_PERMISSIONS_REJECTS_ROLE_CHANGE', async () => {
    // Sending role is forbidden by the validator (privilege escalation guard)
    const res = await apiCall({
      endpoint: '/api/v1/salon/staff/fake_staff_id/update',
      method: 'PATCH',
      token: ctx.stylistToken,
      body: { role: 'OWNER' },
    });
    assert.status(res, 400);
  });
}
