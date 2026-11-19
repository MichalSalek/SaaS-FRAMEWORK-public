/**
 * User Lifecycle smoke tests
 *
 * Covers: USER_REGISTER_STYLIST_AND_DELETE_SELF, USER_REGISTER_CLIENT_AND_ADMIN_DELETE
 */

import {
  test,
  apiCall,
  getData,
  getEvent,
  assert,
  extractSessionToken,
} from './_test-utils';
import type { TestContext } from './_test-utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

export async function runLifecycleTests(ctx: TestContext): Promise<void> {
  console.log('\n\uD83D\uDC64 USER LIFECYCLE\n');

  await test('USER_REGISTER_STYLIST_AND_DELETE_SELF', async () => {
    const email = `test-lifecycle-stylist-${Date.now()}@example.com`;

    const registerResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email },
    });
    assert.status(registerResponse, 200);

    const registerData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(registerResponse);
    assert.hasProperty(registerData, 'session');
    const newToken = extractSessionToken(registerResponse);
    assert.equals(typeof newToken, 'string', 'sessionToken should be string');

    // Switch to STYLIST role
    const switchResponse = await apiCall({
      endpoint: '/api/v1/user/switch-role',
      method: 'POST',
      token: newToken,
      body: { account_type: AccountTypeValue.STYLIST },
    });
    assert.status(switchResponse, 200);
    const switchData =
      getData<USER_DTO_API_V1['USER_SWITCH_ROLE']['RESPONSE']>(switchResponse);
    assert.equals(switchData.success, true, 'switch role should succeed');
    assert.equals(
      switchData.account_type,
      AccountTypeValue.STYLIST,
      'should switch to STYLIST'
    );

    // Verify stylist account created
    const verifyResponse = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: newToken,
    });
    const verifyData =
      getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(verifyResponse);
    if (!verifyData) throw new Error('Missing session data after switch');
    assert.equals(verifyData.account_type, AccountTypeValue.STYLIST);

    // User requests self-deletion (sends confirm email, no immediate delete)
    const deleteResponse = await apiCall({
      endpoint: '/api/v1/user/delete/self',
      method: 'POST',
      token: newToken,
      body: {},
    });
    assert.status(deleteResponse, 200);
    assert.equals(
      getEvent(deleteResponse),
      APP_EVENTS.INFO.USER.USER_DELETE_REQUESTED,
      'delete-self responds with USER_DELETE_REQUESTED — confirmation flow via email'
    );

    // User is NOT yet deleted — session still valid until token-based confirm
    // (full delete flow tested separately in restore.smoke.ts via admin delete)
  });

  await test('USER_REGISTER_CLIENT_AND_ADMIN_DELETE', async () => {
    const email = `test-lifecycle-client-${Date.now()}@example.com`;

    const registerResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email },
    });
    assert.status(registerResponse, 200);

    const registerData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(registerResponse);
    assert.hasProperty(registerData, 'session');
    assert.equals(typeof registerData.id, 'string', 'id should be string');
    const newToken = extractSessionToken(registerResponse);
    const newUserId = registerData.id;

    // Switch to CLIENT role
    const switchResponse = await apiCall({
      endpoint: '/api/v1/user/switch-role',
      method: 'POST',
      token: newToken,
      body: { account_type: AccountTypeValue.CLIENT },
    });
    assert.status(switchResponse, 200);
    const switchData =
      getData<USER_DTO_API_V1['USER_SWITCH_ROLE']['RESPONSE']>(switchResponse);
    assert.equals(switchData.success, true, 'switch role should succeed');
    assert.equals(
      switchData.account_type,
      AccountTypeValue.CLIENT,
      'should switch to CLIENT'
    );

    // Verify client account created
    const verifyResponse = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: newToken,
    });
    const verifyData =
      getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(verifyResponse);
    if (!verifyData) throw new Error('Missing session data after switch');
    assert.equals(verifyData.account_type, AccountTypeValue.CLIENT);

    // Admin deletes user
    const deleteResponse = await apiCall({
      endpoint: '/api/v1/admin/user/delete/any',
      method: 'POST',
      token: ctx.adminToken,
      body: { id: newUserId },
    });
    assert.status(deleteResponse, 200);

    // Verify user is deleted from DB
    // Try to get user info - should fail because user doesn't exist
    const checkDeletedResponse = await apiCall({
      endpoint: '/api/v1/user/usage-stats',
      token: newToken,
    });
    // Should fail with user not found or similar error
    assert.equals(
      checkDeletedResponse.status !== 200,
      true,
      'User should be deleted from DB'
    );
  });
}
