// tests/concurrency/gallery-delete-moderation.concurrency.ts
//
// FAMILY 2 — gallery-delete ⊥ moderation HIDE (ABBA 40P01, finding ioA-1).
//
// THE BUG (pre-fix): gallery-delete locked GalleryRecord first (tx.galleryRecord.delete)
// THEN StylistAccount (counter decrement) = lock order GR→SA. moderation resolve-report
// locks StylistAccount first THEN the record = SA→GR. Run concurrently on the SAME
// account they form an ABBA cycle → Postgres 40P01 deadlock → unmapped 500.
//
// THE FIX: gallery-delete now lockStylistAccount(tx, account_id) SA-FIRST + withWriteTx
// deadlock-retry, matching moderation's SA→GR order. The cross-op deadlock axis is
// eliminated by construction; the residual cascade axis (likes) is covered by retry.
//
// THE RACE we fire: the stylist's own DELETE_GALLERY_RECORD ⊥ an admin
// ADMIN_RESOLVE_REPORT{action:HIDE} on the SAME record — both real HTTP endpoints, so
// fireParallel gives true parallelism (start-barrier). We loop so both interleavings,
// and the same-account lock contention, recur.
//
// INVARIANT (must ALWAYS hold; the pre-fix code surfaced a 500 = RED):
//   1. assertNo500 — no 40P01 ever leaks as a server error.
//   2. checkCountInvariant(stylist.accountId) EMPTY after the race — cached_gallery_count
//      == COUNT(visible GalleryRecord) and cached_likes_count == likes-of-visible. A
//      deleted record drops its row; a hidden record sets is_hidden=true (drops out of
//      the visible count). Either outcome must leave cached == live; the floored
//      decrements in both operations keep the counters non-negative under double-action.
//   3. The reported record ends up GONE (deleted) or HIDDEN — never left visible.

import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { fireParallel, getAdminToken } from '../utils/api-client';
import { dbQueryOne } from '../utils/db-client';
import { checkCountInvariant } from '../utils/db-client';
import { test, assertTrue } from './_harness';
import {
  createEphemeralStylist,
  createEphemeralClient,
  seedGalleryRecord,
  seedLike,
  seedContentReport,
  setCachedCounts,
  type EphemeralClient,
} from './_fixtures';

/** Read a gallery record's existence + visibility for post-race end-state assertions. */
const readRecord = async (
  recordId: string
): Promise<{ is_hidden: boolean } | null> =>
  dbQueryOne<{ is_hidden: boolean }>(
    `SELECT is_hidden FROM "GalleryRecord" WHERE gallery_record_id = $1`,
    [recordId]
  );

/** A record is "resolved" iff it no longer counts as visible: row gone OR is_hidden. */
const recordResolved = (row: { is_hidden: boolean } | null): boolean =>
  row == null || row.is_hidden === true;

/** Seed one visible record liked by every given client; returns its id + like count. */
const seedVisibleLikedRecord = async (
  accountId: string,
  clients: EphemeralClient[]
): Promise<{ recordId: string; likes: number }> => {
  const recordId = await seedGalleryRecord(accountId, { isHidden: false });
  for (const c of clients) {
    await seedLike(c.userId, recordId);
  }
  return { recordId, likes: clients.length };
};

