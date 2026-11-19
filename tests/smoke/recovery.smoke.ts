/**
 * Account Recovery smoke tests
 *
 * Covers: USER_CHECK_RECOVERY
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

export async function runRecoveryTests(): Promise<void> {
  await test('USER_CHECK_RECOVERY', async () => {
    // Check recovery for a non-existent email -- endpoint returns 200 with recovery_available: false
    // DECISION: anti-enumeration (DOMAIN_SSOT §13.1): a uniform 200 regardless of whether the
    // email belongs to an existing, soft-deleted or non-existent account, so attackers cannot infer
    // account existence or deletion state by probing status codes.
    const response = await apiCall({
      endpoint: '/api/v1/user/check-recovery',
      method: 'POST',
      body: { email: `nonexistent-recovery-${Date.now()}@example.com` },
    });
    assert.status(response, 200);
    const recoveryData =
      getData<USER_DTO_API_V1['USER_CHECK_RECOVERY']['RESPONSE']>(response);
    assert.equals(
      recoveryData.recovery_available,
      false,
      'Non-existent email should have no recovery'
    );
  });
}
