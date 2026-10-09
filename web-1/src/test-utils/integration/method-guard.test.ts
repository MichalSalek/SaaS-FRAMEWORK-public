/**
 * Integration-handler test — HTTP method guard (characterization).
 *
 * BDX W0.3 (część A): pins the CURRENT behavior of the method-validation step
 * (HTTPRequestHandlerMiddleware step 3) BEFORE the FAZA 2 standardization.
 *
 * A Command handler declares `contestedHTTPMethod: 'post'`. The middleware rejects
 * any other verb — BEFORE auth/permission/validation run (so neither a user nor a
 * permission needs to be set for the negative case). We use favorite/remove-record
 * (a simple POST command) as the subject; the guard is shared, so any Command
 * handler behaves identically.
 *
 * FAZA 2 LANDED — the harness quirk this file used to pin is GONE:
 * the gate previously answered `res.status(405).send(null)`. node-mocks-http cannot
 * serialize `.send(null)` (its `_formatData` throws), so the throw bubbled into the
 * middleware's outer catch and the harness observed 500 GENERAL_ERROR — a mock
 * artifact that masked the real 405. The gate now answers through the canonical
 * `respondMethodNotAllowed` helper (405 + `{event,data}` envelope + `Allow` header),
 * exactly the flip the previous header predicted, so the assert is now the clean,
 * real contract. Do NOT "restore" 500 here — it was never the wire behaviour.
 *
 * Gate = positive + negative:
 *   - NEGATIVE: GET is rejected at the method gate → 405 ACCESS_DENIED_INFO,
 *     `data.allowed` naming the accepted verb; business logic is never reached.
 *   - POSITIVE: POST passes the method gate (status is NOT 405 — it proceeds to
 *     auth/permission/business logic → 200). A mutation of the asserted status
 *     would go red.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/favorite/remove-record/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

describe('HTTP method guard (favorite/remove-record handler integration)', () => {
  it('NEGATIVE — GET on a POST-only command is rejected at the method gate', async () => {
    // No auth/permission/DB mock set: the method guard (step 3) fires before auth
    // (step 5) and business logic (step 9). If GET had slipped past the gate, the
    // unmocked DB access in removeRecordFromFavorites_IO would throw a distinctive
    // "not mocked" error — it does not, proving the gate rejected the verb.
    const { status, event, data } = await mockApiHandler(handler, {
      method: 'GET',
    });

    expect(status).toBe(405);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO);
    // The rejection names the verb the route DOES accept (RFC 9110 §15.5.6 — the
    // `Allow` header carries the same value; this asserts the body twin of it).
    expect(data).toEqual({ allowed: 'POST' });
  });

  describe('POSITIVE — the contested verb (POST) passes the method gate', () => {
    beforeEach(() => {
      __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
      __setPermission(true);
    });

    it('POST proceeds past the method gate (status is not 405)', async () => {
      mockDb({
        // removeRecordFromFavorites_IO (SA-lock atomic form): galleryRecord.findUnique resolves
        // the owner + is_hidden, lockStylistAccount takes the SA-first FOR UPDATE lock (return
        // ignored), then favoriteGalleryRecord.deleteMany. deleteMany count:1 + is_hidden:false →
        // success(true) → 200 (the floored decrement is a tx.$executeRaw no-op in the mock).
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

      const { status } = await mockApiHandler(handler, {
        method: 'POST',
        body: { gallery_record_id: 'gr_test_0000000000000001' },
      });

      // The gate let POST through — whatever the downstream outcome, it is NOT a
      // 405 method-not-allowed. (Here it reaches business logic → 200 success.)
      expect(status).not.toBe(405);
      expect(status).toBe(200);
    });
  });
});
