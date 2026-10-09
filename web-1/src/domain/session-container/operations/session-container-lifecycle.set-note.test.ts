/**
 * SessionContainer SET-NOTE unit tests — setSessionContainerNote_IO (domain-unit;
 * sibling file session-container-lifecycle.operations.test.ts covers
 * closeSessionContainer_IO — split to stay under ESLint max-lines).
 *
 * Priority coverage (s22, commit ee9987ff): the NEW write-side TTL guard — a
 * SHARED/ACTIVE session with expires_at <= now (unswept, expiry sweep throttled
 * ~6h) must reject SET_NOTE with INVALID_STATE and write nothing. Also covered:
 * side-matched authorization, SCCAP-2 pairing gate (client-side pairing gate: sibling
 * session-container-lifecycle.set-note-pairing.test.ts), the SCCAP-3 client-private
 * guards (DRAFT/READY + terminal-never-shared → the SAME NOT_AUTHORIZED as read
 * paths, never a distinguishable INVALID_STATE), note trim/clear semantics and
 * viewer-side masking of the echoed DTO.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { setSessionContainerNote_IO } from './session-container-lifecycle.operations';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

const SESSION_ID = 'sess_test_000000000000001';
const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';
const OTHER_STYLIST_ID = 'acc_stylist_other_0000001';
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

describe('setSessionContainerNote_IO', () => {
  it('s22 TTL write-path: SHARED session with expires_at in the past → INVALID_STATE(SET_NOTE), no write', async () => {
    const update = vi.fn(async () => makeRow());
    mockDb({
      sessionContainer: {
        findUnique: async () => makeRow({ expires_at: PAST }),
        update,
      },
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
    });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: 'notatka do wygasłej sesji',
      side: 'client',
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_INVALID_STATE');
      if (result.error.type === 'SESSION_CONTAINER_INVALID_STATE') {
        // Lifecycle row is STILL SHARED (unswept) — the TTL alone rejects.
        expect(result.error.currentState).toBe(
          SessionContainerLifecycleStateValue.SHARED
        );
        expect(result.error.attemptedAction).toBe('SET_NOTE');
      }
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('client-owner on live SHARED session → writes TRIMMED client_note only; echo masks stylistNote', async () => {
    const update = vi.fn(async (_arg: unknown) =>
      makeRow({ client_note: 'hej', stylist_note: 'sekret' })
    );
    mockDb({
      sessionContainer: {
        findUnique: async () => makeRow({ stylist_note: 'sekret' }),
        update,
      },
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
    });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: '  hej  ',
      side: 'client',
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientNote).toBe('hej');
      expect(result.data.stylistNote).toBeNull();
    }
    const updateArg = update.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data).toEqual({ client_note: 'hej' });
  });

  it('whitespace-only note clears the field (null write)', async () => {
    const update = vi.fn(async (_arg: unknown) =>
      makeRow({ client_note: null })
    );
    mockDb({
      sessionContainer: { findUnique: async () => makeRow(), update },
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
    });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: '   ',
      side: 'client',
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(true);
    const updateArg = update.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data).toEqual({ client_note: null });
  });

  it("side 'client' but not the owning client → NOT_AUTHORIZED, no write", async () => {
    const update = vi.fn(async () => makeRow());
    mockDb({
      sessionContainer: { findUnique: async () => makeRow(), update },
    });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: 'x',
      side: 'client',
      client_account_id: 'cli_someone_else_00000001',
      stylist_account_id: undefined,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('assigned stylist with pairing writes stylist_note; echo REVEALS her own note', async () => {
    const update = vi.fn(async (_arg: unknown) =>
      makeRow({ stylist_note: 'plan na french' })
    );
    mockDb({
      sessionContainer: { findUnique: async () => makeRow(), update },
      clientAccount: {
        findUnique: async () => ({ created_by_user_id: CLIENT_USER_ID }),
      },
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
    });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: 'plan na french',
      side: 'stylist',
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stylistNote).toBe('plan na french');
    }
    const updateArg = update.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data).toEqual({ stylist_note: 'plan na french' });
  });

  it("side 'stylist' but session assigned to ANOTHER stylist → NOT_AUTHORIZED", async () => {
    mockDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({ stylist_account_id: OTHER_STYLIST_ID }),
      },
    });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: 'x',
      side: 'stylist',
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
  });

  it('SCCAP-2: assigned stylist WITHOUT active pairing → NOT_AUTHORIZED', async () => {
    mockDb({
      sessionContainer: { findUnique: async () => makeRow() },
      clientAccount: {
        findUnique: async () => ({ created_by_user_id: CLIENT_USER_ID }),
      },
      clientStylistPair: { findFirst: async () => null },
    });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: 'x',
      side: 'stylist',
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
  });

  it('SCCAP-3: stylist on a client-private DRAFT → NOT_AUTHORIZED (not INVALID_STATE)', async () => {
    mockDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({
            lifecycle_state: SessionContainerLifecycleStateValue.DRAFT,
            shared_at: null,
            expires_at: null,
          }),
      },
      clientAccount: {
        findUnique: async () => ({ created_by_user_id: CLIENT_USER_ID }),
      },
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
    });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: 'x',
      side: 'stylist',
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
  });

  it('SCCAP-3 terminal-never-shared (EXPIRED, shared_at=null) for stylist → NOT_AUTHORIZED, NOT the state-oracle INVALID_STATE', async () => {
    mockDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({
            lifecycle_state: SessionContainerLifecycleStateValue.EXPIRED,
            shared_at: null,
            expires_at: PAST,
          }),
      },
      clientAccount: {
        findUnique: async () => ({ created_by_user_id: CLIENT_USER_ID }),
      },
      clientStylistPair: { findFirst: async () => ({ id: 'pair_1' }) },
    });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: 'x',
      side: 'stylist',
      client_account_id: undefined,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_AUTHORIZED');
    }
  });

  it('client-owner on a CLOSED (previously shared) session → INVALID_STATE', async () => {
    mockDb({
      sessionContainer: {
        findUnique: async () =>
          makeRow({
            lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
            closed_at: new Date(),
          }),
      },
    });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: 'x',
      side: 'client',
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_INVALID_STATE');
      if (result.error.type === 'SESSION_CONTAINER_INVALID_STATE') {
        expect(result.error.currentState).toBe(
          SessionContainerLifecycleStateValue.CLOSED
        );
      }
    }
  });

  it('unknown session → NOT_FOUND', async () => {
    mockDb({ sessionContainer: { findUnique: async () => null } });

    const result = await setSessionContainerNote_IO({
      session_id: SESSION_ID,
      note: 'x',
      side: 'client',
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      user_id: ACTOR_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SESSION_CONTAINER_NOT_FOUND');
    }
  });
});
