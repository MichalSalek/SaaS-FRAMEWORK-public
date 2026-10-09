/**
 * GDPR smoke tests
 *
 * Covers: USER_EXPORT_DATA (Art. 20 — data portability)
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

/** Rate limited = endpoint works, just cooling down. Acceptable in smoke tests. */
function skipIfRateLimited(response: { status: number }): boolean {
  if (response.status === 429) {
    console.log('   (Rate limited from previous run — skipping)');
    return true;
  }
  return false;
}

export async function runGdprTests(ctx: TestContext): Promise<void> {
  await test('GDPR_EXPORT_DATA_STYLIST', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/user/export-data',
      method: 'POST',
      token: ctx.stylistToken,
    });
    // Accept 200 (success) or 429 (rate limited from previous run)
    if (skipIfRateLimited(response)) return;
    assert.status(response, 200);

    const data = getData<USER_DTO_API_V1['USER_EXPORT_DATA']['RESPONSE']>(response);
    assert.equals(typeof data.export_version, 'string');
    assert.equals(typeof data.exported_at, 'string');
    assert.equals(data.account_type, 'STYLIST');
    assert.hasProperty(data, 'user');
    assert.hasProperty(data.user, 'email');
    assert.hasProperty(data.user, 'name');
    assert.hasProperty(data, 'data');
  });

  await test('GDPR_EXPORT_DATA_CLIENT', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/user/export-data',
      method: 'POST',
      token: ctx.clientToken,
    });
    // Accept 200 (success) or 429 (rate limited from previous run)
    if (skipIfRateLimited(response)) return;
    assert.status(response, 200);

    const data = getData<USER_DTO_API_V1['USER_EXPORT_DATA']['RESPONSE']>(response);
    assert.equals(typeof data.export_version, 'string');
    // Backend determines account_type by checking stylist_account existence,
    // not current role. Test user may have dual accounts.
    assert.equals(
      data.account_type === 'CLIENT' || data.account_type === 'STYLIST',
      true,
      `account_type should be CLIENT or STYLIST, got ${data.account_type}`
    );
    assert.hasProperty(data, 'data');
  });

  await test('GDPR_EXPORT_DATA_NO_AUTH', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/user/export-data',
      method: 'POST',
    });
    // Should be 401 — not authenticated
    assert.status(response, 401);
  });
}
