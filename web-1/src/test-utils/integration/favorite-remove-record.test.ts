/**
 * Pilot contract test for BDX W2.1 `defineHandler`.
 *
 * favorite/remove-record was the first handler migrated from the inline
 * `HTTPRequestHandlerMiddleware` + `withTimingNextHandlerMiddleware(handler)` scaffold
 * to `defineHandler({...})`. This proves the composer preserves the HTTP contract
 * (status + envelope + per-branch event) byte-identically: both the "removed" and the
 * idempotent "not-in-favorites" branch must still answer 200 with their own event.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/favorite/remove-record/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import {
  makeCurrentUserOutput,
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../fixtures';

describe('defineHandler pilot — favorite/remove-record', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    __setPermission(true);
  });

  it('deleted (count>0) → 200 + RECORD_REMOVED_FROM_FAVORITES', async () => {
    mockDb({
      // removeRecordFromFavorites_IO (SA-lock atomic form, finding fav-drift-1): resolves the
      // record owner (galleryRecord.findUnique → created_by_account_id), takes the SA-first lock
      // (lockStylistAccount → tx.$queryRaw FOR UPDATE, return ignored → no-op default is fine),
      // re-reads is_hidden UNDER the lock, then favoriteGalleryRecord.deleteMany. The floored
      // decrement is a tx.$executeRaw (no-op default). deleteMany count:1 + is_hidden:false → a
      // visible favorite was removed → success(true) → RECORD_REMOVED_FROM_FAVORITES.
      galleryRecord: {
        findUnique: async () => ({
          created_by_account_id: 'acc_test',
          is_hidden: false,
        }),
      },
      favoriteGalleryRecord: {
        deleteMany: async () => ({ count: 1 }),
      },
    });

    const { status, event, data } = await mockApiHandler<{ success: boolean }>(
      handler,
      { method: 'POST', body: { gallery_record_id: 'gr_test' } }
    );

    expect(status).toBe(200);
    expect(event).toBe('RECORD_REMOVED_FROM_FAVORITES');
    expect(data).toEqual({ success: true });
  });

  it('idempotent (count=0) → 200 + RECORD_NOT_IN_FAVORITES', async () => {
    mockDb({
      // Record exists but the client has no favorite row on it → deleteMany returns count:0
      // (NOT a P2025 throw; the SA-lock form handles the no-row case in-tx, return false) →
      // removeRecordFromFavorites_IO returns success(false) → RECORD_NOT_IN_FAVORITES
      // (parytet unbookmarkStylist_IO). No decrement fires (count !== 1).
      galleryRecord: {
        findUnique: async () => ({
          created_by_account_id: 'acc_test',
          is_hidden: false,
        }),
      },
      favoriteGalleryRecord: {
        deleteMany: async () => ({ count: 0 }),
      },
    });

    const { status, event, data } = await mockApiHandler<{ success: boolean }>(
      handler,
      { method: 'POST', body: { gallery_record_id: 'gr_test' } }
    );

    expect(status).toBe(200);
    expect(event).toBe('RECORD_NOT_IN_FAVORITES');
    expect(data).toEqual({ success: true });
  });

  it('wrong account type (stylist) → not 2xx (account guard)', async () => {
    // A stylist has no client_account → requireClientAccount fails → mapped to 4xx.
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    const { status } = await mockApiHandler(handler, {
      method: 'POST',
      body: { gallery_record_id: 'gr_test' },
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });
});
