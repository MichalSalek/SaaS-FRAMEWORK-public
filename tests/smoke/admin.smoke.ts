/**
 * Admin domain smoke tests
 *
 * Covers: ADMIN_USER_DISABLE_AND_ENABLE, ADMIN_GET_NOTES,
 *         ADMIN_SEND_AND_GET_LOGS, SWITCH_BACK_BECOME_USER_MISSING_HEADER,
 *         BECOME_USER_AND_SWITCH_BACK, BECOME_USER_AND_REFRESH_IMPERSONATION,
 *         ADMIN_GET_USERS_PAGINATED, ADMIN_GET_FEATURE_FLAGS, ADMIN_GET_METRICS,
 *         ADMIN_GET_HEALTH, ADMIN_GET_AUDIT_TRAIL, ADMIN_BULK_*,
 *         ADMIN_ANNOUNCEMENTS_*, ADMIN_GET_REPORTS, ADMIN_GET_USER_TIMELINE,
 *         ADMIN_GET_CONFIGS, ADMIN_UPDATE_CONFIG
 */

import {
  test,
  apiCall,
  getData,
  assert,
  getEvent,
  getAdminToken,
  getFreshAdminToken,
} from './_test-utils';
import { results } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

export async function runAdminTests(ctx: TestContext): Promise<void> {
  console.log('\n\uD83D\uDC51 ADMIN OPERATIONS\n');

  // Pre-check: verify admin has MASTER_ADMIN role before running admin tests
  const adminAccessCheck = await apiCall({
    endpoint: '/api/v1/admin/check-access',
    method: 'GET',
    token: ctx.adminToken,
  });

  if (adminAccessCheck.status === 403) {
    console.log(
      '\u26A0\uFE0F  Admin user lacks MASTER_ADMIN role (likely DB was manually changed).'
    );
    console.log(
      '   Fix: docker restart web-1-dev (instrumentation.ts auto-promotes on startup)'
    );
    console.log('   Skipping admin tests...\n');
    results.push({
      endpoint: 'ADMIN_ACCESS_VERIFY',
      status: 'FAIL',
      duration: 0,
      error:
        'Admin user needs MASTER_ADMIN role. Restart backend: docker restart web-1-dev',
    });
    return;
  }

  await test('ADMIN_USER_DISABLE_AND_ENABLE', async () => {
    // Create a temporary user to disable/enable (don't use the main test user)
    const tempEmail = `temp-admin-test-${Date.now()}@example.com`;
    const loginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginResponse, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginResponse);
    const tempUserId = loginData.id;

    try {
      // Disable user
      const disableResponse = await apiCall({
        endpoint: '/api/v1/admin/user/disable/any',
        method: 'POST',
        token: ctx.adminToken,
        body: { id: tempUserId },
      });
      assert.status(disableResponse, 200);
      const disableEvent = getEvent(disableResponse);
      assert.equals(
        typeof disableEvent,
        'string',
        'disable event should be string'
      );

      // Enable user
      const enableResponse = await apiCall({
        endpoint: '/api/v1/admin/user/enable/any',
        method: 'POST',
        token: ctx.adminToken,
        body: { id: tempUserId },
      });
      assert.status(enableResponse, 200);
      const enableEvent = getEvent(enableResponse);
      assert.equals(
        typeof enableEvent,
        'string',
        'enable event should be string'
      );
    } finally {
      // Cleanup: delete the temp user
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: ctx.adminToken,
        body: { id: tempUserId },
      });
    }
  });

  await test('ADMIN_GET_NOTES', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/get-notes',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);
    const data = getData<ADMIN_DTO_API_V1['GET_NOTES']['RESPONSE']>(response);
    assert.hasProperty(data as unknown as Record<string, unknown>, 'versions');
  });

  await test('ADMIN_SEND_AND_GET_LOGS', async () => {
    // Send a test log
    const sendResponse = await apiCall({
      endpoint: '/api/v1/admin/send-log',
      method: 'POST',
      token: ctx.adminToken,
      body: {
        environment: 'test',
        namespace: 'SMOKE_TEST',
        type: 'info',
        message: `smoke-test-${Date.now()}`,
        payload: '{}',
        user_id: null,
        user_metadata: '{}',
      },
    });
    // Event log store may not be configured in dev Docker (DATABASE_EVENT_LOG_STORE_URL)
    if (sendResponse.status === 500) {
      console.log('   (Event log store not configured — skipping)');
      return;
    }
    assert.status(sendResponse, 200);

    // Retrieve logs
    const getResponse = await apiCall({
      endpoint: '/api/v1/admin/get-logs',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(getResponse, 200);
    const data = getData<ADMIN_DTO_API_V1['GET_LOGS']['RESPONSE']>(getResponse);
    // S122: server-side filtering + cursor pagination replaced { logs, stats }.
    if (!data || !Array.isArray(data.records))
      throw new Error('Expected { records, nextCursor, totalCount } response');
    if (typeof data.totalCount !== 'number')
      throw new Error('Expected totalCount');
    if (data.records.length > 0) {
      const first = data.records[0] as unknown as Record<string, unknown>;
      assert.hasProperty(first, 'id');
      assert.hasProperty(first, 'namespace');
      assert.hasProperty(first, 'message');
      assert.hasProperty(first, 'user_id');
    }
  });

  await test('SWITCH_BACK_BECOME_USER_MISSING_HEADER', async () => {
    // Without become-user header, should get 400 (not 404) -- FIX 4 regression test
    const response = await apiCall({
      endpoint: '/api/v1/admin/switch-back-become-user',
      method: 'POST',
      token: ctx.adminToken,
    });
    assert.status(response, 400);
    assert.equals(
      getEvent(response),
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
    );
  });

  await test('BECOME_USER_AND_SWITCH_BACK', async () => {
    // Get fresh admin token (previous tests may have invalidated it)
    const freshAdminToken = await getFreshAdminToken();

    // Create temp user to impersonate
    const tempEmail = `temp-become-${Date.now()}@example.com`;
    const loginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginResponse, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginResponse);
    const tempUserId = loginData.id;

    try {
      // Admin becomes temp user -- server creates new session & returns it in authorization header
      const becomeResponse = await apiCall({
        endpoint: '/api/v1/admin/become-user',
        method: 'POST',
        token: freshAdminToken,
        body: { id: tempUserId },
      });
      assert.status(becomeResponse, 200);
      const becomeData =
        getData<ADMIN_DTO_API_V1['BECOME_USER']['RESPONSE']>(becomeResponse);
      assert.hasProperty(becomeData, 'id');
      assert.hasProperty(becomeData, 'email');

      // Extract become-user backup header and new session token from response
      const becomeUserHeader = becomeResponse.headers['become-user'];
      if (!becomeUserHeader)
        throw new Error('Missing become-user header in response');
      const impersonationToken =
        becomeResponse.headers['authorization'] || freshAdminToken;

      // Switch back to admin using impersonation token + backup header
      const switchBackResponse = await apiCall({
        endpoint: '/api/v1/admin/switch-back-become-user',
        method: 'POST',
        token: impersonationToken,
        headers: { 'become-user': becomeUserHeader },
      });
      assert.status(switchBackResponse, 200);
    } finally {
      // Cleanup: delete temp user (use fresh token since impersonation may have changed session)
      const cleanupToken = await getFreshAdminToken();
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: cleanupToken,
        body: { id: tempUserId },
      });
    }
  });

  await test('BECOME_USER_AND_REFRESH_IMPERSONATION', async () => {
    // Get fresh admin token
    const freshAdminToken = await getFreshAdminToken();

    // Create temp user
    const tempEmail = `temp-refresh-${Date.now()}@example.com`;
    const loginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginResponse, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginResponse);
    const tempUserId = loginData.id;

    try {
      // Become user
      const becomeResponse = await apiCall({
        endpoint: '/api/v1/admin/become-user',
        method: 'POST',
        token: freshAdminToken,
        body: { id: tempUserId },
      });
      assert.status(becomeResponse, 200);
      const becomeUserHeader = becomeResponse.headers['become-user'];
      if (!becomeUserHeader) throw new Error('Missing become-user header');
      const impersonationToken =
        becomeResponse.headers['authorization'] || freshAdminToken;

      // Refresh impersonation
      const refreshResponse = await apiCall({
        endpoint: '/api/v1/admin/refresh-impersonation',
        method: 'POST',
        token: impersonationToken,
        headers: { 'become-user': becomeUserHeader },
      });
      assert.status(refreshResponse, 200);
      const refreshData =
        getData<ADMIN_DTO_API_V1['REFRESH_IMPERSONATION']['RESPONSE']>(
          refreshResponse
        );
      assert.hasProperty(
        refreshData as unknown as Record<string, unknown>,
        'expiresAt'
      );
      assert.equals(
        typeof refreshData.expiresAt,
        'number',
        'expiresAt should be number'
      );

      // Switch back to cleanup impersonation state
      await apiCall({
        endpoint: '/api/v1/admin/switch-back-become-user',
        method: 'POST',
        token: impersonationToken,
        headers: { 'become-user': becomeUserHeader },
      });
    } finally {
      // Fresh mint — the impersonation round-trip above may have replaced the session.
      const cleanupToken = await getFreshAdminToken();
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: cleanupToken,
        body: { id: tempUserId },
      });
    }
  });

  // ============================================================================
  // NEW ADMIN FEATURES -- 12 endpoints added in iteration 1
  // ============================================================================

  console.log('\n\uD83C\uDD95 NEW ADMIN FEATURES (12 endpoints)\n');

  await test('ADMIN_GET_USERS_PAGINATED', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/users',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['RESPONSE']>(
        response
      );
    assert.hasProperty(data as unknown as Record<string, unknown>, 'records');
    assert.equals(
      Array.isArray(data.records),
      true,
      'records should be an array'
    );
    assert.hasProperty(
      data as unknown as Record<string, unknown>,
      'nextCursor'
    );
  });

  await test('ADMIN_GET_USERS_PAGINATED_RBAC_NEGATIVE', async () => {
    // Non-admin user -> 403
    const response = await apiCall({
      endpoint: '/api/v1/admin/users',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 403);
  });

  await test('ADMIN_GET_FEATURE_FLAGS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/feature-flags',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_FEATURE_FLAGS']['RESPONSE']>(response);
    assert.equals(
      Array.isArray(data),
      true,
      'feature flags should be an array'
    );
    if (data.length > 0) {
      assert.hasProperty(data[0] as unknown as Record<string, unknown>, 'id');
      assert.hasProperty(data[0] as unknown as Record<string, unknown>, 'key');
      assert.hasProperty(
        data[0] as unknown as Record<string, unknown>,
        'is_enabled'
      );
    }
  });

  await test('ADMIN_GET_FEATURE_FLAGS_PUBLIC', async () => {
    // Despite the name, GET_FEATURE_FLAGS_PUBLIC is in LOGGED_USER_PERMISSIONS (SSOT)
    const response = await apiCall({
      endpoint: '/api/v1/feature-flags',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['GET_FEATURE_FLAGS_PUBLIC']['RESPONSE']>(
        response
      );
    assert.equals(typeof data, 'object', 'should be an object (key->bool map)');
  });

  await test('ADMIN_TOGGLE_FEATURE_FLAG', async () => {
    // Note: We can't safely create/toggle real feature flags in tests (no cleanup).
    // This test verifies endpoint exists and validation works.
    const response = await apiCall({
      endpoint: '/api/v1/admin/feature-flags/toggle',
      method: 'POST',
      token: ctx.adminToken,
      body: { key: 'nonexistent_test_flag', is_enabled: true },
    });
    // Accept 200 (success) or 404 (flag not found) or 400 (validation)
    if (
      response.status !== 200 &&
      response.status !== 404 &&
      response.status !== 400
    ) {
      throw new Error(`Expected 200/404/400, got ${response.status}`);
    }
  });

  await test('ADMIN_TOGGLE_FEATURE_FLAG_VALIDATION_NEGATIVE', async () => {
    // Missing required field
    const response = await apiCall({
      endpoint: '/api/v1/admin/feature-flags/toggle',
      method: 'POST',
      token: ctx.adminToken,
      body: { key: 'test' }, // Missing is_enabled
    });
    assert.status(response, 400);
  });

  await test('ADMIN_GET_METRICS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/metrics',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_METRICS']['RESPONSE']>(response);
    assert.hasProperty(data as unknown as Record<string, unknown>, 'users');
    assert.hasProperty(data as unknown as Record<string, unknown>, 'sessions');
    assert.hasProperty(data as unknown as Record<string, unknown>, 'gallery');
    assert.equals(
      typeof data.users.total,
      'number',
      'users.total should be number'
    );
    assert.equals(
      typeof data.sessions.activeSessions,
      'number',
      'sessions.activeSessions should be number'
    );
    assert.equals(
      typeof data.gallery.totalRecords,
      'number',
      'gallery.totalRecords should be number'
    );
  });

  await test('ADMIN_GET_METRICS_RBAC_NEGATIVE', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/metrics',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 403);
  });

  await test('ADMIN_GET_HEALTH', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/health',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['ADMIN_HEALTH']['RESPONSE']>(response);
    assert.hasProperty(data as unknown as Record<string, unknown>, 'backend');
    assert.hasProperty(data as unknown as Record<string, unknown>, 'database');
    assert.hasProperty(
      data as unknown as Record<string, unknown>,
      'checked_at'
    );
    assert.equals(
      typeof data.checked_at,
      'string',
      'checked_at should be string'
    );
    assert.equals(
      typeof data.backend.uptime_seconds,
      'number',
      'uptime_seconds should be number'
    );
  });

  await test('ADMIN_GET_AUDIT_TRAIL', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/audit-trail',
      method: 'GET',
      token: ctx.adminToken,
    });
    // Audit trail depends on event log store (DATABASE_EVENT_LOG_STORE_URL)
    if (response.status === 500) {
      console.log('   (Event log store not configured — skipping)');
      return;
    }
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['RESPONSE']>(response);
    assert.hasProperty(data as unknown as Record<string, unknown>, 'entries');
    assert.hasProperty(data as unknown as Record<string, unknown>, 'total');
    assert.equals(
      Array.isArray(data.entries),
      true,
      'entries should be an array'
    );
    assert.equals(typeof data.total, 'number', 'total should be number');
    if (data.entries.length > 0) {
      assert.hasProperty(
        data.entries[0] as unknown as Record<string, unknown>,
        'id'
      );
      assert.hasProperty(
        data.entries[0] as unknown as Record<string, unknown>,
        'event_name'
      );
      assert.hasProperty(
        data.entries[0] as unknown as Record<string, unknown>,
        'created_at'
      );
    }
  });

  await test('ADMIN_BULK_DISABLE', async () => {
    // Create temp user to disable
    const tempEmail = `temp-bulk-disable-${Date.now()}@example.com`;
    const loginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginResponse, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginResponse);
    const tempUserId = loginData.id;

    try {
      const response = await apiCall({
        endpoint: '/api/v1/admin/users/bulk-disable',
        method: 'POST',
        token: ctx.adminToken,
        body: { user_ids: [tempUserId] },
      });
      assert.status(response, 200);
      const data =
        getData<ADMIN_DTO_API_V1['ADMIN_BULK_DISABLE']['RESPONSE']>(response);
      assert.hasProperty(
        data as unknown as Record<string, unknown>,
        'affected'
      );
      assert.equals(data.affected, 1, 'should disable 1 user');
    } finally {
      // Cleanup
      const cleanupToken = await getAdminToken();
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: cleanupToken,
        body: { id: tempUserId },
      });
    }
  });

  await test('ADMIN_BULK_ENABLE', async () => {
    // Create temp user, disable, then enable
    const tempEmail = `temp-bulk-enable-${Date.now()}@example.com`;
    const loginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginResponse, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginResponse);
    const tempUserId = loginData.id;

    try {
      // Disable first
      await apiCall({
        endpoint: '/api/v1/admin/user/disable/any',
        method: 'POST',
        token: ctx.adminToken,
        body: { id: tempUserId },
      });

      // Then enable via bulk
      const response = await apiCall({
        endpoint: '/api/v1/admin/users/bulk-enable',
        method: 'POST',
        token: ctx.adminToken,
        body: { user_ids: [tempUserId] },
      });
      assert.status(response, 200);
      const data =
        getData<ADMIN_DTO_API_V1['ADMIN_BULK_ENABLE']['RESPONSE']>(response);
      assert.hasProperty(
        data as unknown as Record<string, unknown>,
        'affected'
      );
      assert.equals(data.affected, 1, 'should enable 1 user');
    } finally {
      const cleanupToken = await getAdminToken();
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: cleanupToken,
        body: { id: tempUserId },
      });
    }
  });

  await test('ADMIN_BULK_LOGOUT', async () => {
    // Create temp user with session
    const tempEmail = `temp-bulk-logout-${Date.now()}@example.com`;
    const loginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginResponse, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginResponse);
    const tempUserId = loginData.id;

    try {
      const response = await apiCall({
        endpoint: '/api/v1/admin/users/bulk-logout',
        method: 'POST',
        token: ctx.adminToken,
        body: { user_ids: [tempUserId] },
      });
      assert.status(response, 200);
      const data =
        getData<ADMIN_DTO_API_V1['ADMIN_BULK_LOGOUT']['RESPONSE']>(response);
      assert.hasProperty(
        data as unknown as Record<string, unknown>,
        'affected'
      );
      assert.hasProperty(
        data as unknown as Record<string, unknown>,
        'sessionsDeleted'
      );
    } finally {
      const cleanupToken = await getAdminToken();
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: cleanupToken,
        body: { id: tempUserId },
      });
    }
  });

  await test('ADMIN_BULK_CHANGE_PLAN', async () => {
    // Create temp user
    const tempEmail = `temp-bulk-plan-${Date.now()}@example.com`;
    const loginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginResponse, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginResponse);
    const tempUserId = loginData.id;

    try {
      const response = await apiCall({
        endpoint: '/api/v1/admin/users/bulk-change-plan',
        method: 'POST',
        token: ctx.adminToken,
        body: { user_ids: [tempUserId], pricing_plan: 'PRO' },
      });
      assert.status(response, 200);
      const data =
        getData<ADMIN_DTO_API_V1['ADMIN_BULK_CHANGE_PLAN']['RESPONSE']>(
          response
        );
      assert.hasProperty(
        data as unknown as Record<string, unknown>,
        'affected'
      );
      assert.equals(data.affected, 1, 'should change 1 user plan');
    } finally {
      const cleanupToken = await getAdminToken();
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: cleanupToken,
        body: { id: tempUserId },
      });
    }
  });

  await test('ADMIN_BULK_VALIDATION_NEGATIVE', async () => {
    // Empty user_ids array
    const response = await apiCall({
      endpoint: '/api/v1/admin/users/bulk-disable',
      method: 'POST',
      token: ctx.adminToken,
      body: { user_ids: [] },
    });
    assert.status(response, 400);
  });

  await test('ADMIN_GET_ANNOUNCEMENTS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/announcements',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_ANNOUNCEMENTS']['RESPONSE']>(
        response
      );
    assert.equals(Array.isArray(data), true, 'should be an array');
    if (data.length > 0) {
      assert.hasProperty(data[0] as unknown as Record<string, unknown>, 'id');
      assert.hasProperty(
        data[0] as unknown as Record<string, unknown>,
        'title'
      );
      assert.hasProperty(data[0] as unknown as Record<string, unknown>, 'type');
    }
  });

  await test('ANNOUNCEMENTS_GET_ACTIVE_PUBLIC', async () => {
    // Public endpoint -- no auth required
    const response = await apiCall({
      endpoint: '/api/v1/announcements/active',
      method: 'GET',
    });
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['ANNOUNCEMENTS_GET_ACTIVE']['RESPONSE']>(
        response
      );
    assert.equals(Array.isArray(data), true, 'should be an array');
    if (data.length > 0) {
      assert.hasProperty(data[0] as unknown as Record<string, unknown>, 'id');
      assert.hasProperty(
        data[0] as unknown as Record<string, unknown>,
        'title'
      );
      assert.hasProperty(
        data[0] as unknown as Record<string, unknown>,
        'message'
      );
    }
  });

  await test('ADMIN_ANNOUNCEMENTS_FULL_CRUD', async () => {
    // Create
    const createResponse = await apiCall({
      endpoint: '/api/v1/admin/announcements/create',
      method: 'POST',
      token: ctx.adminToken,
      body: {
        title: 'Test Announcement',
        message: 'This is a test message from smoke tests',
        type: 'info',
        is_active: false, // Not active to avoid polluting live system
      } satisfies ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['REQUEST'],
    });
    assert.status(createResponse, 201);
    const createData =
      getData<ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['RESPONSE']>(
        createResponse
      );
    assert.hasProperty(createData as unknown as Record<string, unknown>, 'id');
    assert.equals(
      typeof createData.id,
      'string',
      'announcement id should be string'
    );
    const announcementId = createData.id;

    try {
      // Update
      const updateResponse = await apiCall({
        endpoint: '/api/v1/admin/announcements/update',
        method: 'POST',
        token: ctx.adminToken,
        body: {
          id: announcementId,
          title: 'Updated Title',
        } satisfies ADMIN_DTO_API_V1['ADMIN_UPDATE_ANNOUNCEMENT']['REQUEST'],
      });
      assert.status(updateResponse, 200);

      // Verify in list
      const listResponse = await apiCall({
        endpoint: '/api/v1/admin/announcements',
        method: 'GET',
        token: ctx.adminToken,
      });
      assert.status(listResponse, 200);
      const announcements =
        getData<ADMIN_DTO_API_V1['ADMIN_GET_ANNOUNCEMENTS']['RESPONSE']>(
          listResponse
        );
      const found = announcements.find(
        (a: { id: string }) => a.id === announcementId
      );
      if (!found) throw new Error('Created announcement not found in list');
    } finally {
      // Cleanup: delete
      await apiCall({
        endpoint: '/api/v1/admin/announcements/delete',
        method: 'POST',
        token: ctx.adminToken,
        body: { id: announcementId },
      });
    }
  });

  await test('ADMIN_ANNOUNCEMENT_VALIDATION_NEGATIVE', async () => {
    // Missing required field
    const response = await apiCall({
      endpoint: '/api/v1/admin/announcements/create',
      method: 'POST',
      token: ctx.adminToken,
      body: { title: 'Test' }, // Missing message, type, is_active
    });
    assert.status(response, 400);
  });

  await test('ADMIN_GET_REPORTS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/reports?period=week',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_REPORTS']['RESPONSE']>(response);
    assert.hasProperty(data as unknown as Record<string, unknown>, 'period');
    assert.hasProperty(data as unknown as Record<string, unknown>, 'funnel');
    assert.hasProperty(data as unknown as Record<string, unknown>, 'retention');
    assert.equals(typeof data.period, 'string', 'period should be string');
    assert.hasProperty(
      data as unknown as Record<string, unknown>,
      'period_start'
    );
    assert.hasProperty(
      data as unknown as Record<string, unknown>,
      'period_end'
    );
  });

  await test('ADMIN_GET_REPORTS_VALIDATION_NEGATIVE', async () => {
    // Invalid period — backend defaults to 'month' if invalid, returns 200
    const response = await apiCall({
      endpoint: '/api/v1/admin/reports?period=invalid',
      method: 'GET',
      token: ctx.adminToken,
    });
    // Backend silently defaults invalid period to 'month' (see parseQueryParams)
    assert.status(response, 200);
  });

  await test('ADMIN_GET_USER_TIMELINE', async () => {
    // Use test stylist user_id
    const sessionResponse = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: ctx.stylistToken,
    });
    const session =
      getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(sessionResponse);
    if (!session?.id) throw new Error('Failed to get user session');
    const userId = session.id;

    const response = await apiCall({
      endpoint: `/api/v1/admin/user-timeline?user_id=${userId}`,
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['RESPONSE']>(
        response
      );
    assert.hasProperty(data as unknown as Record<string, unknown>, 'entries');
    assert.hasProperty(data as unknown as Record<string, unknown>, 'total');
    assert.equals(
      Array.isArray(data.entries),
      true,
      'entries should be an array'
    );
    assert.equals(typeof data.total, 'number', 'total should be number');
    if (data.entries.length > 0) {
      assert.hasProperty(
        data.entries[0] as unknown as Record<string, unknown>,
        'id'
      );
      assert.hasProperty(
        data.entries[0] as unknown as Record<string, unknown>,
        'event_name'
      );
      assert.hasProperty(
        data.entries[0] as unknown as Record<string, unknown>,
        'created_at'
      );
    }
  });

  await test('ADMIN_GET_USER_TIMELINE_VALIDATION_NEGATIVE', async () => {
    // Missing required user_id — backend sends empty user_id to operation which returns error
    const response = await apiCall({
      endpoint: '/api/v1/admin/user-timeline',
      method: 'GET',
      token: ctx.adminToken,
    });
    // Backend parseQueryParams defaults to user_id='' — operation rejects with 400 or 404
    if (response.status !== 400 && response.status !== 404) {
      throw new Error(
        `Expected 400/404 for missing user_id, got ${response.status}`
      );
    }
  });

  await test('ADMIN_GET_CONFIGS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/config',
      method: 'GET',
      token: ctx.adminToken,
    });
    assert.status(response, 200);
    const data =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_CONFIGS']['RESPONSE']>(response);
    assert.hasProperty(data as unknown as Record<string, unknown>, 'configs');
    assert.equals(
      Array.isArray(data.configs),
      true,
      'configs should be an array'
    );
    if (data.configs.length > 0) {
      assert.hasProperty(
        data.configs[0] as unknown as Record<string, unknown>,
        'key'
      );
      assert.hasProperty(
        data.configs[0] as unknown as Record<string, unknown>,
        'value'
      );
      assert.hasProperty(
        data.configs[0] as unknown as Record<string, unknown>,
        'value_type'
      );
    }
  });

  await test('ADMIN_UPDATE_CONFIG', async () => {
    // Note: We can't safely test real config updates (no cleanup/restore).
    // This test verifies endpoint exists and validation works.
    const response = await apiCall({
      endpoint: '/api/v1/admin/config/update',
      method: 'POST',
      token: ctx.adminToken,
      body: { key: 'nonexistent_test_config', value: 'test_value' },
    });
    // Accept 200 (success) or 404 (config not found) or 400 (validation)
    if (
      response.status !== 200 &&
      response.status !== 404 &&
      response.status !== 400
    ) {
      throw new Error(`Expected 200/404/400, got ${response.status}`);
    }
  });

  await test('ADMIN_UPDATE_CONFIG_VALIDATION_NEGATIVE', async () => {
    // Missing required field
    const response = await apiCall({
      endpoint: '/api/v1/admin/config/update',
      method: 'POST',
      token: ctx.adminToken,
      body: { key: 'test' }, // Missing value
    });
    assert.status(response, 400);
  });
}
