/**
 * SessionContainer REMOVE-PHOTO unit tests — removePhotoFromSessionContainer_IO (domain-unit).
 *
 * Same mocking seam as session-container-add-photo.operation.test.ts. The HTTP
 * contract (200, event, 401/403 gates) lives in
 * src/test-utils/integration/session-container-remove-photo.test.ts.
 *
 * Covered: owner-only (missing vs foreign session), the state + TTL guard before
 * and inside the TX, the idempotent no-op, READY → DRAFT on the last photo only,
 * SHARED / ACTIVE keeping their state with zero photos, no pairing dependency,
 * and a DB error surfacing as DATABASE_ERROR.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { removePhotoFromSessionContainer_IO } from './session-container-remove-photo.operation';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

const SESSION_ID = 'sess_test_000000000000001';
const CLIENT_USER_ID = 'usr_client_00000000000001';
const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';
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

/** Installs a happy-path DB: the photo is in the session and one more remains. */
const installDb = (
  opts: {
    sessionImpl?: () => Promise<unknown>;
    deletedCount?: number;
    remaining?: number;
    deleteImpl?: (_arg?: unknown) => Promise<{ count: number }>;
    withLock?: boolean;
  } = {}
) => {
  const deleteMany = vi.fn(
    opts.deleteImpl ??
      (async (_arg?: unknown) => ({ count: opts.deletedCount ?? 1 }))
  );
  const update = vi.fn(async (_arg: unknown) => makeSessionRow());
  // A pairing read would mean removal depends on the pairing: it must not.
  const pairFindFirst = vi.fn(async () => null);
  let initial: unknown;
  const source = opts.sessionImpl ?? (async () => makeSessionRow());
  const findUnique = vi.fn(
    async (args?: { include?: { client_account?: unknown } }) => {
      if (args?.include?.client_account != null) {
        return initial !== null && typeof initial === 'object'
          ? {
              ...initial,
              client_account: { created_by_user_id: CLIENT_USER_ID },
            }
          : null;
      }
      const value = await source();
      if (initial === undefined) {
        initial = value;
      }
      return value;
    }
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
    stylistAccount: {
      findUnique: async () => ({ created_by_user_id: 'usr_stylist_parent' }),
    },
    ...lockStub,
    sessionContainer: {
      findUnique,
      findUniqueOrThrow: async () => initial,
      update,
    },
    clientStylistPair: {
      findFirst: pairFindFirst,
      findUnique: async () => null,
    },
    galleryRecord: { findMany: async () => [] },
    sessionContainerPhoto: {
      deleteMany,
      count: async () => opts.remaining ?? 1,
      findMany: async () => [],
    },
  });
  return { deleteMany, update, pairFindFirst };
};

const runOp = () =>
  removePhotoFromSessionContainer_IO({
    client_user_id: CLIENT_USER_ID,
    client_account_id: CLIENT_ACCOUNT_ID,
    session_id: SESSION_ID,
    gallery_record_id: GALLERY_RECORD_ID,
  });

type RemovePhotoFailure = Extract<
  Awaited<ReturnType<typeof runOp>>,
  { success: false }
>['error'];

/** Asserts the result failed with the given type; returns the NARROWED error payload. */
const failureOf = <T extends RemovePhotoFailure['type']>(
  result: Awaited<ReturnType<typeof runOp>>,
  type: T
): Extract<RemovePhotoFailure, { type: T }> => {
  if (result.success) {
    throw new Error(`Expected failure ${type}, got success`);
  }
  expect(result.error.type).toBe(type);
  return result.error as Extract<RemovePhotoFailure, { type: T }>;
};

