// tests/e2e/helpers/cleanup.ts
//
// Cleanup helpers — invoked in `afterEach` (or `finally` blocks) to leave the
// dev DB in the same shape as before each test. We never delete the seeded
// test users themselves (they are auto-re-seeded on backend start) but we DO
// wipe transient state they accumulated during the test.
//
// PHILOSOPHY: best-effort, never throw. Cleanup is a courtesy — a failed
// cleanup should not mask the actual test failure. We log warnings but
// swallow errors so the test runner's report stays focused on the real
// assertion.

import { ROUTES_API } from '../../../.shared-kernel/domain/routing/routing.config';
import { apiCall } from './api';

/**
 * Delete every gallery record owned by the bearer-token holder.
 *
 * Used by stylist-flow tests that upload photos. The FREE plan caps at 5
 * gallery records; if cleanup is skipped, the second run hits a quota error
 * before the test even begins.
 */
export async function cleanupGalleryForToken(token: string): Promise<void> {
  try {
    const list = await apiCall<{
      data?: {
        records?: Array<{ gallery_record_id: string }>;
      };
    }>(ROUTES_API.GET_GALLERY_RECORDS, { token });

    const records = list.body?.data?.records ?? [];
    for (const rec of records) {
      await apiCall(ROUTES_API.DELETE_GALLERY_RECORD, {
        method: 'POST',
        token,
        body: { gallery_record_id: rec.gallery_record_id },
      }).catch(() => undefined);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[e2e:cleanup] gallery cleanup failed:', err);
  }
}

/**
 * Revoke every active pairing (stylist ↔ client) for the bearer-token holder.
 *
 * FREE plan caps at 2 paired clients. Same hazard as gallery cleanup — second
 * run hits the limit and aborts.
 */
export async function cleanupPairingsForToken(token: string): Promise<void> {
  try {
    // Issued-but-unclaimed pairing SESSIONS count against the active-session
    // cap (TOO_MANY_ACTIVE_SESSIONS at 5) and are NOT covered by the pair
    // revoke below — without this, repeated suite runs exhaust the cap and
    // issue-session starts returning 429 (bit us 2026-07-16).
    await apiCall(ROUTES_API.PAIRING_SESSION_REVOKE_ALL, {
      method: 'POST',
      token,
    }).catch(() => undefined);

    const list = await apiCall<{
      data?: {
        pairs?: Array<{ user_id: string }>;
      };
    }>(ROUTES_API.PAIRING_GET_MY_PAIRS, { token });

    const pairs = list.body?.data?.pairs ?? [];
    for (const pair of pairs) {
      await apiCall(ROUTES_API.PAIRING_ACCESS_REVOKE, {
        method: 'POST',
        token,
        body: { target_user_id: pair.user_id },
      }).catch(() => undefined);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[e2e:cleanup] pairing cleanup failed:', err);
  }
}

/**
 * Best-effort logout — invalidate all sessions for the bearer-token holder so
 * a freshly impersonated state from a previous test does not leak.
 */
export async function logoutAllSessions(token: string): Promise<void> {
  try {
    await apiCall(ROUTES_API.SESSION_DELETE_ALL, {
      method: 'POST',
      token,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[e2e:cleanup] session purge failed:', err);
  }
}
