/**
 * Domain-unit tests for addPhotoToSessionContainer_IO.
 * The integration-handler test pins the HTTP contract, so it is not repeated here.
 * A past TTL rejects ADD_PHOTO before the write and on the in-transaction re-check
 * (no insert). A hidden gallery record is rejected like a missing one.
 * Also ownership, pairing, position, the duplicate short-circuit, and P2002 routing:
 * duplicate success, pair conflict, position retry, unknown stays DATABASE_ERROR.
 * Test: this file (TTL re-check and hidden-record mask; not a live race).
 */

import { describe, it, expect } from 'vitest';
import {
  SESSION_ID,
  CLIENT_USER_ID,
  CLIENT_ACCOUNT_ID,
  STYLIST_ACCOUNT_ID,
  OTHER_STYLIST_ID,
  GALLERY_RECORD_ID,
  FUTURE,
  PAST,
  makeSessionRow,
  ANON_DRAFT,
  makeRecord,
  makeP2002,
  installDb,
  runOp,
  failureOf,
} from '../../../test-utils/session-container-add-photo.fixture';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

describe('addPhotoToSessionContainer_IO — pre-flight guards', () => {
  it('unknown session → NOT_FOUND', async () => {
    const { create } = installDb({ sessionImpl: async () => null });
    failureOf(await runOp(), 'SESSION_CONTAINER_NOT_FOUND');
    expect(create).not.toHaveBeenCalled();
  });

  it('session owned by another client → NOT_AUTHORIZED, no insert', async () => {
    const { create } = installDb({
      sessionImpl: async () =>
        makeSessionRow({ client_account_id: 'cli_other_000000000000001' }),
    });
    failureOf(await runOp(), 'SESSION_CONTAINER_NOT_AUTHORIZED');
    expect(create).not.toHaveBeenCalled();
  });

  it('s22 TTL: SHARED session with expires_at in the PAST (unswept) → INVALID_STATE(ADD_PHOTO), no insert', async () => {
    const { create } = installDb({
      sessionImpl: async () =>
        makeSessionRow({
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          shared_at: new Date('2026-01-01T00:00:00.000Z'),
          expires_at: PAST,
        }),
    });
    const err = failureOf(await runOp(), 'SESSION_CONTAINER_INVALID_STATE');
    // Row is STILL SHARED — the TTL alone must reject.
    expect(err.currentState).toBe(SessionContainerLifecycleStateValue.SHARED);
    expect(err.attemptedAction).toBe('ADD_PHOTO');
    expect(create).not.toHaveBeenCalled();
  });

  it('s22 is_hidden: moderation-hidden record (even owned by the session stylist) → PHOTO_OWNERSHIP mask, no insert', async () => {
    const { create } = installDb({ record: makeRecord({ is_hidden: true }) });
    const err = failureOf(await runOp(), 'SESSION_CONTAINER_PHOTO_OWNERSHIP');
    expect(err.galleryRecordId).toBe(GALLERY_RECORD_ID);
    expect(err.expectedStylistAccountId).toBe(STYLIST_ACCOUNT_ID);
    expect(create).not.toHaveBeenCalled();
  });

  it('missing record on an ANONYMOUS draft → the SAME PHOTO_OWNERSHIP shape (anti-enumeration), expected stylist empty', async () => {
    const { create } = installDb({
      sessionImpl: async () => makeSessionRow(ANON_DRAFT),
      record: null,
    });
    const err = failureOf(await runOp(), 'SESSION_CONTAINER_PHOTO_OWNERSHIP');
    expect(err.expectedStylistAccountId).toBe('');
    expect(create).not.toHaveBeenCalled();
  });

  it("locked session: record owned by a DIFFERENT stylist → PHOTO_OWNERSHIP with the session's stylist", async () => {
    const { create } = installDb({
      record: makeRecord({ created_by_account_id: OTHER_STYLIST_ID }),
    });
    const err = failureOf(await runOp(), 'SESSION_CONTAINER_PHOTO_OWNERSHIP');
    expect(err.expectedStylistAccountId).toBe(STYLIST_ACCOUNT_ID);
    expect(create).not.toHaveBeenCalled();
  });

  it('locked session without ACTIVE pairing → NOT_PAIRED against the session stylist', async () => {
    const { create } = installDb({ pairImpl: async () => null });
    const err = failureOf(await runOp(), 'SESSION_CONTAINER_NOT_PAIRED');
    expect(err.stylistAccountId).toBe(STYLIST_ACCOUNT_ID);
    expect(err.clientUserId).toBe(CLIENT_USER_ID);
    expect(create).not.toHaveBeenCalled();
  });

  it('anonymous draft without pairing → NOT_PAIRED against the RECORD owner (first photo decides)', async () => {
    installDb({
      sessionImpl: async () => makeSessionRow(ANON_DRAFT),
      record: makeRecord({ created_by_account_id: OTHER_STYLIST_ID }),
      pairImpl: async () => null,
    });
    const err = failureOf(await runOp(), 'SESSION_CONTAINER_NOT_PAIRED');
    expect(err.stylistAccountId).toBe(OTHER_STYLIST_ID);
  });
});

