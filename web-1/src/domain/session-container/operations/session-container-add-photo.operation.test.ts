/**
 * SessionContainer ADD-PHOTO unit tests — addPhotoToSessionContainer_IO (domain-unit).
 *
 * The integration-handler test (src/test-utils/integration/session-container-add-photo.test.ts)
 * pins the HTTP contract (201 happy path, SC-3 in-TX ownership, 401/403 gates) — those
 * cases are NOT repeated here. This file covers the domain branches it does not:
 *
 * s22 priority (commit ee9987ff):
 *   - TTL write-path: expires_at <= now with lifecycle still SHARED/ACTIVE rejects
 *     ADD_PHOTO pre-flight AND on the in-TX re-check (TOCTOU window), no insert.
 *   - is_hidden mask: a moderation-hidden gallery record is rejected EXACTLY like a
 *     non-existent one (PHOTO_OWNERSHIP — anti-enumeration parity with favorite path).
 *
 * Plus: ownership/pairing pre-flight guards + NOT_PAIRED payloads (locked vs anonymous
 * draft), row-lock-missing → INVALID_STATE, in-TX pairing revoke (SC-2), position
 * allocation + DRAFT→READY promote + anonymous stylist lock-in write payloads,
 * in-TX idempotent duplicate short-circuit, and the P2002 classifier routing
 * (duplicate_photo → idempotent success, active_pair → per-client 429 cap,
 * position → retry, unknown → honest DATABASE_ERROR — never a fabricated 429).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { addPhotoToSessionContainer_IO } from './session-container-add-photo.operation';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';

const SESSION_ID = 'sess_test_000000000000001';
const CLIENT_USER_ID = 'usr_client_00000000000001';
const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';
const OTHER_STYLIST_ID = 'acc_stylist_other_0000001';
const GALLERY_RECORD_ID = 'gr_test_00000000000000001';

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 1000);

const makeSessionRow = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  client_account_id: CLIENT_ACCOUNT_ID,
  stylist_account_id: STYLIST_ACCOUNT_ID,
  name: null,
  lifecycle_state: SessionContainerLifecycleStateValue.READY,
  stylist_note: null,
  client_note: null,
  shared_at: null,
  expires_at: null,
  closed_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const ANON_DRAFT = {
  stylist_account_id: null,
  lifecycle_state: SessionContainerLifecycleStateValue.DRAFT,
};

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  gallery_record_id: GALLERY_RECORD_ID,
  created_by_account_id: STYLIST_ACCOUNT_ID,
  is_hidden: false,
  ...overrides,
});

/** P2002 in the adapter-pg shape the classifier reads (index name in originalMessage). */
const makeP2002 = (indexName?: string): Error =>
  Object.assign(new Error('unique constraint violation'), {
    code: 'P2002',
    ...(indexName === undefined
      ? {}
      : {
          meta: {
            driverAdapterError: {
              cause: {
                originalMessage: `duplicate key value violates unique constraint "${indexName}"`,
              },
            },
          },
        }),
  });

/** Installs a full happy-path DB; every piece overridable per test. */
const installDb = (opts: {
  sessionImpl?: () => Promise<unknown>;
  record?: unknown;
  pairImpl?: () => Promise<unknown>;
  createImpl?: (_arg?: unknown) => Promise<unknown>;
  existingPhoto?: unknown;
  lastPosition?: { position: number } | null;
  withLock?: boolean;
}) => {
  const create = vi.fn(
    opts.createImpl ?? (async (_arg?: unknown) => ({ id: 'scp_1' }))
  );
  const update = vi.fn(async (_arg: unknown) => makeSessionRow());
  const pairFindFirst = vi.fn(
    opts.pairImpl ?? (async () => ({ id: 'pair_1' }))
  );
  const sessionFindUnique = vi.fn(
    opts.sessionImpl ?? (async () => makeSessionRow())
  );
  const lockStub =
    opts.withLock === false
      ? {}
      : {
          $queryRaw: (async () => [{ id: SESSION_ID }]) as unknown as Record<
            string,
            (...args: never[]) => unknown
          >,
        };
  mockDb({
    ...lockStub,
    sessionContainer: { findUnique: sessionFindUnique, update },
    galleryRecord: {
      findUnique: async () => ('record' in opts ? opts.record : makeRecord()),
    },
    clientStylistPair: { findFirst: pairFindFirst },
    sessionContainerPhoto: {
      findFirst: async () =>
        opts.lastPosition === undefined ? null : opts.lastPosition,
      findUnique: async () =>
        opts.existingPhoto === undefined ? null : opts.existingPhoto,
      create,
      findMany: async () => [],
      count: async () => 0,
    },
  });
  return { create, update, pairFindFirst };
};

const runOp = () =>
  addPhotoToSessionContainer_IO({
    client_user_id: CLIENT_USER_ID,
    client_account_id: CLIENT_ACCOUNT_ID,
    session_id: SESSION_ID,
    gallery_record_id: GALLERY_RECORD_ID,
  });

type AddPhotoFailure = Extract<
  Awaited<ReturnType<typeof runOp>>,
  { success: false }
>['error'];

/** Asserts the result failed with the given type; returns the NARROWED error payload. */
const failureOf = <T extends AddPhotoFailure['type']>(
  result: Awaited<ReturnType<typeof runOp>>,
  type: T
): Extract<AddPhotoFailure, { type: T }> => {
  if (result.success) {
    throw new Error(`Expected failure ${type}, got success`);
  }
  expect(result.error.type).toBe(type);
  return result.error as Extract<AddPhotoFailure, { type: T }>;
};

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

  it('active_pair partial-unique (anonymous lock-in collided with a live pair session) → MAX_ACTIVE_EXCEEDED', async () => {
    installDb({
      sessionImpl: async () => makeSessionRow(ANON_DRAFT),
      createImpl: async () => {
        throw makeP2002('session_container_active_pair_uq');
      },
    });
    const err = failureOf(
      await runOp(),
      'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED'
    );
    expect(err.clientAccountId).toBe(CLIENT_ACCOUNT_ID);
    expect(err.limit).toBe(
      SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT
    );
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