test(
  'gallery-delete racing moderation HIDE on the same record: no 500, counters stay consistent',
  async () => {
    const stylist = await createEphemeralStylist('gd-hide');
    const adminToken = await getAdminToken();
    // Two distinct likers so the likes-counter decrement path carries weight (>1).
    const likers = [
      await createEphemeralClient('gd-liker-a'),
      await createEphemeralClient('gd-liker-b'),
    ];
    const ITER = 12;

    for (let i = 0; i < ITER; i++) {
      // FRESH record each round (prior rounds' records are gone/hidden → not visible).
      const { recordId, likes } = await seedVisibleLikedRecord(
        stylist.accountId,
        likers
      );
      // Cached counters match LIVE before the race: exactly this one visible record
      // (+ its likes); every earlier round's record is non-visible so contributes 0.
      await setCachedCounts(stylist.accountId, {
        gallery: 1,
        likes,
        bookmark: 0,
      });
      const reportId = await seedContentReport(likers[0]!.userId, recordId);

      const responses = await fireParallel([
        {
          endpoint: ROUTES_API.DELETE_GALLERY_RECORD,
          method: 'POST',
          token: stylist.token,
          body: { gallery_record_id: recordId },
        },
        {
          endpoint: ROUTES_API.ADMIN_RESOLVE_REPORT,
          method: 'POST',
          token: adminToken,
          body: { report_id: reportId, action: 'HIDE' },
        },
      ]);

      // No 40P01 may surface as a 5xx (the ABBA deadlock the fix eliminated).
      assertTrue(
        responses.every(r => r.status < 500),
        `iter ${i}: server error (possible 40P01 leak): ${JSON.stringify(
          responses.map(r => ({ s: r.status, b: r.body }))
        )}`
      );

      const violations = await checkCountInvariant(stylist.accountId);
      assertTrue(
        violations.length === 0,
        `iter ${i}: counter drift after race: ${JSON.stringify(violations)}`
      );

      const row = await readRecord(recordId);
      assertTrue(
        recordResolved(row),
        `iter ${i}: record left visible after delete⊥HIDE: ${JSON.stringify(row)}`
      );
    }
  },
  'ioA-1 gallery-delete SA-first lock order (delete ⊥ moderation HIDE)'
);

test(
  'burst of N delete⊥HIDE pairs on ONE account: max SA contention, no deadlock leak',
  async () => {
    // All records on a SINGLE account → every delete and every HIDE contends for the
    // same StylistAccount row. Inconsistent lock order would deadlock here with high
    // probability; SA-first ordering serializes them cleanly.
    const stylist = await createEphemeralStylist('gd-burst');
    const adminToken = await getAdminToken();
    const liker = await createEphemeralClient('gd-burst-liker');
    const N = 5;

    const records: string[] = [];
    const reports: string[] = [];
    for (let k = 0; k < N; k++) {
      const { recordId } = await seedVisibleLikedRecord(stylist.accountId, [
        liker,
      ]);
      records.push(recordId);
      reports.push(await seedContentReport(liker.userId, recordId));
    }
    // Live before race: N visible records, each with 1 like.
    await setCachedCounts(stylist.accountId, {
      gallery: N,
      likes: N,
      bookmark: 0,
    });

    const specs = records.flatMap((recordId, k) => [
      {
        endpoint: ROUTES_API.DELETE_GALLERY_RECORD,
        method: 'POST' as const,
        token: stylist.token,
        body: { gallery_record_id: recordId },
      },
      {
        endpoint: ROUTES_API.ADMIN_RESOLVE_REPORT,
        method: 'POST' as const,
        token: adminToken,
        body: { report_id: reports[k]!, action: 'HIDE' },
      },
    ]);

    const responses = await fireParallel(specs);
    assertTrue(
      responses.every(r => r.status < 500),
      `burst: server error (possible 40P01 leak): ${JSON.stringify(
        responses.map(r => ({ s: r.status, b: r.body }))
      )}`
    );

    // Every record must end non-visible; counters reconciled (all visible → 0).
    for (const recordId of records) {
      const row = await readRecord(recordId);
      assertTrue(
        recordResolved(row),
        `burst: record ${recordId} left visible: ${JSON.stringify(row)}`
      );
    }
    const violations = await checkCountInvariant(stylist.accountId);
    assertTrue(
      violations.length === 0,
      `burst: counter drift after race: ${JSON.stringify(violations)}`
    );
  },
  'ioA-1 gallery-delete ⊥ moderation HIDE (N-pair same-account burst)'
);

