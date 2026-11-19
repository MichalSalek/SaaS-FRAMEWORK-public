/**
 * Integration-handler test — POST gallery/reorder-pinned-records.
 *
 * Drives the real handler through HTTPRequestHandlerMiddleware with only DB / auth /
 * permission mocked (setup.ts). Domain branches live in
 * gallery-pinned-order.operations.test.ts and are not repeated here.
 *
 * Cases:
 *   1. Happy path → 200 + GALLERY_PINNED_ORDER_UPDATED, the UPDATE is scoped to the
 *      SESSION account even when the body carries another account id.
 *   2. Stale list → 409 GALLERY_PINNED_ORDER_STALE, nothing written.
 *   3. Duplicate ids → 400 from the kernel validator, the DB is never asked.
 *   4. A client (no stylist account) → 403 WRONG_ACCOUNT_TYPE.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/gallery/reorder-pinned-records/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import {
  makeCurrentUserOutput,
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const ACCOUNT_ID = 'acc_stylist_reorder_00000001';
const OTHER_ACCOUNT_ID = 'acc_stylist_other_000000001';

type RawFn = Record<string, (...args: never[]) => unknown>;

const installDb = (pinnedIds: string[]) => {
  const writes: Array<{ values: unknown[] }> = [];
  let reads = 0;
  mockDb({
    $queryRaw: (async () => [{ account_id: ACCOUNT_ID }]) as unknown as RawFn,
    $executeRaw: (async (query: { values: unknown[] }) => {
      writes.push(query);
      return pinnedIds.length;
    }) as unknown as RawFn,
    galleryRecord: {
      findMany: async () => {
        reads += 1;
        return pinnedIds.map(id => ({ gallery_record_id: id }));
      },
    },
  });
  return { writes, reads: () => reads };
};

describe('POST /api/v1/gallery/reorder-pinned-records (handler integration)', () => {
  beforeEach(() => {
    __setCurrentUser(
      makeCurrentUserOutput(
        makeStylistCurrentUser({ account: { account_id: ACCOUNT_ID } })
      )
    );
    __setPermission(true);
  });

  it('saves the order for the session account and answers 200', async () => {
    const db = installDb(['gr_1', 'gr_2']);

    const { status, event, data } = await mockApiHandler<{
      success: boolean;
      gallery_record_ids: string[];
    }>(handler, {
      method: 'POST',
      body: {
        gallery_record_ids: ['gr_2', 'gr_1'],
        // Ignored: the account always comes from the session.
        stylist_account_id: OTHER_ACCOUNT_ID,
      },
    });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.GALLERY.GALLERY_PINNED_ORDER_UPDATED);
    expect(data).toEqual({
      success: true,
      gallery_record_ids: ['gr_2', 'gr_1'],
    });
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]?.values).toEqual(['gr_2', 0, 'gr_1', 1, ACCOUNT_ID]);
    expect(db.writes[0]?.values).not.toContain(OTHER_ACCOUNT_ID);
  });

  it('a list that no longer matches her pinned set → 409 STALE, nothing written', async () => {
    const db = installDb(['gr_1', 'gr_2', 'gr_3']);

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: { gallery_record_ids: ['gr_2', 'gr_1'] },
    });

    expect(status).toBe(409);
    expect(event).toBe(APP_EVENTS.INFO.GALLERY.GALLERY_PINNED_ORDER_STALE);
    expect(db.writes).toHaveLength(0);
  });

  it('duplicate ids are refused by the validator before the database', async () => {
    const db = installDb(['gr_1', 'gr_2']);

    const { status } = await mockApiHandler(handler, {
      method: 'POST',
      body: { gallery_record_ids: ['gr_1', 'gr_1'] },
    });

    expect(status).toBe(400);
    expect(db.reads()).toBe(0);
    expect(db.writes).toHaveLength(0);
  });

  it('a client account is refused with 403 WRONG_ACCOUNT_TYPE', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    const db = installDb(['gr_1']);

    const { status, data } = await mockApiHandler<{ reason: string }>(handler, {
      method: 'POST',
      body: { gallery_record_ids: ['gr_1'] },
    });

    expect(status).toBe(403);
    expect(data.reason).toBe('WRONG_ACCOUNT_TYPE');
    expect(db.writes).toHaveLength(0);
  });
});
