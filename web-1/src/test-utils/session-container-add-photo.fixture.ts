// Shared DB stubs and helpers of the addPhotoToSessionContainer_IO unit tests
// (split out of the test file, max-lines).

import { expect, vi } from 'vitest';
import { mockDb } from './mockApiHandler';
import { addPhotoToSessionContainer_IO } from '../domain/session-container/operations/session-container-add-photo.operation';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

export const SESSION_ID = 'sess_test_000000000000001';
export const CLIENT_USER_ID = 'usr_client_00000000000001';
export const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
export const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';
export const OTHER_STYLIST_ID = 'acc_stylist_other_0000001';
export const GALLERY_RECORD_ID = 'gr_test_00000000000000001';

export const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
export const PAST = new Date(Date.now() - 1000);

export const makeSessionRow = (overrides: Record<string, unknown> = {}) => ({
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

export const ANON_DRAFT = {
  stylist_account_id: null,
  lifecycle_state: SessionContainerLifecycleStateValue.DRAFT,
};

export const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  gallery_record_id: GALLERY_RECORD_ID,
  created_by_account_id: STYLIST_ACCOUNT_ID,
  is_hidden: false,
  ...overrides,
});

/** P2002 in the adapter-pg shape the classifier reads (index name in originalMessage). */
export const makeP2002 = (indexName?: string): Error =>
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
export const installDb = (opts: {
  sessionImpl?: () => Promise<unknown>;
  record?: unknown;
  pairImpl?: () => Promise<unknown>;
  createImpl?: (_arg?: unknown) => Promise<unknown>;
  existingPhoto?: unknown;
  lastPosition?: { position: number } | null;
  withLock?: boolean;
  /** Another open session of this client with the photo's stylist (in-TX check
   *  and the post-P2002 read-back). */
  openPairImpl?: () => Promise<unknown>;
}) => {
  const sessionFindFirst = vi.fn(opts.openPairImpl ?? (async () => null));
  const create = vi.fn(
    opts.createImpl ?? (async (_arg?: unknown) => ({ id: 'scp_1' }))
  );
  const update = vi.fn(async (_arg: unknown) => makeSessionRow());
  const pairFindFirst = vi.fn(
    opts.pairImpl ?? (async () => ({ id: 'pair_1' }))
  );
  let currentSession: unknown;
  const originalSession = opts.sessionImpl ?? (async () => makeSessionRow());
  const sessionFindUnique = vi.fn(
    async (args?: { include?: { client_account?: unknown } }) => {
      if (args?.include?.client_account != null) {
        return currentSession !== null && typeof currentSession === 'object'
          ? {
              ...currentSession,
              client_account: { created_by_user_id: CLIENT_USER_ID },
            }
          : null;
      }
      const value = await originalSession();
      if (currentSession === undefined) {
        currentSession = value;
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
    ...lockStub,
    stylistAccount: {
      findMany: async () => [],
      findUnique: async () => ({ created_by_user_id: 'usr_stylist_parent' }),
    },
    sessionContainer: {
      findUnique: sessionFindUnique,
      findUniqueOrThrow: async () => currentSession,
      findFirst: sessionFindFirst,
      update,
    },
    galleryRecord: {
      findUnique: async () => ('record' in opts ? opts.record : makeRecord()),
    },
    clientStylistPair: {
      findFirst: pairFindFirst,
      findUnique: async () => null,
    },
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
  return { create, update, pairFindFirst, sessionFindFirst };
};

export const runOp = () =>
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
export const failureOf = <T extends AddPhotoFailure['type']>(
  result: Awaited<ReturnType<typeof runOp>>,
  type: T
): Extract<AddPhotoFailure, { type: T }> => {
  if (result.success) {
    throw new Error(`Expected failure ${type}, got success`);
  }
  expect(result.error.type).toBe(type);
  return result.error as Extract<AddPhotoFailure, { type: T }>;
};