test(
  'DETERMINISTIC delete-then-HIDE: stylist deletes, admin closes the orphaned report cleanly',
  async () => {
    const stylist = await createEphemeralStylist('gd-seq-del');
    const adminToken = await getAdminToken();
    const liker = await createEphemeralClient('gd-seq-del-liker');
    const { recordId, likes } = await seedVisibleLikedRecord(stylist.accountId, [
      liker,
    ]);
    await setCachedCounts(stylist.accountId, { gallery: 1, likes, bookmark: 0 });
    const reportId = await seedContentReport(liker.userId, recordId);

    // 1) Stylist deletes the record (row gone, report.gallery_record_id SetNull).
    const [del] = await fireParallel([
      {
        endpoint: ROUTES_API.DELETE_GALLERY_RECORD,
        method: 'POST',
        token: stylist.token,
        body: { gallery_record_id: recordId },
      },
    ]);
    assertTrue(
      del!.status === 200,
      `delete expected 200, got ${del!.status}: ${JSON.stringify(del!.body)}`
    );

    // 2) Admin HIDE on the now-orphaned report: must NOT 500 — the operation downgrades
    //    to a no-op WARN (record gone) and closes the stale report.
    const [hide] = await fireParallel([
      {
        endpoint: ROUTES_API.ADMIN_RESOLVE_REPORT,
        method: 'POST',
        token: adminToken,
        body: { report_id: reportId, action: 'HIDE' },
      },
    ]);
    assertTrue(
      hide!.status < 500,
      `HIDE-on-orphan expected non-5xx, got ${hide!.status}: ${JSON.stringify(hide!.body)}`
    );

    assertTrue((await readRecord(recordId)) == null, 'record row should be gone');
    const violations = await checkCountInvariant(stylist.accountId);
    assertTrue(
      violations.length === 0,
      `counter drift after delete-then-HIDE: ${JSON.stringify(violations)}`
    );
  },
  'ioA-1 cross-op counter consistency (delete wins)'
);

test(
  'DETERMINISTIC HIDE-then-delete: admin hides, stylist deletes the hidden record',
  async () => {
    const stylist = await createEphemeralStylist('gd-seq-hide');
    const adminToken = await getAdminToken();
    const liker = await createEphemeralClient('gd-seq-hide-liker');
    const { recordId, likes } = await seedVisibleLikedRecord(stylist.accountId, [
      liker,
    ]);
    await setCachedCounts(stylist.accountId, { gallery: 1, likes, bookmark: 0 });
    const reportId = await seedContentReport(liker.userId, recordId);

    // 1) Admin HIDE: record → is_hidden=true; gallery+likes counters decremented.
    const [hide] = await fireParallel([
      {
        endpoint: ROUTES_API.ADMIN_RESOLVE_REPORT,
        method: 'POST',
        token: adminToken,
        body: { report_id: reportId, action: 'HIDE' },
      },
    ]);
    assertTrue(
      hide!.status === 200,
      `HIDE expected 200, got ${hide!.status}: ${JSON.stringify(hide!.body)}`
    );
    const hidden = await readRecord(recordId);
    assertTrue(
      hidden?.is_hidden === true,
      `record should be hidden after HIDE: ${JSON.stringify(hidden)}`
    );

    // 2) Stylist deletes the now-hidden record: its likes were already removed from the
    //    counter at HIDE, so the delete's visibility-gated likes decrement must subtract 0.
    const [del] = await fireParallel([
      {
        endpoint: ROUTES_API.DELETE_GALLERY_RECORD,
        method: 'POST',
        token: stylist.token,
        body: { gallery_record_id: recordId },
      },
    ]);
    assertTrue(
      del!.status === 200,
      `delete expected 200, got ${del!.status}: ${JSON.stringify(del!.body)}`
    );

    assertTrue((await readRecord(recordId)) == null, 'record row should be gone');
    const violations = await checkCountInvariant(stylist.accountId);
    assertTrue(
      violations.length === 0,
      `counter drift after HIDE-then-delete: ${JSON.stringify(violations)}`
    );
  },
  'ioA-1 cross-op counter consistency (HIDE wins, hidden-delete subtracts 0 likes)'
);

