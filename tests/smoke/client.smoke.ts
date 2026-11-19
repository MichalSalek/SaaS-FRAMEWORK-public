/**
 * Client domain smoke tests
 *
 * Covers: CLIENT_UPDATE_CONTACT, CLIENT_GET_PROFILE
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { CLIENT_DTO_API_V1 } from '@kernel/models/client/client.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';

export async function runClientTests(ctx: TestContext): Promise<void> {
  await test('CLIENT_UPDATE_CONTACT', async () => {
    // Save original contact for rollback
    const beforeProfile = await apiCall({
      endpoint: '/api/v1/client/profile',
      method: 'POST',
      token: ctx.clientToken,
      body: {},
    });
    const originalContact =
      beforeProfile.status === 200
        ? getData<CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE']>(
            beforeProfile
          )
        : null;

    const requestBody: CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST'] = {
      contact_phone: '+48123456789',
      contact_email: 'smoke-test-client@example.com',
    };

    try {
      const response = await apiCall({
        endpoint: '/api/v1/client/update-contact',
        method: 'POST',
        token: ctx.clientToken,
        body: requestBody,
      });
      assert.status(response, 200);

      const data = getData<Record<string, unknown>>(response);
      assert.equals(
        typeof data,
        'object',
        'update-contact response should be an object'
      );
    } finally {
      // Rollback to original contact data
      if (originalContact) {
        const rollback: CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST'] =
          {
            contact_phone: originalContact.contact_phone,
            contact_email: originalContact.contact_email,
          };
        await apiCall({
          endpoint: '/api/v1/client/update-contact',
          method: 'POST',
          token: ctx.clientToken,
          body: rollback,
        });
      }
    }
  });

  await test('CLIENT_GET_PROFILE', async () => {
    // Switch to client role first
    await apiCall({
      endpoint: '/api/v1/user/switch-role',
      method: 'POST',
      token: ctx.clientToken,
      body: { account_type: AccountTypeValue.CLIENT },
    });

    const response = await apiCall({
      endpoint: '/api/v1/client/profile',
      method: 'GET',
      token: ctx.clientToken,
    });
    assert.status(response, 200);

    const data =
      getData<CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE']>(response);

    // Verify structure (fields can be null)
    assert.equals(
      typeof data.contact_phone === 'string' || data.contact_phone === null,
      true,
      'contact_phone should be string or null'
    );
    assert.equals(
      typeof data.contact_email === 'string' || data.contact_email === null,
      true,
      'contact_email should be string or null'
    );
    assert.equals(
      typeof data.created_at,
      'string',
      'created_at should be string'
    );

    // Verify created_at is valid date
    const createdDate = new Date(data.created_at);
    assert.equals(
      isNaN(createdDate.getTime()),
      false,
      'created_at should be valid date'
    );
  });
}