describe('addPhotoToSessionContainer_IO — transaction branches', () => {
  it('happy anonymous DRAFT: appends at max(position)+1, promotes DRAFT→READY and locks-in the record owner', async () => {
    const { create, update } = installDb({
      sessionImpl: async () => makeSessionRow(ANON_DRAFT),
      lastPosition: { position: 4 },
    });

    const result = await runOp();

    expect(result.success).toBe(true);
    const createArg = create.mock.calls[0]?.[0] as unknown as {
      data: { session_id: string; gallery_record_id: string; position: number };
    };
    expect(createArg.data.session_id).toBe(SESSION_ID);
    expect(createArg.data.gallery_record_id).toBe(GALLERY_RECORD_ID);
    expect(createArg.data.position).toBe(5);
    const updateArg = update.mock.calls[0]?.[0] as unknown as {
      where: { id: string };
      data: { lifecycle_state?: string; stylist_account_id?: string };
    };
    expect(updateArg.where.id).toBe(SESSION_ID);
    expect(updateArg.data.lifecycle_state).toBe(
      SessionContainerLifecycleStateValue.READY
    );
    expect(updateArg.data.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
  });

  it('row-lock finds no row (session vanished before TX) → INVALID_STATE, no insert', async () => {
    // withLock:false leaves the proxy's default $queryRaw (returns no rows).
    const { create } = installDb({ withLock: false });
    failureOf(await runOp(), 'SESSION_CONTAINER_INVALID_STATE');
    expect(create).not.toHaveBeenCalled();
  });

  it('s22 TTL TOCTOU: TTL passes pre-flight but is expired on the in-TX re-fetch → INVALID_STATE, no insert', async () => {
    let call = 0;
    const { create } = installDb({
      sessionImpl: async () => {
        call += 1;
        return call === 1
          ? makeSessionRow({
              lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
              expires_at: FUTURE,
            })
          : {
              lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
              stylist_account_id: STYLIST_ACCOUNT_ID,
              expires_at: PAST,
            };
      },
    });
    failureOf(await runOp(), 'SESSION_CONTAINER_INVALID_STATE');
    expect(create).not.toHaveBeenCalled();
  });

  it('SC-2: pairing revoked between pre-flight and TX → NOT_PAIRED, no insert, no retry', async () => {
    let pairCall = 0;
    const { create, pairFindFirst } = installDb({
      pairImpl: async () => {
        pairCall += 1;
        return pairCall === 1 ? { id: 'pair_1' } : null;
      },
    });
    failureOf(await runOp(), 'SESSION_CONTAINER_NOT_PAIRED');
    expect(create).not.toHaveBeenCalled();
    expect(pairFindFirst).toHaveBeenCalledTimes(2);
  });

  it('idempotent: photo already in the container (in-TX findUnique) → success WITHOUT insert or state write', async () => {
    const { create, update } = installDb({
      existingPhoto: { id: 'scp_existing_1' },
    });
    const result = await runOp();
    expect(result.success).toBe(true);
    expect(create).not.toHaveBeenCalled();
    // READY + stylist already locked → no state update either.
    expect(update).not.toHaveBeenCalled();
  });
});

describe('addPhotoToSessionContainer_IO — open pair session on an anonymous draft', () => {
  it('stylist already has another open session with this client → PAIR_SESSION_EXISTS with its id, no insert, no lock-in', async () => {
    const { create, update, sessionFindFirst } = installDb({
      sessionImpl: async () => makeSessionRow(ANON_DRAFT),
      openPairImpl: async () => ({ id: 'sess_open_1' }),
    });
    const err = failureOf(
      await runOp(),
      'SESSION_CONTAINER_PAIR_SESSION_EXISTS'
    );
    expect(err.existingSessionId).toBe('sess_open_1');
    expect(err.stylistAccountId).toBe(STYLIST_ACCOUNT_ID);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          client_account_id: CLIENT_ACCOUNT_ID,
          stylist_account_id: STYLIST_ACCOUNT_ID,
          id: { not: SESSION_ID },
        }),
      })
    );
  });

  it('session with a locked stylist skips the check', async () => {
    const { sessionFindFirst } = installDb({});
    const result = await runOp();
    expect(result.success).toBe(true);
    expect(sessionFindFirst).not.toHaveBeenCalled();
  });
});

