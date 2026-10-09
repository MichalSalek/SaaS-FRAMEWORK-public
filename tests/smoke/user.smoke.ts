/**
 * User domain smoke tests
 *
 * Covers: USER_USAGE_STATS, USER_SWITCH_ROLE, USER_CHANGE_NAME,
 *         USER_ONBOARD_IDEMPOTENT, USER_GET_ACCOUNT_STATE
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';

export async function runUserTests(ctx: TestContext): Promise<void> {
  await test('USER_USAGE_STATS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/user/usage-stats',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);

    const data =
      getData<USER_DTO_API_V1['USER_GET_USAGE_STATS']['RESPONSE']>(response);
    assert.equals(typeof data.pricing_plan, 'string');
    assert.hasProperty(data, 'limits');
    assert.equals(typeof data.limits.max_gallery_records, 'number');
    assert.equals(
      data.gallery_records <= data.limits.max_gallery_records ||
        data.limits.max_gallery_records === -1,
      true
    );
  });

  await test('USER_SWITCH_ROLE', async () => {
    // Get current role
    const sessionResponse = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: ctx.stylistToken,
    });
    const currentData =
      getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(sessionResponse);
    const currentAccountType = currentData?.account_type;
    const targetAccountType =
      currentAccountType === AccountTypeValue.STYLIST
        ? AccountTypeValue.CLIENT
        : AccountTypeValue.STYLIST;

    // Switch role
    const requestBody: USER_DTO_API_V1['USER_SWITCH_ROLE']['REQUEST'] = {
      account_type: targetAccountType,
    };

    const switchResponse = await apiCall({
      endpoint: '/api/v1/user/switch-role',
      method: 'POST',
      token: ctx.stylistToken,
      body: requestBody,
    });
    assert.status(switchResponse, 200);
    const switchData =
      getData<USER_DTO_API_V1['USER_SWITCH_ROLE']['RESPONSE']>(switchResponse);
    assert.equals(switchData.success, true, 'switch role should succeed');
    assert.equals(
      switchData.account_type,
      targetAccountType,
      'account_type should match target'
    );

    // Verify account type changed
    const verifiedResponse = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: ctx.stylistToken,
    });
    const verifiedData =
      getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(verifiedResponse);
    assert.equals(verifiedData?.account_type, targetAccountType);

    // Switch back
    await apiCall({
      endpoint: '/api/v1/user/switch-role',
      method: 'POST',
      token: ctx.stylistToken,
      body: { account_type: currentAccountType },
    });
  });

  await test('USER_CHANGE_NAME', async () => {
    // Save original name for rollback
    const beforeSession = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: ctx.stylistToken,
    });
    const originalName =
      getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(
        beforeSession
      )?.name;

    const newName = `Smoke Test ${Date.now()}`;
    const requestBody: USER_DTO_API_V1['USER_CHANGE_NAME']['REQUEST'] = {
      name: newName,
    };

    try {
      const response = await apiCall({
        endpoint: '/api/v1/user/change-name',
        method: 'POST',
        token: ctx.stylistToken,
        body: requestBody,
      });
      assert.status(response, 200);
      const changeNameData =
        getData<USER_DTO_API_V1['USER_CHANGE_NAME']['RESPONSE']>(response);
      assert.hasProperty(
        changeNameData as unknown as Record<string, unknown>,
        'id'
      );
      assert.equals(
        changeNameData.name,
        newName,
        'name in response should match'
      );

      const sessionResponse = await apiCall({
        endpoint: '/api/v1/session/get-current',
        token: ctx.stylistToken,
      });
      assert.status(sessionResponse, 200);

      const data =
        getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(sessionResponse);
      if (!data) {
        throw new Error('Missing session data');
      }
      assert.equals(data.name, newName, 'Name not updated in session');
    } finally {
      // Rollback to original name
      if (originalName) {
        await apiCall({
          endpoint: '/api/v1/user/change-name',
          method: 'POST',
          token: ctx.stylistToken,
          body: { name: originalName },
        });
      }
    }
  });

  await test('USER_ONBOARD_IDEMPOTENT', async () => {
    // Onboarding is idempotent — returns 200 if already onboarded
    const stylistResponse = await apiCall({
      endpoint: '/api/v1/user/onboard-stylist',
      method: 'POST',
      token: ctx.clientToken,
      body: {
        display_name: 'Smoke Test Stylist',
        address_city: 'Warsaw',
      } satisfies USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['REQUEST'],
    });
    // 200 = already onboarded, 201 = newly created
    if (stylistResponse.status !== 200 && stylistResponse.status !== 201) {
      throw new Error(`Expected 200/201, got ${stylistResponse.status}`);
    }
    const stylistData =
      getData<USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['RESPONSE']>(
        stylistResponse
      );
    assert.hasProperty(
      stylistData as unknown as Record<string, unknown>,
      'stylist_account_id'
    );
    assert.equals(
      typeof stylistData.stylist_account_id,
      'string',
      'stylist_account_id should be string'
    );

    const clientResponse = await apiCall({
      endpoint: '/api/v1/user/onboard-client',
      method: 'POST',
      token: ctx.stylistToken,
      body: {} satisfies USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['REQUEST'],
    });
    if (clientResponse.status !== 200 && clientResponse.status !== 201) {
      throw new Error(`Expected 200/201, got ${clientResponse.status}`);
    }
    const clientData =
      getData<USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['RESPONSE']>(clientResponse);
    assert.hasProperty(
      clientData as unknown as Record<string, unknown>,
      'client_account_id'
    );
    assert.equals(
      typeof clientData.client_account_id,
      'string',
      'client_account_id should be string'
    );

    // Restore canonical roles — onboarding may switch account_type
    await apiCall({
      endpoint: '/api/v1/user/switch-role',
      method: 'POST',
      token: ctx.stylistToken,
      body: { account_type: AccountTypeValue.STYLIST },
    });
    await apiCall({
      endpoint: '/api/v1/user/switch-role',
      method: 'POST',
      token: ctx.clientToken,
      body: { account_type: AccountTypeValue.CLIENT },
    });
  });

  await test('USER_GET_ACCOUNT_STATE', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/user/account-state',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);

    const data =
      getData<USER_DTO_API_V1['USER_GET_ACCOUNT_STATE']['RESPONSE']>(response);
    assert.equals(typeof data.role_id, 'string');
    assert.equals(typeof data.has_stylist_account, 'boolean');
    assert.equals(typeof data.has_client_account, 'boolean');
  });
}
