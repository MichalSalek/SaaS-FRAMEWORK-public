/**
 * Integration-handler test — POST pairing/claim-session (characterization).
 *
 * BDX W0.3 (część A): pins the CURRENT HTTP contract of the pairing claim handler
 * (token-validate + state-machine) BEFORE the FAZA 2 standardization. Drives the
 * real Next.js handler through the production middleware with only DB / auth /
 * permission / run-after-response mocked (setup.ts).
 *
 * The claim runs entirely inside a SERIALIZABLE $transaction — the setup proxy
 * invokes the callback with the same mocked DB map as `tx`, so we stub the
 * tx.<model>.<method> calls directly (no special transaction handling needed).
 *
 * Cases (gate = positive + negative):
 *   1. Happy path (valid token, unclaimed/unexpired, active stylist, under caps)
 *      → 200 + PAIRING_SESSION_CLAIMED + stylist_account_id.
 *   2a. Unknown token (findUnique → null) → 400 INVALID_PAIRING_TOKEN.
 *   2b. Expired token (expires_at in the past) → 400 PAIRING_TOKEN_EXPIRED.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/pairing/claim-session/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';

const STYLIST_ACCOUNT_ID = 'acc_stylist_pair_000000001';
const STYLIST_OWNER_USER_ID = 'usr_stylist_owner_00000001';
const VALID_TOKEN = 'tok_pairing_valid_00000000000001';

describe('POST /api/v1/pairing/claim-session (handler integration)', () => {
  beforeEach(() => {
    // Authenticated CLIENT scanning a stylist's QR + permission granted.
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    __setPermission(true);
  });

  it('claims a valid pairing session → 200 + PAIRING_SESSION_CLAIMED', async () => {
    const futureExpiry = new Date(Date.now() + 1000 * 60 * 10); // +10 min

    mockDb({
      pairingSession: {
        // Step 1: find the session by token — valid, unclaimed, unexpired, unrevoked.
        findUnique: async () => ({
          id: 'psess_test_1',
          stylist_account_id: STYLIST_ACCOUNT_ID,
          claimed_by_client_user_id: null,
          expires_at: futureExpiry,
          revoked_at: null,
        }),
        // Step 3: atomic single-use claim — count 1 = we won the race.
        updateMany: async () => ({ count: 1 }),
      },
      clientStylistPair: {
        // Step 2.1: no existing active pair → run the platform-cap pre-check path.
        findFirst: async () => null,
        // Step 2.1 client-cap count + step 4.1 post-upsert verify count (both 0/1 → under cap).
        count: async () => 0,
        // Step 4: idempotent grant upsert.
        upsert: async () => ({
          stylist_account_id: STYLIST_ACCOUNT_ID,
          paired_at: new Date('2026-01-01T00:00:00.000Z'),
        }),
      },
      stylistAccount: {
        // Step 2.2: stylist still ACTIVE, not self-owned, under plan cap.
        findUnique: async () => ({
          pricing_plan: 'PRO',
          created_by_user_id: STYLIST_OWNER_USER_ID,
          display_name: 'Test Salon',
          account_status: AccountStatusValue.ACTIVE,
        }),
      },
      user: {
        // Step 5: resolve stylist user details for the success payload.
        findUnique: async () => ({
          email: 'stylist@test.local',
          name: 'Test Stylist',
        }),
      },
    });

    const { status, event, data } = await mockApiHandler<{
      success: boolean;
      stylist_account_id: string;
    }>(handler, {
      method: 'POST',
      body: { token: VALID_TOKEN },
    });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED);
    expect(data.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
  });

  it('NEGATIVE — unknown token → 400 INVALID_PAIRING_TOKEN', async () => {
    mockDb({
      pairingSession: {
        // Step 1 returns null → PAIRING_CODE_INVALID/NOT_FOUND.
        findUnique: async () => null,
      },
    });

    const { status, event, data } = await mockApiHandler<{
      reason: string;
    }>(handler, {
      method: 'POST',
      body: { token: VALID_TOKEN },
    });

    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.PAIRING.INVALID_PAIRING_TOKEN);
    expect(data.reason).toBe('NOT_FOUND');
  });

  it('NEGATIVE — expired token → 400 PAIRING_TOKEN_EXPIRED', async () => {
    const pastExpiry = new Date(Date.now() - 1000 * 60); // −1 min

    mockDb({
      pairingSession: {
        // Found but expires_at in the past → PAIRING_CODE_INVALID/EXPIRED.
        findUnique: async () => ({
          id: 'psess_test_expired',
          stylist_account_id: STYLIST_ACCOUNT_ID,
          claimed_by_client_user_id: null,
          expires_at: pastExpiry,
          revoked_at: null,
        }),
      },
    });

    const { status, event, data } = await mockApiHandler<{
      reason: string;
    }>(handler, {
      method: 'POST',
      body: { token: VALID_TOKEN },
    });

    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.PAIRING.PAIRING_TOKEN_EXPIRED);
    expect(data.reason).toBe('EXPIRED');
  });
});