describe('addPhotoToSessionContainer_IO — P2002 classification routing', () => {
  it('duplicate_photo constraint → idempotent SUCCESS (photo already in), not a quota error', async () => {
    const { create } = installDb({
      createImpl: async () => {
        throw makeP2002(
          'SessionContainerPhoto_session_id_gallery_record_id_key'
        );
      },
    });
    const result = await runOp();
    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('active_pair partial-unique (concurrent lock-in collided with a live pair session) → PAIR_SESSION_EXISTS, not the per-client cap', async () => {
    let call = 0;
    installDb({
      sessionImpl: async () => makeSessionRow(ANON_DRAFT),
      // In-TX check sees nothing (the winner is not committed yet); the
      // read-back after the P2002 finds it.
      openPairImpl: async () => (call++ === 0 ? null : { id: 'sess_open_1' }),
      createImpl: async () => {
        throw makeP2002('session_container_active_pair_uq');
      },
    });
    const err = failureOf(
      await runOp(),
      'SESSION_CONTAINER_PAIR_SESSION_EXISTS'
    );
    expect(err.sessionId).toBe(SESSION_ID);
    expect(err.stylistAccountId).toBe(STYLIST_ACCOUNT_ID);
    expect(err.existingSessionId).toBe('sess_open_1');
  });

  it('active_pair read-back failing → PAIR_SESSION_EXISTS with existingSessionId null (never a 500)', async () => {
    let call = 0;
    installDb({
      sessionImpl: async () => makeSessionRow(ANON_DRAFT),
      openPairImpl: async () => {
        if (call++ === 0) {
          return null;
        }
        throw new Error('db down');
      },
      createImpl: async () => {
        throw makeP2002('session_container_active_pair_uq');
      },
    });
    const err = failureOf(
      await runOp(),
      'SESSION_CONTAINER_PAIR_SESSION_EXISTS'
    );
    expect(err.existingSessionId).toBeNull();
  });

  it('position constraint → RETRIED; second attempt succeeds', async () => {
    let createCall = 0;
    const { create } = installDb({
      createImpl: async () => {
        createCall += 1;
        if (createCall === 1) {
          throw makeP2002('SessionContainerPhoto_session_id_position_key');
        }
        return { id: 'scp_1' };
      },
    });
    const result = await runOp();
    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('P2002 with UNRECOGNIZABLE constraint → honest DATABASE_ERROR (no fabricated 429, no infinite retry)', async () => {
    const { create } = installDb({
      createImpl: async () => {
        throw makeP2002(); // no adapter cause → classifier yields 'unknown'
      },
    });
    failureOf(await runOp(), 'DATABASE_ERROR');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
