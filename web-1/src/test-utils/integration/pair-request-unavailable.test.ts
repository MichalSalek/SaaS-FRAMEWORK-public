/**
 * Integration-handler — POST pairing/request-pair (D3 event mask).
 *
 * PAIR_REQUEST_STYLIST_NOT_FOUND maps to 404 + PAIR_REQUEST_UNAVAILABLE for
 * both a stylist-side revoke and a nonexistent stylist (anti-oracle parity).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/pairing/request-pair/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  AccountStatusValue,
  AccountTypeValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';

const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';

const activeStylistAccount = {
  display_name: 'Ola Nails',
  created_by_user_id: 'usr_owner_000000000000001',
  account_status: AccountStatusValue.ACTIVE,
  created_by_user: {
    email: 'ola@salon.pl',
    name: 'Ola',
    is_active: true,
  },
};

describe('POST /api/v1/pairing/request-pair (D3 PAIR_REQUEST_UNAVAILABLE)', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    __setPermission(true);
  });

  it('REVOKED + revoked_by STYLIST → 404 + PAIR_REQUEST_UNAVAILABLE', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => activeStylistAccount,
      },
      clientStylistPair: {
        findUnique: async () => ({
          id: 'pair_test_000000000000001',
          status: PairingStatusValue.REVOKED,
          revoked_by: AccountTypeValue.STYLIST,
          paired_at: new Date('2026-01-01T00:00:00.000Z'),
          stylist_hidden_at: null,
        }),
      },
    });

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: { stylist_account_id: STYLIST_ACCOUNT_ID },
    });

    expect(status).toBe(404);
    expect(event).toBe(APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_UNAVAILABLE);
  });

  it('nonexistent stylist → same 404 + same PAIR_REQUEST_UNAVAILABLE (mask parity)', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => null,
      },
    });

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: { stylist_account_id: STYLIST_ACCOUNT_ID },
    });

    expect(status).toBe(404);
    expect(event).toBe(APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_UNAVAILABLE);
  });
});
