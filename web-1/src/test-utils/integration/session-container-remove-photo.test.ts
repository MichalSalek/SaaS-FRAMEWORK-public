/**
 * Integration-handler test for POST session-container/remove-photo. Sibling of
 * session-container-add-photo.test.ts: drives the real handler through the production
 * HTTPRequestHandlerMiddleware with only DB / auth / permission / run-after-response mocked
 * (setup.ts). Domain branches live in session-container-remove-photo.operation.test.ts.
 * Cases:
 *   1. Happy path (client owns the READY session, removes its last photo): 200 +
 *      SESSION_CONTAINER_PHOTO_REMOVED envelope with the session detail.
 *   2. Foreign session: 403 SESSION_CONTAINER_NOT_AUTHORIZED.
 *   3. Missing gallery_record_id: 400 from the validator, the DB is never asked.
 *   4a. Anonymous: 401 LOGIN_FIRST (permission gate blocks).
 *   4b. Wrong role (stylist, no client_account): 403 WRONG_ACCOUNT_TYPE.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/session-container/remove-photo/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import {
  __setCurrentUser,
  __setPermission,
  __resetCurrentUser,
} from '../setup';
import {
  makeCurrentUserOutput,
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  SessionContainerLifecycleStateValue,
  AccountStatusValue,
} from '@kernel/models/db_models.generated.dto';

const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_owner_000000001';
const SESSION_ID = 'sess_container_test_00000001';
const GALLERY_RECORD_ID = 'gr_test_in_session_00000001';

const VALID_BODY = {
  session_id: SESSION_ID,
  gallery_record_id: GALLERY_RECORD_ID,
} as const;

const makeSessionRow = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  client_account_id: CLIENT_ACCOUNT_ID,
  stylist_account_id: STYLIST_ACCOUNT_ID,
  lifecycle_state: SessionContainerLifecycleStateValue.READY,
  name: null,
  stylist_note: null,
  client_note: null,
  shared_at: null,
  expires_at: null,
  closed_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  client_account: { created_by_user_id: 'usr_test_0000000000000002' },
  ...overrides,
});

const installDb = (sessionRow: ReturnType<typeof makeSessionRow>) => {
  let deleteCalls = 0;
  mockDb({
    stylistAccount: {
      findUnique: async () => ({ created_by_user_id: 'usr_stylist_parent' }),
    },
    // The per-session row lock (SELECT ... FOR UPDATE through $queryRaw) is the
    // FIRST statement of the TX; see the add-photo sibling for the cast.
    $queryRaw: (async () => [{ id: SESSION_ID }]) as unknown as Record<
      string,
      (...args: never[]) => unknown
    >,
    sessionContainer: {
      // Called: pre-flight fetch, in-TX fresh re-read, and loadSessionDetail fetch.
      findUnique: async () => sessionRow,
      findUniqueOrThrow: async () => sessionRow,
      update: async () => sessionRow,
    },
    galleryRecord: { findMany: async () => [] },
    clientStylistPair: { findUnique: async () => null },
    sessionContainerPhoto: {
      deleteMany: async () => {
        deleteCalls += 1;
        return { count: 1 };
      },
      findMany: async () => [], // loadSessionDetail photo list after the removal
      count: async () => 0, // in-TX remaining count + loadSessionDetail total
    },
  });
  return { deleteCalls: () => deleteCalls };
};

describe('POST /api/v1/session-container/remove-photo (handler integration)', () => {
  beforeEach(() => {
    // Authenticated CLIENT (remove-photo is a client-only action) + permission granted.
    __setCurrentUser(
      makeCurrentUserOutput(
        makeClientCurrentUser({
          account: { client_account_id: CLIENT_ACCOUNT_ID },
        })
      )
    );
    __setPermission(true);
  });

  it('removes the photo and returns 200 with the session detail envelope', async () => {
    const db = installDb(makeSessionRow());

    const { status, event, data } = await mockApiHandler<{
      session: { id: string; photos: unknown[]; photoCount: number };
    }>(handler, { method: 'POST', body: VALID_BODY });

    // respondSuccess → 200: a removal creates nothing (add-photo is 201).
    expect(status).toBe(200);
    expect(event).toBe(
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_REMOVED
    );
    expect(db.deleteCalls()).toBe(1);
    expect(data.session.id).toBe(SESSION_ID);
    expect(data.session.photos).toEqual([]);
    expect(data.session.photoCount).toBe(0);
  });

  it("NEGATIVE — another client's session is rejected with 403 NOT_AUTHORIZED, nothing deleted", async () => {
    const db = installDb(
      makeSessionRow({ client_account_id: 'cli_other_000000000000001' })
    );

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    expect(status).toBe(403);
    expect(event).toBe(
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_AUTHORIZED
    );
    expect(db.deleteCalls()).toBe(0);
  });

  it('NEGATIVE — a body without gallery_record_id is rejected with 400 before the DB', async () => {
    const db = installDb(makeSessionRow());

    const { status } = await mockApiHandler(handler, {
      method: 'POST',
      body: { session_id: SESSION_ID },
    });

    expect(status).toBe(400);
    expect(db.deleteCalls()).toBe(0);
  });

  it('NEGATIVE — anonymous request is blocked with 401 LOGIN_FIRST', async () => {
    // No session + permission denied (NOT_LOGGED_IN role lacks the command grant).
    __resetCurrentUser();
    __setPermission(false);

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    expect(status).toBe(401);
    expect(event).toBe(APP_EVENTS.INFO.USER.LOGIN_FIRST);
  });

  it('NEGATIVE — a STYLIST (no client_account) is rejected with 403 WRONG_ACCOUNT_TYPE', async () => {
    // Authenticated stylist passes auth + permission, but requireClientAccount fails.
    __setCurrentUser(
      makeCurrentUserOutput(
        makeStylistCurrentUser({
          account: { account_status: AccountStatusValue.ACTIVE },
        })
      )
    );
    __setPermission(true);

    const { status, event, data } = await mockApiHandler<{
      reason: string;
      requiredAccountType: string;
    }>(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    expect(status).toBe(403);
    expect(event).toBe(APP_EVENTS.INFO.USER.UNAUTHORIZED);
    expect(data.reason).toBe('WRONG_ACCOUNT_TYPE');
  });
});
