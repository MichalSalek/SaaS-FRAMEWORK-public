/**
 * Integration-handler test — POST session-container/add-photo (characterization).
 *
 * BDX W0.3 (część A): pins the CURRENT HTTP contract of the add-photo handler
 * BEFORE the FAZA 2 standardization. Drives the real Next.js handler through the
 * production HTTPRequestHandlerMiddleware with only DB / auth / permission /
 * run-after-response mocked (setup.ts).
 *
 * LOCATION: lives in src/test-utils/integration/ (NOT beside the handler under
 * pages/) — see create-gallery-record.test.ts header for the rationale.
 *
 * Cases (each gate = positive + negative):
 *   1. Happy path (client owns DRAFT session, paired, photo belongs to stylist)
 *      → 201 Created + SESSION_CONTAINER_PHOTO_ADDED envelope (BDX W2.5b: a real
 *      photo row is inserted; aligned with sibling create-* handlers).
 *   2a. Anonymous (no session) → 401 LOGIN_FIRST (permission gate blocks).
 *   2b. Wrong role (stylist, no client_account) → 403 WRONG_ACCOUNT_TYPE.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/session-container/add-photo/index';
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

describe('POST /api/v1/session-container/add-photo (handler integration)', () => {
  beforeEach(() => {
    // Authenticated CLIENT (add-photo is a client-only action) + permission granted.
    __setCurrentUser(
      makeCurrentUserOutput(
        makeClientCurrentUser({
          account: { client_account_id: CLIENT_ACCOUNT_ID },
        })
      )
    );
    __setPermission(true);
  });

  it('adds a photo and returns 201 with the session detail envelope', async () => {
    // Session is owned by this client, already locked to a stylist, in READY state
    // (skips the DRAFT→READY promote + anonymous lock-in branches). Photo's record
    // belongs to that same stylist and the client↔stylist pairing is ACTIVE.
    const sessionRow = {
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
    };

    mockDb({
      // finding session-container-1: add-photo now takes a pessimistic row-lock
      // (SELECT "id" FROM "SessionContainer" ... FOR UPDATE via $queryRaw) as the FIRST
      // statement in its TX to serialize concurrent inserts. The proxy's $queryRaw default
      // is a no-op (returns 0) which the lock reads as "row missing" → rollback; stub it to
      // return the locked row so the happy path proceeds. $queryRaw is a TOP-LEVEL client
      // method (not under a model), so the proxy reads models.$queryRaw as a function — the
      // cast bridges mockDb's per-model value type (the harness supports raw-helper stubs at
      // runtime; the param type just predates this use). See mockApiHandler.ts mockDb JSDoc.
      $queryRaw: (async () => [{ id: SESSION_ID }]) as unknown as Record<
        string,
        (...args: never[]) => unknown
      >,
      sessionContainer: {
        // Called: pre-flight fetch, in-TX fresh re-fetch, and loadSessionDetail fetch.
        findUnique: async () => sessionRow,
        update: async () => sessionRow,
      },
      galleryRecord: {
        findUnique: async () => ({
          gallery_record_id: GALLERY_RECORD_ID,
          created_by_account_id: STYLIST_ACCOUNT_ID,
        }),
        // loadSessionDetail hydrates records for the photos it found (none here).
        findMany: async () => [],
      },
      // Active pairing client↔stylist (pre-flight + in-TX re-check both call this).
      clientStylistPair: { findFirst: async () => ({ id: 'pair_test_1' }) },
      sessionContainerPhoto: {
        findFirst: async () => null, // no existing photos → nextPosition = 0
        findUnique: async () => null, // not yet present → insert
        create: async () => ({ id: 'scp_test_1' }),
        findMany: async () => [], // loadSessionDetail photo list
        count: async () => 0, // loadSessionDetail independent total photoCount (SC: decoupled from take:200)
      },
    });

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    // BDX W2.5b: respondCreated → 201 (real photo insert; sibling create-* = 201).
    expect(status).toBe(201);
    expect(event).toBe(
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_ADDED
    );
  });

  it('NEGATIVE — SC-3: concurrent anonymous-draft lock-in rejects a foreign-stylist photo with 403 PHOTO_OWNERSHIP', async () => {
    // TOCTOU: the session is an anonymous DRAFT (stylist_account_id NULL) at
    // pre-flight, so the pre-flight ownership guard is skipped (anonymous branch
    // only checks pairing with the photo's owner). A concurrent add-photo locks-in
    // stylist X first; by the in-TX fresh re-fetch this session's stylist is X, but
    // THIS request's photo belongs to a DIFFERENT stylist Y. Without the in-TX
    // ownership guard, Y's photo would land in a session locked to X. Simulated by
    // a stateful findUnique: call 1 (pre-flight) = anonymous, call 2 (in-TX) = locked.
    const OTHER_STYLIST_ID = 'acc_stylist_other_000000001';
    const anonRow = {
      id: SESSION_ID,
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: null,
      lifecycle_state: SessionContainerLifecycleStateValue.DRAFT,
      name: null,
      stylist_note: null,
      client_note: null,
      shared_at: null,
      expires_at: null,
      closed_at: null,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const lockedFresh = {
      lifecycle_state: SessionContainerLifecycleStateValue.DRAFT,
      stylist_account_id: STYLIST_ACCOUNT_ID, // locked-in by the concurrent winner
    };
    let findUniqueCall = 0;

    mockDb({
      $queryRaw: (async () => [{ id: SESSION_ID }]) as unknown as Record<
        string,
        (...args: never[]) => unknown
      >,
      sessionContainer: {
        findUnique: async () => {
          findUniqueCall += 1;
          // Call 1 = pre-flight (anonymous full row). Call 2 = in-TX fresh (locked to X).
          return findUniqueCall === 1 ? anonRow : lockedFresh;
        },
        update: async () => anonRow,
      },
      galleryRecord: {
        // Photo owned by Y (≠ the X locked-in during the TX window).
        findUnique: async () => ({
          gallery_record_id: GALLERY_RECORD_ID,
          created_by_account_id: OTHER_STYLIST_ID,
        }),
        findMany: async () => [],
      },
      // Client is ACTIVE-paired with both stylists → pairing checks (pre-flight with
      // Y, in-TX with X) both pass; only the ownership guard should reject.
      clientStylistPair: { findFirst: async () => ({ id: 'pair_test_1' }) },
      sessionContainerPhoto: {
        findFirst: async () => null,
        findUnique: async () => null,
        create: async () => ({ id: 'scp_test_1' }),
        findMany: async () => [],
        count: async () => 0,
      },
    });

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: VALID_BODY,
    });

    expect(status).toBe(403);
    expect(event).toBe(
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_OWNERSHIP
    );
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

    // requireClientAccount → UNAUTHORIZED/WRONG_ACCOUNT_TYPE → 403 (S122: a
    // logged-in role refusal is Forbidden, not Unauthenticated; see error-mapper).
    expect(status).toBe(403);
    expect(event).toBe(APP_EVENTS.INFO.USER.UNAUTHORIZED);
    expect(data.reason).toBe('WRONG_ACCOUNT_TYPE');
  });
});