test(
  'DETERMINISTIC RED→GREEN: deleting a HIDDEN record must NOT decrement cached_gallery_count (no double-decrement)',
  async () => {
    // This is the guard for finding gallery-count-double-decrement. The single-record
    // HIDE-then-delete above reconciles to 0 where the floor (GREATEST(0,…)) MASKS a
    // double-decrement. To expose it we keep a SECOND visible record so the counter
    // stays off the floor: seed A(visible)+B(visible) → cache gallery=2; HIDE B (counter
    // → 1, live visible = {A} = 1); then DELETE the hidden B.
    //   pre-fix (unconditional decrement): cache 1 → 0, but live visible = 1 (A) → DRIFT.
    //   post-fix (visibility-gated): B is hidden → subtract 0 → cache stays 1 == live. GREEN.
    const stylist = await createEphemeralStylist('gd-hidden-del');
    const adminToken = await getAdminToken();

    const recordA = await seedGalleryRecord(stylist.accountId, { isHidden: false });
    const recordB = await seedGalleryRecord(stylist.accountId, { isHidden: false });
    await setCachedCounts(stylist.accountId, { gallery: 2, likes: 0, bookmark: 0 });
    const reportB = await seedContentReport(stylist.userId, recordB);

    // 1) Admin HIDE B → is_hidden=true, cached_gallery_count decremented to 1.
    const [hide] = await fireParallel([
      {
        endpoint: ROUTES_API.ADMIN_RESOLVE_REPORT,
        method: 'POST',
        token: adminToken,
        body: { report_id: reportB, action: 'HIDE' },
      },
    ]);
    assertTrue(
      hide!.status === 200,
      `HIDE expected 200, got ${hide!.status}: ${JSON.stringify(hide!.body)}`
    );
    const afterHide = await checkCountInvariant(stylist.accountId);
    assertTrue(
      afterHide.length === 0,
      `invariant should hold after HIDE (cache 1 == visible {A}): ${JSON.stringify(afterHide)}`
    );

    // 2) Stylist DELETEs the already-hidden B. Must subtract 0 from cached_gallery_count
    //    (B was no longer in the visible count). A remains visible → counter must read 1.
    const [del] = await fireParallel([
      {
        endpoint: ROUTES_API.DELETE_GALLERY_RECORD,
        method: 'POST',
        token: stylist.token,
        body: { gallery_record_id: recordB },
      },
    ]);
    assertTrue(
      del!.status === 200,
      `delete expected 200, got ${del!.status}: ${JSON.stringify(del!.body)}`
    );

    // The crux: cached_gallery_count must equal the live visible count (1 = recordA),
    // NOT 0. On the pre-fix unconditional decrement this drifts to 0 → invariant RED.
    const violations = await checkCountInvariant(stylist.accountId);
    assertTrue(
      violations.length === 0,
      `DOUBLE-DECREMENT DRIFT: deleting a hidden record wrongly decremented cached_gallery_count: ${JSON.stringify(violations)}`
    );
    const cached = await dbQueryOne<{ cached_gallery_count: number }>(
      `SELECT cached_gallery_count FROM "StylistAccount" WHERE account_id = $1`,
      [stylist.accountId]
    );
    assertTrue(
      cached?.cached_gallery_count === 1,
      `expected cached_gallery_count=1 (recordA still visible), got ${cached?.cached_gallery_count}`
    );
    // recordA must remain visible (it is the live visible count the cache must match).
    const aRow = await readRecord(recordA);
    assertTrue(
      aRow?.is_hidden === false,
      `recordA must stay visible: ${JSON.stringify(aRow)}`
    );
  },
  'gallery-count-double-decrement: hidden-record delete subtracts 0 (visibility-gated)'
);

// Tests register on import; run-concurrency.ts orchestrates execution + teardown.
