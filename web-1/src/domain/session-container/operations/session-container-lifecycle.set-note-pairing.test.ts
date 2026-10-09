/**
 * SessionContainer SET-NOTE — client-side pairing gate (split from
 * session-container-lifecycle.set-note.test.ts to stay under ESLint max-lines).
 *
 * A client note on a SHARED/ACTIVE session lands in the assigned stylist's CRM, so it
 * takes the SAME findActivePairing gate as add-photo: stylist taken down or pair revoked
 * → SESSION_CONTAINER_NOT_PAIRED with no write. DRAFT/READY stay ungated (client-private
 * until share, and share re-checks the pairing).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { setSessionContainerNote_IO } from './session-container-lifecycle.operations';
import {
  PairingStatusValue,
  SessionContainerLifecycleStateValue,
} from '@kernel/models/db_models.generated.dto';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';

const SESSION_ID = 'sess_test_000000000000001';
const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';
const CLIENT_USER_ID = 'usr_client_00000000000001';

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  client_account_id: CLIENT_ACCOUNT_ID,
  stylist_account_id: STYLIST_ACCOUNT_ID,
  name: null,
  lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
  stylist_note: null,
  client_note: null,
  shared_at: new Date('2026-01-01T00:00:00.000Z'),
  expires_at: FUTURE,
  closed_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  _count: { photos: 2 },
  ...overrides,
});

describe('setSessionContainerNote_IO — client-side pairing gate', () => {
  it.each([
    SessionContainerLifecycleStateValue.SHARED,
    SessionContainerLifecycleStateValue.ACTIVE,
  ])(
    "side 'client' on %s after stylist takedown / revoked pair (findActivePairing miss) → NOT_PAIRED, no write",
    async lifecycleState => {
      const update = vi.fn(async () => makeRow());
      const pairFindFirst = vi.fn(async (_arg: unknown) => null);
      mockDb({
        sessionContainer: {
          findUnique: async () => makeRow({ lifecycle_state: lifecycleState }),
          update,
        },
        clientStylistPair: { findFirst: pairFindFirst },
      });

      const result = await setSessionContainerNote_IO({
        session_id: SESSION_ID,
        note: 'po zdjęciu konta',
        side: 'client',
        client_account_id: CLIENT_ACCOUNT_ID,
        stylist_account_id: undefined,
        user_id: CLIENT_USER_ID,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('SESSION_CONTAINER_NOT_PAIRED');
        if (result.error.type === 'SESSION_CONTAINER_NOT_PAIRED') {
          expect(result.error.clientUserId).toBe(CLIENT_USER_ID);
          expect(result.error.stylistAccountId).toBe(STYLIST_ACCOUNT_ID);
        }
      }
      expect(update).not.toHaveBeenCalled();
      // Same gate as add-photo: the acting client's user id, the session's stylist,
      // ACTIVE pair AND the stylist publicly visible (takedown = miss).
      const pairArg = pairFindFirst.mock.calls[0]?.[0] as unknown as {
        where: {
          client_user_id: string;
          stylist_account_id: string;
          status: string;
          stylist_account: unknown;
        };
      };
      expect(pairArg.where.client_user_id).toBe(CLIENT_USER_ID);
      expect(pairArg.where.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
      expect(pairArg.where.status).toBe(PairingStatusValue.ACTIVE);
      expect(pairArg.where.stylist_account).toEqual(STYLIST_PUBLICLY_VISIBLE);
    }
  );

  it.each([
    SessionContainerLifecycleStateValue.DRAFT,
    SessionContainerLifecycleStateValue.READY,
  ])(
    "side 'client' on %s stays ungated (share re-checks the pairing) → writes without a pair lookup",
    async lifecycleState => {
      const update = vi.fn(async (_arg: unknown) =>
        makeRow({ lifecycle_state: lifecycleState, client_note: 'szkic' })
      );
      const pairFindFirst = vi.fn(async (_arg: unknown) => null);
      mockDb({
        sessionContainer: {
          findUnique: async () =>
            makeRow({
              lifecycle_state: lifecycleState,
              shared_at: null,
              expires_at: null,
            }),
          update,
        },
        clientStylistPair: { findFirst: pairFindFirst },
      });

      const result = await setSessionContainerNote_IO({
        session_id: SESSION_ID,
        note: 'szkic',
        side: 'client',
        client_account_id: CLIENT_ACCOUNT_ID,
        stylist_account_id: undefined,
        user_id: CLIENT_USER_ID,
      });

      expect(result.success).toBe(true);
      expect(pairFindFirst).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
    }
  );
});
