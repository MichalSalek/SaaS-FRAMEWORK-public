/**
 * Contract test for favorite/remove-record (the first handler migrated to `defineHandler`).
 *
 * Two properties are pinned here, and neither may be faked by the seam:
 *   - the REAL permission matrix decides (no `__setPermission(true)`): a client may remove her
 *     like, a stylist is refused by RBAC before any business logic runs;
 *   - the delete is scoped to the CALLER: the `favoriteGalleryRecord.deleteMany` stub applies the
 *     `where` it receives to an in-memory table that also holds another client's like on the same
 *     record. Dropping `client_user_id` from the operation's predicate deletes that row and turns
 *     these tests red. The same boundary is proven on real Postgres by the access suite
 *     (tests/access, probe "clientB removes a like that belongs to clientA").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/favorite/remove-record/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser } from '../setup';
import {
  makeCurrentUserOutput,
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../fixtures';

type FavoriteRow = { client_user_id: string; gallery_record_id: string };
type FavoriteWhere = Partial<FavoriteRow>;

const RECORD = 'gr_test';
const CALLER = makeClientCurrentUser();
const OTHER_CLIENT_ID = 'usr_other_client_0000000009';

const matches = (row: FavoriteRow, where: FavoriteWhere): boolean =>
  (Object.keys(where) as (keyof FavoriteRow)[]).every(
    key => where[key] === undefined || row[key] === where[key]
  );

/** An in-memory FavoriteGalleryRecord table whose deleteMany honours `where`. */
const favoritesTable = (rows: FavoriteRow[]) => {
  const state = { rows: [...rows], wheres: [] as FavoriteWhere[] };
  mockDb({
    galleryRecord: {
      findUnique: async () => ({
        created_by_account_id: 'acc_test',
        is_hidden: false,
      }),
    },
    favoriteGalleryRecord: {
      deleteMany: async (args: { where: FavoriteWhere }) => {
        state.wheres.push(args.where);
        const before = state.rows.length;
        state.rows = state.rows.filter(row => !matches(row, args.where));
        return { count: before - state.rows.length };
      },
    },
  });
  return state;
};

const callRemove = () =>
  mockApiHandler<{ success: boolean }>(handler, {
    method: 'POST',
    body: { gallery_record_id: RECORD },
  });

describe('favorite/remove-record', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(CALLER));
  });

  it('removes only the caller like → 200 + RECORD_REMOVED_FROM_FAVORITES, the other client keeps hers', async () => {
    const table = favoritesTable([
      { client_user_id: CALLER.id, gallery_record_id: RECORD },
      { client_user_id: OTHER_CLIENT_ID, gallery_record_id: RECORD },
    ]);

    const { status, event, data } = await callRemove();

    expect(status).toBe(200);
    expect(event).toBe('RECORD_REMOVED_FROM_FAVORITES');
    expect(data).toEqual({ success: true });
    expect(table.wheres).toEqual([
      { client_user_id: CALLER.id, gallery_record_id: RECORD },
    ]);
    expect(table.rows).toEqual([
      { client_user_id: OTHER_CLIENT_ID, gallery_record_id: RECORD },
    ]);
  });

  it('caller has no like, another client has one → 200 + RECORD_NOT_IN_FAVORITES and nothing is deleted', async () => {
    const table = favoritesTable([
      { client_user_id: OTHER_CLIENT_ID, gallery_record_id: RECORD },
    ]);

    const { status, event, data } = await callRemove();

    expect(status).toBe(200);
    expect(event).toBe('RECORD_NOT_IN_FAVORITES');
    expect(data).toEqual({ success: true });
    expect(table.rows).toEqual([
      { client_user_id: OTHER_CLIENT_ID, gallery_record_id: RECORD },
    ]);
  });

  it('stylist role → 403 from the real permission matrix, no database access', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    // No mockDb: any database access throws "not mocked", so a 403 here is the RBAC verdict.
    const { status } = await callRemove();
    expect(status).toBe(403);
  });
});
