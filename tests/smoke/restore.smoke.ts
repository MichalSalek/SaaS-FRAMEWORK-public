/**
 * Account Restore smoke tests
 *
 * Covers: USER_RESTORE_ACCOUNT is NON-restorable after a TERMINAL admin hard-delete.
 * Admin/self hard-delete sets is_gdpr_erased=true in the same tx
 * as user.delete, and loadRecentRecoverableBackups filters is_gdpr_erased:{not:true}, so the
 * archive row exists but the account can NEVER be restored via /restore-account.
 * (Recoverable 0-90d recovery is a DIFFERENT path: soft-delete + reactivate in-place, no JSON.)
 */

import {
  test,
  apiCall,
  getData,
  getEvent,
  assert,
  getAdminToken,
  extractSessionToken,
} from './_test-utils';
import type { TestContext } from './_test-utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

export async function runRestoreTests(_ctx: TestContext): Promise<void> {
  await test('USER_RESTORE_ACCOUNT', async () => {
    const restoreEmail = `temp-restore-${Date.now()}@example.com`;
    // Fresh admin token for this test (previous tests may have affected session state)
    const freshAdminToken = await getAdminToken();

    // 1. Create temp user
    const createResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: restoreEmail },
    });
    assert.status(createResponse, 200);
    const createData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(createResponse);
    const tempToken = extractSessionToken(createResponse);
    const tempUserId = createData.id;

    // 2. Onboard as stylist (so there's a StylistAccount to restore)
    const onboardResponse = await apiCall({
      endpoint: '/api/v1/user/onboard-stylist',
      method: 'POST',
      token: tempToken,
      body: {
        display_name: 'Restore Test Stylist',
        address_city: 'Warsaw',
      } satisfies USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['REQUEST'],
    });
    if (onboardResponse.status !== 200 && onboardResponse.status !== 201) {
      throw new Error(`Onboard failed: ${onboardResponse.status}`);
    }

    // 3. Admin deletes user (creates backup in DeletedUser)
    const deleteResponse = await apiCall({
      endpoint: '/api/v1/admin/user/delete/any',
      method: 'POST',
      token: freshAdminToken,
      body: { id: tempUserId },
    });
    assert.status(deleteResponse, 200);

    // 4. Re-login with same email (creates new User record via dev-login)
    const reLoginResponse = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: { email: restoreEmail },
    });
    assert.status(reLoginResponse, 200);
    const reLoginData =
      getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(reLoginResponse);
    const newToken = extractSessionToken(reLoginResponse);
    const newUserId = reLoginData.id;

    try {
      // 5. Restore MUST be REJECTED — admin hard-delete is TERMINAL (is_gdpr_erased=true), so the
      // archive is non-restorable by design. /restore-account finds no recoverable backup.
      const restoreResponse = await apiCall({
        endpoint: '/api/v1/user/restore-account',
        method: 'POST',
        token: newToken,
        body: {},
      });
      assert.equals(
        getEvent(restoreResponse),
        'RECOVERY_NOT_FOUND',
        'Terminal admin hard-delete must be non-restorable'
      );
    } finally {
      // Cleanup: delete restored user
      const cleanupToken = await getAdminToken();
      await apiCall({
        endpoint: '/api/v1/admin/user/delete/any',
        method: 'POST',
        token: cleanupToken,
        body: { id: newUserId },
      });
    }
  });
}