describe('removePhotoFromSessionContainer_IO — pre-flight guards', () => {
  it('unknown session → NOT_FOUND, nothing deleted', async () => {
    const { deleteMany } = installDb({ sessionImpl: async () => null });
    failureOf(await runOp(), 'SESSION_CONTAINER_NOT_FOUND');
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('session owned by another client → the same NOT_AUTHORIZED add-photo returns, nothing deleted', async () => {
    const { deleteMany } = installDb({
      sessionImpl: async () =>
        makeSessionRow({ client_account_id: 'cli_other_000000000000001' }),
    });
    const err = failureOf(await runOp(), 'SESSION_CONTAINER_NOT_AUTHORIZED');
    expect(err.userId).toBe(CLIENT_USER_ID);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    SessionContainerLifecycleStateValue.CLOSED,
    SessionContainerLifecycleStateValue.EXPIRED,
  ])(
    'terminal session (%s) → INVALID_STATE(REMOVE_PHOTO), nothing deleted',
    async state => {
      const { deleteMany } = installDb({
        sessionImpl: async () => makeSessionRow({ lifecycle_state: state }),
      });
      const err = failureOf(await runOp(), 'SESSION_CONTAINER_INVALID_STATE');
      expect(err.currentState).toBe(state);
      expect(err.attemptedAction).toBe('REMOVE_PHOTO');
      expect(deleteMany).not.toHaveBeenCalled();
    }
  );

  it('SHARED session past expires_at (unswept) → INVALID_STATE, nothing deleted', async () => {
    const { deleteMany } = installDb({
      sessionImpl: async () =>
        makeSessionRow({
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          shared_at: new Date('2026-01-01T00:00:00.000Z'),
          expires_at: PAST,
        }),
    });
    const err = failureOf(await runOp(), 'SESSION_CONTAINER_INVALID_STATE');
    // The row is STILL SHARED: the TTL alone must reject.
    expect(err.currentState).toBe(SessionContainerLifecycleStateValue.SHARED);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe('removePhotoFromSessionContainer_IO — transaction branches', () => {
  it('happy path: deletes exactly the (session, record) row and keeps READY while photos remain', async () => {
    const { deleteMany, update, pairFindFirst } = installDb({ remaining: 2 });

    const result = await runOp();

    expect(result.success).toBe(true);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany.mock.calls[0]?.[0]).toEqual({
      where: { session_id: SESSION_ID, gallery_record_id: GALLERY_RECORD_ID },
    });
    expect(update).not.toHaveBeenCalled();
    // No pairing check: she may always take her own photo back.
    expect(pairFindFirst).not.toHaveBeenCalled();
  });

  it('idempotent: the photo is not in the session → success, no state write', async () => {
    const { deleteMany, update } = installDb({ deletedCount: 0, remaining: 0 });
    const result = await runOp();
    expect(result.success).toBe(true);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    // Zero photos and READY, but nothing was removed by THIS call: state untouched.
    expect(update).not.toHaveBeenCalled();
  });

  it('last photo of a READY session → back to DRAFT, stylist untouched', async () => {
    const { update } = installDb({ remaining: 0 });

    const result = await runOp();

    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toEqual({
      where: { id: SESSION_ID },
      data: { lifecycle_state: SessionContainerLifecycleStateValue.DRAFT },
    });
  });

  it.each([
    SessionContainerLifecycleStateValue.SHARED,
    SessionContainerLifecycleStateValue.ACTIVE,
  ])('last photo of a %s session → state stays, no write', async state => {
    const { deleteMany, update } = installDb({
      sessionImpl: async () =>
        makeSessionRow({
          lifecycle_state: state,
          shared_at: new Date('2026-01-01T00:00:00.000Z'),
          expires_at: FUTURE,
        }),
      remaining: 0,
    });
    const result = await runOp();
    expect(result.success).toBe(true);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('row-lock finds no row (session vanished before the TX) → INVALID_STATE, nothing deleted', async () => {
    // withLock:false leaves the proxy's default $queryRaw (returns no rows).
    const { deleteMany } = installDb({ withLock: false });
    failureOf(await runOp(), 'SESSION_CONTAINER_INVALID_STATE');
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('closed between pre-flight and the TX → INVALID_STATE with the FRESH state, nothing deleted', async () => {
    let call = 0;
    const { deleteMany } = installDb({
      sessionImpl: async () => {
        call += 1;
        return makeSessionRow(
          call === 1
            ? {}
            : { lifecycle_state: SessionContainerLifecycleStateValue.CLOSED }
        );
      },
    });
    const err = failureOf(await runOp(), 'SESSION_CONTAINER_INVALID_STATE');
    expect(err.currentState).toBe(SessionContainerLifecycleStateValue.CLOSED);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('TTL passes pre-flight but is expired on the in-TX re-read → INVALID_STATE, nothing deleted', async () => {
    let call = 0;
    const { deleteMany } = installDb({
      sessionImpl: async () => {
        call += 1;
        return makeSessionRow({
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          expires_at: call === 1 ? FUTURE : PAST,
        });
      },
    });
    failureOf(await runOp(), 'SESSION_CONTAINER_INVALID_STATE');
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('a DB error inside the TX → DATABASE_ERROR, not a throw', async () => {
    installDb({
      deleteImpl: async () => {
        throw new Error('connection reset');
      },
    });
    failureOf(await runOp(), 'DATABASE_ERROR');
  });
});
