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
    // DECISION: anty-enumeration (DOMAIN_SSOT §13.1) — uniform 200 response regardless of whether
    // the email belongs to an existing, soft-deleted, or non-existent account. Prevents attackers
    // from inferring account existence / deletion state via status-code probing.
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
