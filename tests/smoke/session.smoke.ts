/**
 * Session domain smoke tests
 *
 * Covers: SESSION_DELETE_ALL, SESSION_DELETE_EXACTLY, SESSION_GET_ALL,
 *         USER_DISABLE_SELF
 */

import {
  test,
  apiCall,
  getData,
  assert,
  extractSessionToken,
} from './_test-utils';
import type { TestContext } from './_test-utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';

export async function runSessionTests(ctx: TestContext): Promise<void> {
  await test('SESSION_DELETE_ALL', async () => {
    // Create temp token for destructive test
    const tempEmail = `temp-logout-${Date.now()}@example.com`;
    const loginBody: USER_DTO_API_V1['DEV_LOGIN']['REQUEST'] = {
      email: tempEmail,
    };

    const loginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: loginBody,
    });
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginResponse);
    const tempToken = extractSessionToken(loginResponse);
    const tempUserId = loginData.id;

    try {
      // Verify login succeeded
      assert.status(loginResponse, 200);

      // Verify token works before deletion
      const beforeResponse = await apiCall({
        endpoint: '/api/v1/session/get-current',
        token: tempToken,
      });
      assert.status(beforeResponse, 200);
      const beforeData =
        getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(beforeResponse);
      assert.equals(!!beforeData?.id, true);

      // Delete all sessions
      const response = await apiCall({
        endpoint: '/api/v1/session/delete/all',
        method: 'POST',
        token: tempToken,
        body: {},
      });
      assert.status(response, 200);

      // Verify session no longer exists
      // Note: SESSION_GET_CURRENT is in BASE_PERMISSIONS (accessible without auth)
      // When no valid session, backend returns {event: "SUCCESS"} without data key
      const afterResponse = await apiCall({
        endpoint: '/api/v1/session/get-current',
        token: tempToken,
      });
      assert.status(afterResponse, 200);
      const afterBody = afterResponse.body as {
        event?: string;
        data?: unknown;
      };
      assert.equals(
        !afterBody?.data || !(afterBody.data as Record<string, unknown>)?.id,
        true,
        'Session should be empty after delete-all'
      );
    } finally {
      // Cleanup: delete the temp user to prevent orphaned users
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: ctx.adminToken,
        body: { id: tempUserId },
      });
    }
  });

  await test('SESSION_DELETE_EXACTLY', async () => {
    // Create a temp user with a known session token
    const tempEmail = `temp-session-${Date.now()}@example.com`;
    const loginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginResponse, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginResponse);
    const tempToken = extractSessionToken(loginResponse);
    const tempSessionId = loginData.session.id;
    const tempUserId = loginData.id;

    try {
      // Delete exactly this session (identifier = Session.id, never token).
      const requestBody: SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['REQUEST'] = {
        id: tempSessionId,
      };
      const deleteResponse = await apiCall({
        endpoint: '/api/v1/session/delete/exactly',
        method: 'POST',
        token: tempToken,
        body: requestBody,
      });
      assert.status(deleteResponse, 200);

      // Verify token no longer works for protected endpoints
      const checkResponse = await apiCall({
        endpoint: '/api/v1/user/usage-stats',
        token: tempToken,
      });
      assert.equals(
        checkResponse.status !== 200,
        true,
        'Session should be invalidated'
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

  await test('SESSION_GET_ALL', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/session/get-all',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);

    const data = getData<SESSION_DTO_API_V1['SESSION_GET_ALL']['RESPONSE']>(response);
    const sessions = data?.sessions;
    assert.equals(
      Array.isArray(sessions),
      true,
      'Should return sessions array'
    );
    if (Array.isArray(sessions) && sessions.length > 0) {
      // Backend strips token + userId from response for security; adds is_current.
      const row = sessions[0] as Record<string, unknown>;
      assert.hasProperty(row, 'expires', 'Session should have expires');
      assert.hasProperty(row, 'id', 'Session should have id');
      assert.hasProperty(
        row,
        'is_current',
        'Session should have is_current flag'
      );
      assert.equals(
        'token' in row,
        false,
        'Session token must not leak in response'
      );
      assert.equals(
        'userId' in row,
        false,
        'Session userId must not leak in response'
      );
    }
  });

  await test('USER_DISABLE_SELF', async () => {
    // Create temp user for destructive test
    const tempEmail = `temp-disable-${Date.now()}@example.com`;
    const loginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: tempEmail },
    });
    assert.status(loginResponse, 200);
    const loginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginResponse);
    const tempToken = extractSessionToken(loginResponse);
    const tempUserId = loginData.id;

    try {
      // Disable self
      const disableResponse = await apiCall({
        endpoint: '/api/v1/user/disable/self',
        method: 'POST',
        token: tempToken,
        body: {},
      });
      assert.status(disableResponse, 200);
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
}
