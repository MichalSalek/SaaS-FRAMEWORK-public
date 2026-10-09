/**
 * SessionContainer CLOSE unit tests — closeSessionContainer_IO (domain-unit;
 * sibling file session-container-lifecycle.set-note.test.ts covers
 * setSessionContainerNote_IO — split to stay under ESLint max-lines).
 *
 * Close is the terminal sink: it deliberately has NO TTL guard (s22 decision —
 * closing an effectively-expired session is harmless) and is idempotent on
 * terminal states (echo, no write). Covered: ownership/authorization branches
 * (owning client vs assigned stylist), SM-1 pairing scoping
 * (client_user.is_active), the SCCAP-3 client-private guards (DRAFT/READY +
 * terminal-never-shared → the SAME NOT_AUTHORIZED as read paths), the CLOSED
 * write payload, and viewer-side masking of the echoed DTO.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { closeSessionContainer_IO } from './session-container-lifecycle.operations';
import {
  PairingStatusValue,
  SessionContainerLifecycleStateValue,
} from '@kernel/models/db_models.generated.dto';

const SESSION_ID = 'sess_test_000000000000001';
const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';
const CLIENT_USER_ID = 'usr_client_00000000000001';
const ACTOR_USER_ID = 'usr_actor_000000000000001';

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 1000);

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

describe('closeSessionContainer_IO', () => {
  it('unknown session → SESSION_CONTAINER_NOT_FOUND', async () => {
    mockDb({ sessionContainer: { findUnique: async () => null } });

    const result = await closeSessionContainer_IO({
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      session_id: SESSION_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_FOUND');
    }
  });

  it('caller is neither owning client nor assigned stylist → NOT_AUTHORIZED, no write', async () => {
    const update = vi.fn(async () => makeRow());
    mockDb({
      sessionContainer: { findUnique: async () => makeRow(), update },
    });

    const result = await closeSessionContainer_IO({
      client_account_id: 'cli_someone_else_00000001',
      stylist_account_id: undefined,
      session_id: SESSION_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('owning client closes a SHARED session → CLOSED write + closed_at; echoed stylistNote stays MASKED', async () => {
    const update = vi.fn(async (_arg: unknown) =>
      makeRow({
        lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
        closed_at: new Date(),
        stylist_note: 'prywatna notka stylistki',
      })
    );
    mockDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({ stylist_note: 'prywatna notka stylistki' }),
        update,
      },
    });

    const result = await closeSessionContainer_IO({
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      session_id: SESSION_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lifecycleState).toBe(
        SessionContainerLifecycleStateValue.CLOSED
      );
      // Client viewer — stylist-private note must never echo back.
      expect(result.data.stylistNote).toBeNull();
      expect(result.data.photoCount).toBe(2);
    }
    const updateArg = update.mock.calls[0]?.[0] as unknown as {
      where: { id: string };
      data: { lifecycle_state: string; closed_at: Date };
    };
    expect(updateArg.where.id).toBe(SESSION_ID);
    expect(updateArg.data.lifecycle_state).toBe(
      SessionContainerLifecycleStateValue.CLOSED
    );
    expect(updateArg.data.closed_at).toBeInstanceOf(Date);
  });

  it('assigned stylist with ACTIVE pairing closes → success, SM-1 scoped pairing lookup, stylistNote REVEALED', async () => {
    const pairFindFirst = vi.fn(async (_arg: unknown) => ({ id: 'pair_1' }));
    mockDb({
      sessionContainer: {
        findUnique: async () => makeRow({ stylist_note: 'moja notka' }),
        update: async () =>
          makeRow({
            lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
            closed_at: new Date(),
            stylist_note: 'moja notka',
          }),
      },
      clientAccount: {
        findUnique: async () => ({ created_by_user_id: CLIENT_USER_ID }),
      },
      clientStylistPair: { findFirst: pairFindFirst },
    });

    const result = await closeSessionContainer_IO({
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      session_id: SESSION_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stylistNote).toBe('moja notka');
    }
    const pairArg = pairFindFirst.mock.calls[0]?.[0] as unknown as {
      where: {
        client_user_id: string;
        stylist_account_id: string;
        status: string;
        client_user: { is_active: boolean };
      };
    };
    expect(pairArg.where.client_user_id).toBe(CLIENT_USER_ID);
    expect(pairArg.where.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
    expect(pairArg.where.status).toBe(PairingStatusValue.ACTIVE);
    // SM-1: a soft-deleted client leaves the pairing row ACTIVE — the guard must
    // require the client user to still be active.
    expect(pairArg.where.client_user.is_active).toBe(true);
  });

  it('assigned stylist WITHOUT active pairing → NOT_AUTHORIZED, no write', async () => {
    const update = vi.fn(async () => makeRow());
    mockDb({
      sessionContainer: { findUnique: async () => makeRow(), update },
      clientAccount: {
        findUnique: async () => ({ created_by_user_id: CLIENT_USER_ID }),
      },
      clientStylistPair: { findFirst: async () => null },
    });

    const result = await closeSessionContainer_IO({
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      session_id: SESSION_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('SCCAP-3: assigned+paired stylist may NOT close a client-private READY draft → NOT_AUTHORIZED', async () => {
    const update = vi.fn(async () => makeRow());
    mockDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({
            lifecycle_state: SessionContainerLifecycleStateValue.READY,
            shared_at: null,
            expires_at: null,
          }),
        update,
      },
      clientAccount: {
        findUnique: async () => ({ created_by_user_id: CLIENT_USER_ID }),
      },
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
    });

    const result = await closeSessionContainer_IO({
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      session_id: SESSION_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('SCCAP-3 terminal-never-shared: CLOSED with shared_at=null hides from the assigned stylist → NOT_AUTHORIZED', async () => {
    mockDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({
            lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
            shared_at: null,
            closed_at: new Date('2026-01-02T00:00:00.000Z'),
          }),
      },
      clientAccount: {
        findUnique: async () => ({ created_by_user_id: CLIENT_USER_ID }),
      },
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
    });

    const result = await closeSessionContainer_IO({
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      session_id: SESSION_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      // NOT an idempotent success and NOT INVALID_STATE — existence must stay hidden.
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
  });

  it('idempotent: owner closes an already-EXPIRED session → success echo, NO update write', async () => {
    const update = vi.fn(async () => makeRow());
    mockDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({
            lifecycle_state: SessionContainerLifecycleStateValue.EXPIRED,
            expires_at: PAST,
          }),
        update,
      },
    });

    const result = await closeSessionContainer_IO({
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      session_id: SESSION_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lifecycleState).toBe(
        SessionContainerLifecycleStateValue.EXPIRED
      );
    }
    expect(update).not.toHaveBeenCalled();
  });
});
