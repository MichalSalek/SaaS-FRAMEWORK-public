/**
 * HAPPY-PATH coverage for endpoints that until now had ONLY negative-path tests.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A 401/403/400 test returns BEFORE the handler ever reaches its transaction, so
 * it proves nothing about the work the endpoint actually does. That blind spot is
 * how a 500 on visit creation survived from 2 September and how
 * CLIENT_GET_CONTACT_FOR_STYLIST shipped broken. Every test here therefore:
 *
 *   1. WRITES a value, then READS IT BACK and compares the value it wrote
 *      (not merely "status 200" / "field exists").
 *   2. Follows an access-granted path with the MIRROR negative once access is
 *      gone (revoked pair, foreign owner, immutable role) — a 200 alone never
 *      proves the gate is wired at all.
 *   3. Cleans up what it created, so the suite stays re-runnable. Where the API
 *      exposes no delete, the test uses a FRESH IDENTITY per run instead; each
 *      such case says so at the call site.
 *
 * Wired from coverage-gap.smoke.ts (the smoke suite's entry point for
 * gap-closing coverage) rather than from run-smoke-tests.ts.
 *
 * DELIBERATELY NOT COVERED HERE (reasons, so nobody re-opens the question):
 *   • PAIR_REQUEST_CREATE — already has a genuine happy path with value
 *     assertions in pair-request.smoke.ts (status PENDING, pair_id reuse,
 *     `created:false` on the idempotent repeat, no duplicate pending row).
 *   • ADMIN_UPDATE_PERMISSIONS — a 200 is UNREACHABLE through the API (every
 *     seeded Role is is_system=true and the operation rejects those; no endpoint
 *     creates a custom role). Covered instead by proving the guard runs before
 *     the destructive deleteMany — see section 7.
 *   • DELETE_ASSET_FROM_VENDOR — its only success path physically deletes a
 *     Cloudinary asset, dev has no Cloudinary credentials configured, and the
 *     operation itself carries a DECISION saying it has no consumer and two
 *     contradictory intended contracts. A happy-path test here would invent the
 *     contract instead of testing one.
 */

import {
  test,
  apiCall,
  getData,
  assert,
  extractSessionToken,
} from './_test-utils';
import type { TestContext } from './_test-utils';
import { ensureActivePair, revokePairQuietly } from './_pair-fixture';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { MODERATION_DTO_API_V1 } from '@kernel/models/moderation/moderation.dto';
import { ModerationAction } from '@kernel/models/moderation/moderation.dto';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import {
  AccountTypeValue,
  ContentReportReasonValue,
  ContentReportStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { TRAIT_CATEGORIES } from '@kernel/domain/admin/traits.config';
import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import type { EMAIL_DTO_API_V1 } from '@kernel/models/email/email.dto';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import { createHmac } from 'crypto';
import { fromBackendEnv } from '../utils/backend-env';

// ============================================================================
// LOCAL HELPERS
// ============================================================================

/** Stable, order-independent fingerprint of a junction list — colors/traits come
 *  back in DB order, so a raw array compare would be flaky, not strict. */
const idFingerprint = (rows: ReadonlyArray<{ id: string }>): string =>
  rows
    .map(r => r.id)
    .sort()
    .join(',');

type DictionaryIds = { colorA: string; colorB: string; traitA: string; traitB: string };

/** Two DISTINCT colors and two DISTINCT traits from the live dictionary.
 *  Distinctness is the whole point: an update that swaps A→B can only be proven
 *  by values that differ. */
const getTwoOfEach = async (token: string): Promise<DictionaryIds> => {
  const colorsRes = await apiCall({
    endpoint: ROUTES_API.GET_COLORS,
    token,
  });
  assert.status(colorsRes, 200);
  const colors = getData<GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE']>(colorsRes);

  const traitsRes = await apiCall({
    endpoint: ROUTES_API.GET_TRAITS,
    token,
  });
  assert.status(traitsRes, 200);
  const traits = getData<GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE']>(traitsRes);

  if (colors.length < 2 || traits.length < 2) {
    throw new Error(
      `Need >=2 active colors and >=2 active traits to prove a junction swap; got ${colors.length} colors / ${traits.length} traits. Seed the dictionary.`
    );
  }
  return {
    colorA: colors[0]!.id,
    colorB: colors[1]!.id,
    traitA: traits[0]!.id,
    traitB: traits[1]!.id,
  };
};

/** Create a gallery record owned by the given stylist token; returns its id. */
const createRecord = async (
  token: string,
  props: { color_id: string; trait_id: string; nail_length: string; tag: string }
): Promise<string> => {
  const body: GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST'] = {
    asset_url: `https://res.cloudinary.com/${props.tag}-${Date.now()}.jpg`,
    color_ids: [props.color_id],
    trait_ids: [props.trait_id],
    nail_length: props.nail_length as GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST']['nail_length'],
  };
  const res = await apiCall({
    endpoint: ROUTES_API.CREATE_GALLERY_RECORD,
    method: 'POST',
    token,
    body,
  });
  if (res.status !== 201) {
    throw new Error(
      `Fixture gallery record creation failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`
    );
  }
  return getData<GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['RESPONSE']>(res)
    .gallery_record_id;
};

/** Delete a gallery record; never throws (cleanup must not mask the real failure). */
const deleteRecordQuietly = async (
  token: string,
  galleryRecordId: string | null
): Promise<void> => {
  if (!galleryRecordId) {
    return;
  }
  try {
    await apiCall({
      endpoint: ROUTES_API.DELETE_GALLERY_RECORD,
      method: 'POST',
      token,
      body: { gallery_record_id: galleryRecordId },
    });
  } catch {
    /* intentionally silent */
  }
};

/** Read a record back through the authenticated detail query. */
const readRecord = async (
  token: string,
  galleryRecordId: string
): Promise<GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['RESPONSE']> => {
  const res = await apiCall({
    endpoint: `${ROUTES_API.GET_GALLERY_RECORD_BY_ID}?gallery_record_id=${encodeURIComponent(galleryRecordId)}`,
    token,
  });
  assert.status(res, 200);
  return getData<GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['RESPONSE']>(res);
};

/** Look a color up in the picker the stylist actually reads (GET_COLORS filters
 *  on is_active, so this also proves the row is CURATED, not merely present). */
const findColor = async (
  token: string,
  colorId: string
): Promise<GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE'][number] | undefined> => {
  const res = await apiCall({ endpoint: ROUTES_API.GET_COLORS, token });
  assert.status(res, 200);
  return getData<GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE']>(res).find(
    c => c.id === colorId
  );
};

/** Same for traits. */
const findTrait = async (
  token: string,
  traitId: string
): Promise<GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE'][number] | undefined> => {
  const res = await apiCall({ endpoint: ROUTES_API.GET_TRAITS, token });
  assert.status(res, 200);
  return getData<GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE']>(res).find(
    t => t.id === traitId
  );
};

/** Mint a brand-new user via dev-login. Fresh identity per run — the caller says why. */
const mintFreshUser = async (
  emailPrefix: string
): Promise<{ token: string; userId: string; email: string }> => {
  const email = `${emailPrefix}-${Date.now()}@example.com`;
  const res = await apiCall({
    endpoint: '/api/auth/dev-login',
    method: 'POST',
    body: { email },
  });
  assert.status(res, 200);
  const userId = getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(res).id;
  return { token: extractSessionToken(res), userId, email };
};

// ============================================================================
// 1. UPDATE_GALLERY_RECORD — highest risk: $transaction, junction replace
// ============================================================================

const runUpdateGalleryRecordTests = async (ctx: TestContext): Promise<void> => {
  const dict = await getTwoOfEach(ctx.stylistToken);

  // ── 1a. Full update: every field we write must come back changed, and must
  //        still be changed when re-read from the DB (proves the TX committed).
  await test('UPDATE_GALLERY_RECORD_PERSISTS_WRITTEN_VALUES', async () => {
    let recordId: string | null = null;
    try {
      recordId = await createRecord(ctx.stylistToken, {
        color_id: dict.colorA,
        trait_id: dict.traitA,
        nail_length: NAIL_LENGTHS.SHORT,
        tag: 'upd-full',
      });

      const updateBody: GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['REQUEST'] =
        {
          gallery_record_id: recordId,
          color_ids: [dict.colorB],
          trait_ids: [dict.traitB],
          nail_length: NAIL_LENGTHS.LONG,
        };
      const updateRes = await apiCall({
        endpoint: ROUTES_API.UPDATE_GALLERY_RECORD,
        method: 'POST',
        token: ctx.stylistToken,
        body: updateBody,
      });
      assert.status(updateRes, 200);
      const updated =
        getData<GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['RESPONSE']>(
          updateRes
        );

      // Response echoes exactly what we wrote — not "a nail_length", THE one.
      assert.equals(
        updated.gallery_record_id,
        recordId,
        'response must echo the same record id'
      );
      assert.equals(
        updated.nail_length,
        NAIL_LENGTHS.LONG,
        `nail_length in response should be ${NAIL_LENGTHS.LONG}`
      );
      assert.equals(
        idFingerprint(updated.colors),
        dict.colorB,
        'colors in response must be exactly the one color we wrote (old one replaced)'
      );
      assert.equals(
        idFingerprint(updated.traits),
        dict.traitB,
        'traits in response must be exactly the one trait we wrote (old one replaced)'
      );

      // Read-back: the DB, not the handler's in-memory return value.
      const persisted = await readRecord(ctx.stylistToken, recordId);
      assert.equals(
        persisted.gallery_record.nail_length,
        NAIL_LENGTHS.LONG,
        'persisted nail_length must equal the value written'
      );
      assert.equals(
        idFingerprint(persisted.gallery_record.colors),
        dict.colorB,
        'persisted colors must equal the ids written (junction replace committed)'
      );
      assert.equals(
        idFingerprint(persisted.gallery_record.traits),
        dict.traitB,
        'persisted traits must equal the ids written (junction replace committed)'
      );
    } finally {
      await deleteRecordQuietly(ctx.stylistToken, recordId);
    }
  });

  // ── 1b. Partial update: omitted junctions must be LEFT ALONE. The operation
  //        only replaces a junction when its key is present in the body; a
  //        regression to "always deleteMany" would silently wipe colors/traits
  //        on every nail_length-only save from the UI.
  await test('UPDATE_GALLERY_RECORD_PARTIAL_LEAVES_JUNCTIONS_INTACT', async () => {
    let recordId: string | null = null;
    try {
      recordId = await createRecord(ctx.stylistToken, {
        color_id: dict.colorA,
        trait_id: dict.traitA,
        nail_length: NAIL_LENGTHS.SHORT,
        tag: 'upd-partial',
      });

      const updateRes = await apiCall({
        endpoint: ROUTES_API.UPDATE_GALLERY_RECORD,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          gallery_record_id: recordId,
          nail_length: NAIL_LENGTHS.XL,
        } satisfies GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['REQUEST'],
      });
      assert.status(updateRes, 200);
      const updated =
        getData<GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['RESPONSE']>(
          updateRes
        );

      assert.equals(
        updated.nail_length,
        NAIL_LENGTHS.XL,
        `nail_length should be updated to ${NAIL_LENGTHS.XL}`
      );
      assert.equals(
        idFingerprint(updated.colors),
        dict.colorA,
        'omitted color_ids must leave the ORIGINAL color attached'
      );
      assert.equals(
        idFingerprint(updated.traits),
        dict.traitA,
        'omitted trait_ids must leave the ORIGINAL trait attached'
      );

      const persisted = await readRecord(ctx.stylistToken, recordId);
      assert.equals(
        persisted.gallery_record.nail_length,
        NAIL_LENGTHS.XL,
        'persisted nail_length must equal the partial value written'
      );
      assert.equals(
        idFingerprint(persisted.gallery_record.colors),
        dict.colorA,
        'persisted colors must be untouched by a nail_length-only update'
      );
      assert.equals(
        idFingerprint(persisted.gallery_record.traits),
        dict.traitA,
        'persisted traits must be untouched by a nail_length-only update'
      );
    } finally {
      await deleteRecordQuietly(ctx.stylistToken, recordId);
    }
  });

  // ── 1c. MIRROR NEGATIVE for the ownership gate. The granted path above says
  //        nothing about whether the gate exists; this says a DIFFERENT stylist
  //        gets the anti-enumeration 404 AND — the part that matters — the
  //        victim's row is byte-identical afterwards.
  await test('UPDATE_GALLERY_RECORD_FOREIGN_STYLIST_MASKED_404_AND_NO_WRITE', async () => {
    let recordId: string | null = null;
    try {
      recordId = await createRecord(ctx.stylistToken, {
        color_id: dict.colorA,
        trait_id: dict.traitA,
        nail_length: NAIL_LENGTHS.MEDIUM,
        tag: 'upd-foreign',
      });

      // Fresh stylist per run: there is no API to delete a stylist account
      // synchronously, and reusing one would let a previous run's state decide
      // the result. A new identity starts from a guaranteed-clean position.
      const attacker = await mintFreshUser('temp-hpg-foreign-stylist');
      const switchRes = await apiCall({
        endpoint: ROUTES_API.USER_SWITCH_ROLE,
        method: 'POST',
        token: attacker.token,
        body: { account_type: AccountTypeValue.STYLIST },
      });
      assert.status(switchRes, 200);

      const attackRes = await apiCall({
        endpoint: ROUTES_API.UPDATE_GALLERY_RECORD,
        method: 'POST',
        token: attacker.token,
        body: {
          gallery_record_id: recordId,
          color_ids: [dict.colorB],
          trait_ids: [dict.traitB],
          nail_length: NAIL_LENGTHS.XL,
        } satisfies GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['REQUEST'],
      });
      assert.status(
        attackRes,
        404,
        'a foreign stylist must get the anti-enumeration 404, not 403'
      );

      // A ghost id must be INDISTINGUISHABLE from a real-but-foreign one.
      const ghostRes = await apiCall({
        endpoint: ROUTES_API.UPDATE_GALLERY_RECORD,
        method: 'POST',
        token: attacker.token,
        body: {
          gallery_record_id: 'ghost-record-id-that-does-not-exist',
          nail_length: NAIL_LENGTHS.XL,
        } satisfies GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['REQUEST'],
      });
      assert.equals(
        ghostRes.status,
        attackRes.status,
        'foreign-record and non-existent-record must return the same status (existence oracle)'
      );

      // The gate has to protect DATA, not just the status line.
      const untouched = await readRecord(ctx.stylistToken, recordId);
      assert.equals(
        untouched.gallery_record.nail_length,
        NAIL_LENGTHS.MEDIUM,
        'victim nail_length must be unchanged after the rejected foreign update'
      );
      assert.equals(
        idFingerprint(untouched.gallery_record.colors),
        dict.colorA,
        'victim colors must be unchanged after the rejected foreign update'
      );
      assert.equals(
        idFingerprint(untouched.gallery_record.traits),
        dict.traitA,
        'victim traits must be unchanged after the rejected foreign update'
      );
    } finally {
      await deleteRecordQuietly(ctx.stylistToken, recordId);
    }
  });
};

// ============================================================================
// 2. GALLERY_GET_FOR_PAIRED_CLIENT — cheap, the pair fixture already exists
// ============================================================================

const runPairedClientGalleryTests = async (ctx: TestContext): Promise<void> => {
  const dict = await getTwoOfEach(ctx.stylistToken);

  await test('GET_FOR_PAIRED_CLIENT_RETURNS_STYLIST_RECORD_THEN_404_AFTER_REVOKE', async () => {
    let recordId: string | null = null;
    let stylistAccountId = '';
    try {
      const pair = await ensureActivePair(ctx);
      stylistAccountId = pair.stylistAccountId;

      recordId = await createRecord(ctx.stylistToken, {
        color_id: dict.colorB,
        trait_id: dict.traitB,
        nail_length: NAIL_LENGTHS.LONG,
        tag: 'paired-gallery',
      });

      const res = await apiCall({
        endpoint: `${ROUTES_API.GALLERY_GET_FOR_PAIRED_CLIENT}?stylist_account_id=${encodeURIComponent(stylistAccountId)}`,
        token: ctx.clientToken,
      });
      assert.status(res, 200);
      const data =
        getData<
          GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['RESPONSE']
        >(res);

      assert.equals(
        data.stylist_info.account_id,
        stylistAccountId,
        'stylist_info must describe the stylist we asked about'
      );

      const mine = data.records.find(r => r.gallery_record_id === recordId);
      if (!mine) {
        throw new Error(
          `Paired client did not receive the stylist record ${recordId}; got ids [${data.records.map(r => r.gallery_record_id).join(', ')}]`
        );
      }
      // The record must arrive with the exact values the stylist wrote —
      // a shape-only assertion would pass on a record joined from the wrong row.
      assert.equals(
        mine.nail_length,
        NAIL_LENGTHS.LONG,
        'paired-client record must carry the nail_length the stylist wrote'
      );
      assert.equals(
        idFingerprint(mine.colors),
        dict.colorB,
        'paired-client record must carry the color the stylist attached'
      );
      assert.equals(
        idFingerprint(mine.traits),
        dict.traitB,
        'paired-client record must carry the trait the stylist attached'
      );
      if (data.total_count < 1) {
        throw new Error(
          `total_count must count at least the record we just created, got ${data.total_count}`
        );
      }

      // ── MIRROR NEGATIVE: revoke the pair, ask again with the SAME token and
      //    the SAME account id. Only the pairing changed, so a 200 here would
      //    mean the pairing gate never ran.
      await revokePairQuietly(ctx, stylistAccountId);
      stylistAccountId = ''; // already revoked — skip the finally-cleanup

      const afterRevoke = await apiCall({
        endpoint: `${ROUTES_API.GALLERY_GET_FOR_PAIRED_CLIENT}?stylist_account_id=${encodeURIComponent(pair.stylistAccountId)}`,
        token: ctx.clientToken,
      });
      assert.status(
        afterRevoke,
        404,
        'after the pair is revoked the same request must stop returning the gallery'
      );
    } finally {
      await deleteRecordQuietly(ctx.stylistToken, recordId);
      await revokePairQuietly(ctx, stylistAccountId);
    }
  });
};

// ============================================================================
// 3. REPORT_GALLERY_RECORD — SERIALIZABLE tx + 5 reports/hour per reporter
// ============================================================================

const runReportGalleryRecordTests = async (
  ctx: TestContext
): Promise<void> => {
  const dict = await getTwoOfEach(ctx.stylistToken);

  await test('REPORT_GALLERY_RECORD_CREATES_PENDING_REPORT_THEN_BLOCKS_DUPLICATE', async () => {
    let recordId: string | null = null;
    let reportId: string | null = null;
    try {
      recordId = await createRecord(ctx.stylistToken, {
        color_id: dict.colorA,
        trait_id: dict.traitA,
        nail_length: NAIL_LENGTHS.SHORT,
        tag: 'report-target',
      });

      // FRESH REPORTER PER RUN — deliberate. The rate limit is 5 reports per
      // ROLLING HOUR keyed on the reporter, and reports are never deleted
      // (ContentReport survives record deletion via onDelete: SetNull, and no
      // API deletes one). Reusing the shared client would make the 3rd smoke run
      // within an hour fail on a 429 that says nothing about this endpoint.
      const reporter = await mintFreshUser('temp-hpg-reporter');
      const onboard = await apiCall({
        endpoint: ROUTES_API.USER_ONBOARD_AS_CLIENT,
        method: 'POST',
        token: reporter.token,
        body: {},
      });
      if (onboard.status !== 200 && onboard.status !== 201) {
        throw new Error(`reporter onboarding failed: ${onboard.status}`);
      }

      const description = `smoke happy-path report ${Date.now()}`;
      const reportRes = await apiCall({
        endpoint: ROUTES_API.REPORT_GALLERY_RECORD,
        method: 'POST',
        token: reporter.token,
        body: {
          gallery_record_id: recordId,
          reason: ContentReportReasonValue.SPAM,
          description,
        } satisfies MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['REQUEST'],
      });
      assert.status(reportRes, 201);
      reportId =
        getData<MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['RESPONSE']>(
          reportRes
        ).report_id;
      assert.equals(
        typeof reportId,
        'string',
        'report_id must be a string id, not undefined'
      );

      // Read the row back through the admin moderation queue and compare every
      // value we submitted. This is what proves the SERIALIZABLE transaction
      // actually committed a row with OUR payload.
      const queueRes = await apiCall({
        endpoint: `${ROUTES_API.ADMIN_GET_CONTENT_REPORTS}?status=${ContentReportStatusValue.PENDING}&limit=100`,
        token: ctx.adminToken,
      });
      assert.status(queueRes, 200);
      const queue =
        getData<
          MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['RESPONSE']
        >(queueRes);
      const persisted = queue.reports.find(r => r.id === reportId);
      if (!persisted) {
        throw new Error(
          `report ${reportId} not found in the PENDING moderation queue (${queue.reports.length} rows scanned)`
        );
      }
      assert.equals(
        persisted.gallery_record_id,
        recordId,
        'persisted report must point at the record we reported'
      );
      assert.equals(
        persisted.reason,
        ContentReportReasonValue.SPAM,
        'persisted reason must equal the reason we submitted'
      );
      assert.equals(
        persisted.description,
        description,
        'persisted description must equal the text we submitted'
      );
      assert.equals(
        persisted.status,
        ContentReportStatusValue.PENDING,
        'a fresh report must land as PENDING'
      );
      assert.equals(
        persisted.reporter_id,
        reporter.userId,
        'reporter_id must come from the SESSION, not from the body'
      );

      // ── MIRROR NEGATIVE 1: same reporter, same record, still PENDING → the
      //    dedup branch inside the same transaction must refuse (400).
      const duplicateRes = await apiCall({
        endpoint: ROUTES_API.REPORT_GALLERY_RECORD,
        method: 'POST',
        token: reporter.token,
        body: {
          gallery_record_id: recordId,
          reason: ContentReportReasonValue.OTHER,
        } satisfies MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['REQUEST'],
      });
      assert.status(
        duplicateRes,
        400,
        'a second report on the same record while one is still PENDING must be refused'
      );

      // ── MIRROR NEGATIVE 2: the record owner cannot report herself (403).
      const selfRes = await apiCall({
        endpoint: ROUTES_API.REPORT_GALLERY_RECORD,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          gallery_record_id: recordId,
          reason: ContentReportReasonValue.SPAM,
        } satisfies MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['REQUEST'],
      });
      assert.status(
        selfRes,
        403,
        'the owner of the record must be blocked from reporting it'
      );
    } finally {
      // The report row cannot be deleted through the API; DISMISS resolves it so
      // repeated runs do not accumulate PENDING noise in the moderation queue.
      if (reportId) {
        try {
          await apiCall({
            endpoint: ROUTES_API.ADMIN_RESOLVE_REPORT,
            method: 'POST',
            token: ctx.adminToken,
            body: {
              report_id: reportId,
              action: ModerationAction.DISMISS,
            },
          });
        } catch {
          /* cleanup must not mask a real failure */
        }
      }
      await deleteRecordQuietly(ctx.stylistToken, recordId);
    }
  });
};

// ============================================================================
// 4. ADMIN_APPLY_STRIKE — destructive, row-lock + insert + counter update
// ============================================================================

const runApplyStrikeTests = async (ctx: TestContext): Promise<void> => {
  await test('APPLY_STRIKE_INCREMENTS_COUNT_AND_FLAGS_BAN_AT_THIRD', async () => {
    // FRESH TARGET PER RUN — deliberate. Strikes are never revoked through the
    // API (the rolling window is 365 days), so re-striking a shared user would
    // make the asserted counter depend on how often smoke ran this year.
    const target = await mintFreshUser('temp-hpg-strike-target');
    try {
      const applyStrike = async (n: number) => {
        const res = await apiCall({
          endpoint: ROUTES_API.ADMIN_APPLY_STRIKE,
          method: 'POST',
          token: ctx.adminToken,
          body: {
            user_id: target.userId,
            reason: `smoke happy-path strike #${n}`,
          } satisfies MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['REQUEST'],
        });
        assert.status(res, 200);
        return getData<MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['RESPONSE']>(
          res
        );
      };

      const first = await applyStrike(1);
      assert.equals(
        first.user_id,
        target.userId,
        'response must name the user we struck'
      );
      assert.equals(
        first.moderation_strikes,
        1,
        'a never-struck user must be at exactly 1 active strike after the first strike'
      );
      assert.equals(
        first.ban_recommended,
        false,
        'one strike must not recommend a ban'
      );

      const second = await applyStrike(2);
      assert.equals(
        second.moderation_strikes,
        2,
        'the counter must increment to 2 — proving the insert+count really persisted'
      );
      assert.equals(
        second.ban_recommended,
        false,
        'two strikes must not recommend a ban'
      );

      const third = await applyStrike(3);
      assert.equals(
        third.moderation_strikes,
        3,
        'the counter must increment to 3'
      );
      assert.equals(
        third.ban_recommended,
        true,
        'the third active strike must flip ban_recommended (threshold = 3)'
      );

      // ── MIRROR NEGATIVE 1: the protected-target guard. An admin must not be
      //    able to strike herself — and, unlike a bare status assertion, the
      //    strike counter of the fresh target must be provably unmoved by it.
      const adminSession = await apiCall({
        endpoint: ROUTES_API.SESSION_GET_CURRENT,
        token: ctx.adminToken,
      });
      assert.status(adminSession, 200);
      const adminUserId = getData<{ id: string }>(adminSession).id;

      const selfRes = await apiCall({
        endpoint: ROUTES_API.ADMIN_APPLY_STRIKE,
        method: 'POST',
        token: ctx.adminToken,
        body: {
          user_id: adminUserId,
          reason: 'smoke self-strike guard',
        } satisfies MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['REQUEST'],
      });
      assert.status(
        selfRes,
        403,
        'an admin striking herself must be refused by the protected-target guard'
      );

      // ── MIRROR NEGATIVE 2: a ghost target must 404 before the insert, not
      //    create an orphan strike row.
      const ghostRes = await apiCall({
        endpoint: ROUTES_API.ADMIN_APPLY_STRIKE,
        method: 'POST',
        token: ctx.adminToken,
        body: {
          user_id: `ghost-user-${Date.now()}`,
          reason: 'smoke ghost-strike guard',
        } satisfies MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['REQUEST'],
      });
      assert.status(
        ghostRes,
        404,
        'a non-existent target must be rejected before any strike row is written'
      );

      // The real target must still sit at exactly 3 — neither refused call
      // leaked a strike onto it.
      const fourth = await applyStrike(4);
      assert.equals(
        fourth.moderation_strikes,
        4,
        'the target counter must continue from 3 — the two refused calls wrote nothing'
      );
    } finally {
      // Cascade-deletes the ModerationStrike rows with the user (schema:
      // ModerationStrike.user onDelete: Cascade).
      try {
        await apiCall({
          endpoint: ROUTES_API.USER_DELETE_ANY,
          method: 'POST',
          token: ctx.adminToken,
          body: { id: target.userId },
        });
      } catch {
        /* cleanup must not mask a real failure */
      }
    }
  });
};

// ============================================================================
// 5. SAVE_NOTE / SET_MAIN_NOTE / GET_NOTES — admin dashboard note versioning
// ============================================================================

const runAdminNotesTests = async (ctx: TestContext): Promise<void> => {
  await test('ADMIN_NOTES_SAVE_READ_BACK_AND_PROMOTE_MAIN_VERSION', async () => {
    // NO CLEANUP IS POSSIBLE: AdminNote is append-only — the API exposes save,
    // read and promote, but no delete. Each run therefore writes a UNIQUE,
    // timestamped body so the assertions never collide with an earlier run's
    // rows; the rows themselves accumulate by design (version history).
    const stamp = Date.now();
    const firstText = `smoke-note-A-${stamp}`;
    const secondText = `smoke-note-B-${stamp}`;

    const saveFirst = await apiCall({
      endpoint: ROUTES_API.SAVE_NOTE,
      method: 'POST',
      token: ctx.adminToken,
      body: { notes: firstText },
    });
    assert.status(saveFirst, 200);
    const firstId = getData<{ note_id: string }>(saveFirst).note_id;
    assert.equals(typeof firstId, 'string', 'save must return a note_id');

    // Read that exact version back and compare the TEXT, not the shape.
    const readFirst = await apiCall({
      endpoint: `${ROUTES_API.GET_NOTES}?id=${encodeURIComponent(firstId)}`,
      token: ctx.adminToken,
    });
    assert.status(readFirst, 200);
    assert.equals(
      getData<{ notes: string }>(readFirst).notes,
      firstText,
      'reading version A by id must return exactly the text written'
    );

    const saveSecond = await apiCall({
      endpoint: ROUTES_API.SAVE_NOTE,
      method: 'POST',
      token: ctx.adminToken,
      body: { notes: secondText },
    });
    assert.status(saveSecond, 200);
    const secondId = getData<{ note_id: string }>(saveSecond).note_id;

    // Default read (no id) resolves to the newest version.
    const readDefault = await apiCall({
      endpoint: ROUTES_API.GET_NOTES,
      token: ctx.adminToken,
    });
    assert.status(readDefault, 200);
    assert.equals(
      getData<{ notes: string }>(readDefault).notes,
      secondText,
      'the default read must resolve to the newest saved version (B)'
    );

    // Promote A back to main — the whole point of SET_MAIN_NOTE. If the
    // re-stamp does not happen, the default read keeps returning B.
    const promote = await apiCall({
      endpoint: ROUTES_API.SET_MAIN_NOTE,
      method: 'POST',
      token: ctx.adminToken,
      body: { id: firstId },
    });
    assert.status(promote, 200);

    const readAfterPromote = await apiCall({
      endpoint: ROUTES_API.GET_NOTES,
      token: ctx.adminToken,
    });
    assert.status(readAfterPromote, 200);
    const afterPromote = getData<{
      notes: string;
      versions: Array<{ id: string; length: string }>;
    }>(readAfterPromote);
    assert.equals(
      afterPromote.notes,
      firstText,
      'after promotion the default read must return version A, not B'
    );
    // Both versions must still exist — promotion is a re-stamp, not a delete.
    assert.equals(
      afterPromote.versions.some(v => v.id === firstId),
      true,
      'promoted version A must still be listed'
    );
    assert.equals(
      afterPromote.versions.some(v => v.id === secondId),
      true,
      'version B must survive the promotion of A'
    );
    const listedA = afterPromote.versions.find(v => v.id === firstId);
    assert.equals(
      listedA?.length,
      String(firstText.length),
      'the version list must report the real character length of the stored text'
    );

    // ── MIRROR NEGATIVE: a version id that does not exist must 404 rather than
    //    silently fall back to the newest note (the false-positive read the
    //    admin-notes-3 DECISION closed).
    const ghostRead = await apiCall({
      endpoint: `${ROUTES_API.GET_NOTES}?id=ghost-note-id-${stamp}`,
      token: ctx.adminToken,
    });
    assert.status(
      ghostRead,
      404,
      'reading a non-existent version must 404, never fall back to the newest'
    );

    const ghostPromote = await apiCall({
      endpoint: ROUTES_API.SET_MAIN_NOTE,
      method: 'POST',
      token: ctx.adminToken,
      body: { id: `ghost-note-id-${stamp}` },
    });
    assert.status(
      ghostPromote,
      404,
      'promoting a non-existent version must 404'
    );
  });
};

// ============================================================================
// 6. ADMIN COLOR / TRAIT dictionary CRUD
// ============================================================================

const runAdminDictionaryTests = async (ctx: TestContext): Promise<void> => {
  await test('ADMIN_COLOR_CREATE_UPDATE_DELETE_ROUND_TRIP', async () => {
    const stamp = Date.now();
    const initialName = `smoke-color-${stamp}`;
    const initialHex = '#123456';
    const renamed = `smoke-color-${stamp}-renamed`;
    const rehex = '#654321';
    let colorId: string | null = null;

    try {
      const createRes = await apiCall({
        endpoint: ROUTES_API.ADMIN_CREATE_COLOR,
        method: 'POST',
        token: ctx.adminToken,
        body: { name: initialName, hex_code: initialHex },
      });
      assert.status(createRes, 201);
      colorId = getData<{ color_id: string }>(createRes).color_id;
      assert.equals(typeof colorId, 'string', 'create must return a color_id');

      // Read back through the picker the stylist actually uses.
      const afterCreate = await findColor(ctx.stylistToken, colorId);
      assert.equals(
        afterCreate?.name,
        initialName,
        'created color must appear in the picker with the name written'
      );
      assert.equals(
        afterCreate?.hex_code,
        initialHex,
        'created color must appear with the hex written'
      );

      const updateRes = await apiCall({
        endpoint: ROUTES_API.ADMIN_UPDATE_COLOR,
        method: 'POST',
        token: ctx.adminToken,
        body: { color_id: colorId, name: renamed, hex_code: rehex },
      });
      assert.status(updateRes, 200);
      assert.equals(
        getData<{ success: boolean }>(updateRes).success,
        true,
        'update must report success'
      );

      const afterUpdate = await findColor(ctx.stylistToken, colorId);
      assert.equals(
        afterUpdate?.name,
        renamed,
        'the picker must show the UPDATED name, proving the write landed'
      );
      assert.equals(
        afterUpdate?.hex_code,
        rehex,
        'the picker must show the UPDATED hex'
      );

      const deleteRes = await apiCall({
        endpoint: ROUTES_API.ADMIN_DELETE_COLOR,
        method: 'POST',
        token: ctx.adminToken,
        body: { color_id: colorId },
      });
      assert.status(deleteRes, 200);

      const afterDelete = await findColor(ctx.stylistToken, colorId);
      assert.equals(
        afterDelete,
        undefined,
        'a deleted color must disappear from the picker'
      );

      // ── MIRROR NEGATIVE: deleting it again must 404, not silently "succeed".
      const secondDelete = await apiCall({
        endpoint: ROUTES_API.ADMIN_DELETE_COLOR,
        method: 'POST',
        token: ctx.adminToken,
        body: { color_id: colorId },
      });
      assert.status(
        secondDelete,
        404,
        'deleting an already-deleted color must 404'
      );
      colorId = null; // nothing left to clean up
    } finally {
      if (colorId) {
        try {
          await apiCall({
            endpoint: ROUTES_API.ADMIN_DELETE_COLOR,
            method: 'POST',
            token: ctx.adminToken,
            body: { color_id: colorId },
          });
        } catch {
          /* cleanup must not mask a real failure */
        }
      }
    }
  });

  await test('ADMIN_TRAIT_CREATE_UPDATE_DELETE_ROUND_TRIP', async () => {
    const stamp = Date.now();
    const initialName = `smoke-trait-${stamp}`;
    const renamed = `smoke-trait-${stamp}-renamed`;
    let traitId: string | null = null;

    try {
      const createRes = await apiCall({
        endpoint: ROUTES_API.ADMIN_CREATE_TRAIT,
        method: 'POST',
        token: ctx.adminToken,
        body: {
          name: initialName,
          category: TRAIT_CATEGORIES[0],
          is_featured: false,
        },
      });
      assert.status(createRes, 201);
      traitId = getData<{ trait_id: string }>(createRes).trait_id;
      assert.equals(typeof traitId, 'string', 'create must return a trait_id');

      const afterCreate = await findTrait(ctx.stylistToken, traitId);
      assert.equals(
        afterCreate?.name,
        initialName,
        'created trait must appear in the picker with the name written'
      );
      assert.equals(
        afterCreate?.category,
        TRAIT_CATEGORIES[0],
        'created trait must carry the category written'
      );
      assert.equals(
        afterCreate?.is_featured,
        false,
        'created trait must carry is_featured=false as written'
      );

      const updateRes = await apiCall({
        endpoint: ROUTES_API.ADMIN_UPDATE_TRAIT,
        method: 'POST',
        token: ctx.adminToken,
        body: {
          trait_id: traitId,
          name: renamed,
          category: TRAIT_CATEGORIES[1],
          is_featured: true,
        },
      });
      assert.status(updateRes, 200);

      const afterUpdate = await findTrait(ctx.stylistToken, traitId);
      assert.equals(
        afterUpdate?.name,
        renamed,
        'the picker must show the UPDATED trait name'
      );
      assert.equals(
        afterUpdate?.category,
        TRAIT_CATEGORIES[1],
        'the picker must show the UPDATED category'
      );
      assert.equals(
        afterUpdate?.is_featured,
        true,
        'the picker must show the UPDATED is_featured flag'
      );

      const deleteRes = await apiCall({
        endpoint: ROUTES_API.ADMIN_DELETE_TRAIT,
        method: 'POST',
        token: ctx.adminToken,
        body: { trait_id: traitId },
      });
      assert.status(deleteRes, 200);
      assert.equals(
        await findTrait(ctx.stylistToken, traitId),
        undefined,
        'a deleted trait must disappear from the picker'
      );

      const secondDelete = await apiCall({
        endpoint: ROUTES_API.ADMIN_DELETE_TRAIT,
        method: 'POST',
        token: ctx.adminToken,
        body: { trait_id: traitId },
      });
      assert.status(
        secondDelete,
        404,
        'deleting an already-deleted trait must 404'
      );
      traitId = null;
    } finally {
      if (traitId) {
        try {
          await apiCall({
            endpoint: ROUTES_API.ADMIN_DELETE_TRAIT,
            method: 'POST',
            token: ctx.adminToken,
            body: { trait_id: traitId },
          });
        } catch {
          /* cleanup must not mask a real failure */
        }
      }
    }
  });
};

// ============================================================================
// 7. ADMIN_UPDATE_PERMISSIONS — immutability guard must protect the DATA
// ============================================================================

const runUpdatePermissionsTests = async (ctx: TestContext): Promise<void> => {
  // NO HAPPY PATH IS REACHABLE THROUGH THE API — deliberate, not an omission.
  // permissions.seed.ts stamps is_system=true on EVERY seeded Role, and the
  // operation rejects every is_system role (ADMIN_SYSTEM_ROLE_IMMUTABLE). No
  // endpoint creates a custom (non-system) role, so a 200 from this endpoint
  // cannot be produced without touching the DB directly — which the smoke suite
  // deliberately never does. What CAN and MUST be proven is that the guard runs
  // BEFORE the destructive deleteMany: a rejected call must leave the role's
  // permission set byte-identical.
  await test('UPDATE_PERMISSIONS_IMMUTABLE_ROLE_REJECTED_WITHOUT_TOUCHING_THE_SET', async () => {
    const before = await apiCall({
      endpoint: ROUTES_API.ADMIN_GET_PERMISSIONS,
      token: ctx.adminToken,
    });
    assert.status(before, 200);
    const beforeData =
      getData<ADMIN_DTO_API_V1['ADMIN_GET_PERMISSIONS']['RESPONSE']>(before);

    const role = beforeData.roles.find(r => r.is_system);
    if (!role) {
      throw new Error('No system role found — the RBAC seed is missing');
    }
    const beforeSet = role.permissions
      .map(p => p.permission_id)
      .sort()
      .join(',');
    if (beforeSet.length === 0) {
      throw new Error(
        `System role ${role.id} has no permissions — cannot prove the set survived`
      );
    }

    // Try to wipe the role's whole permission set.
    const attempt = await apiCall({
      endpoint: ROUTES_API.ADMIN_UPDATE_PERMISSIONS,
      method: 'POST',
      token: ctx.adminToken,
      body: { role_id: role.id, permission_ids: [] },
    });
    assert.status(
      attempt,
      403,
      'editing a config-defined system role must be refused'
    );

    const after = await apiCall({
      endpoint: ROUTES_API.ADMIN_GET_PERMISSIONS,
      token: ctx.adminToken,
    });
    assert.status(after, 200);
    const afterRole = getData<
      ADMIN_DTO_API_V1['ADMIN_GET_PERMISSIONS']['RESPONSE']
    >(after).roles.find(r => r.id === role.id);
    const afterSet = (afterRole?.permissions ?? [])
      .map(p => p.permission_id)
      .sort()
      .join(',');
    assert.equals(
      afterSet,
      beforeSet,
      `role ${role.id} must keep the EXACT permission set it had before the rejected update`
    );

    // ── A non-existent role must 404 (precise) rather than silently "succeed"
    //    by deleting nothing.
    const ghost = await apiCall({
      endpoint: ROUTES_API.ADMIN_UPDATE_PERMISSIONS,
      method: 'POST',
      token: ctx.adminToken,
      body: { role_id: `ghost-role-${Date.now()}`, permission_ids: [] },
    });
    assert.status(ghost, 404, 'an unknown role_id must 404, not no-op-succeed');
  });
};

// ============================================================================
// 8. USER_REQUEST_EMAIL_CHANGE — request side (confirmation is email-gated)
// ============================================================================

const runEmailChangeRequestTests = async (ctx: TestContext): Promise<void> => {
  await test('REQUEST_EMAIL_CHANGE_ACCEPTS_AND_LEAVES_EMAIL_UNCHANGED_UNTIL_CONFIRM', async () => {
    // FRESH USER PER RUN — the flow mutates nothing yet, but a shared user would
    // accumulate pending-change emails and couple this test to whatever the
    // lifecycle suite did to that identity earlier in the run.
    const user = await mintFreshUser('temp-hpg-emailchange');
    try {
      const target = `temp-hpg-emailchange-new-${Date.now()}@example.com`;
      const res = await apiCall({
        endpoint: ROUTES_API.USER_REQUEST_EMAIL_CHANGE,
        method: 'POST',
        token: user.token,
        body: { email: target },
      });
      assert.status(res, 200);
      const data =
        getData<USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['RESPONSE']>(res);
      assert.equals(
        data.message,
        'VERIFICATION_EMAIL_SENT',
        'the request must report that a verification email went out'
      );

      // The address must NOT move before the emailed token is confirmed —
      // otherwise anyone with a live session could take over an account by
      // pointing it at their own inbox.
      const session = await apiCall({
        endpoint: ROUTES_API.SESSION_GET_CURRENT,
        token: user.token,
      });
      assert.status(session, 200);
      assert.equals(
        getData<{ email: string }>(session).email,
        user.email,
        'the stored email must still be the OLD one until the link is confirmed'
      );

      // ── MIRROR NEGATIVE (anti-enumeration): asking for an address that is
      //    ALREADY registered must be byte-for-byte indistinguishable from the
      //    free-address answer, or a logged-in user can probe the user table.
      const takenRes = await apiCall({
        endpoint: ROUTES_API.USER_REQUEST_EMAIL_CHANGE,
        method: 'POST',
        token: user.token,
        body: { email: TEST_USERS_CONFIG.STYLIST.email },
      });
      assert.equals(
        takenRes.status,
        res.status,
        'a taken address must return the SAME status as a free one (no oracle)'
      );
      assert.equals(
        getData<USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['RESPONSE']>(
          takenRes
        ).message,
        data.message,
        'a taken address must return the SAME message as a free one (no oracle)'
      );

      const sessionAgain = await apiCall({
        endpoint: ROUTES_API.SESSION_GET_CURRENT,
        token: user.token,
      });
      assert.equals(
        getData<{ email: string }>(sessionAgain).email,
        user.email,
        'the probe must not have moved the requester email either'
      );
    } finally {
      try {
        await apiCall({
          endpoint: ROUTES_API.USER_DELETE_ANY,
          method: 'POST',
          token: ctx.adminToken,
          body: { id: user.userId },
        });
      } catch {
        /* cleanup must not mask a real failure */
      }
    }
  });
};

// ============================================================================
// 9. ACCOUNT_SET_DASHBOARD_NOTE — plain write/read round trip
// ============================================================================

const runDashboardNoteTests = async (ctx: TestContext): Promise<void> => {
  await test('SET_DASHBOARD_NOTE_ROUND_TRIPS_AND_CLEARS', async () => {
    const noteText = `smoke dashboard note ${Date.now()}`;
    try {
      const setRes = await apiCall({
        endpoint: ROUTES_API.ACCOUNT_SET_DASHBOARD_NOTE,
        method: 'POST',
        token: ctx.stylistToken,
        body: { note: noteText, account_type: AccountTypeValue.STYLIST },
      });
      assert.status(setRes, 200);
      assert.equals(
        getData<{ dashboard_note: string | null }>(setRes).dashboard_note,
        noteText,
        'the write must echo the exact text submitted'
      );

      const readRes = await apiCall({
        endpoint: ROUTES_API.ACCOUNT_GET_DASHBOARD_NOTE,
        token: ctx.stylistToken,
      });
      assert.status(readRes, 200);
      const read = getData<{
        stylist_note: string | null;
        client_note: string | null;
      }>(readRes);
      assert.equals(
        read.stylist_note,
        noteText,
        'reading back must return exactly the text written to the STYLIST side'
      );
      assert.equals(
        read.client_note,
        null,
        'writing the stylist note must NOT bleed into the client note'
      );
    } finally {
      // Restore the empty state so the suite is re-runnable and the shared test
      // stylist is not left carrying smoke text on her dashboard.
      try {
        await apiCall({
          endpoint: ROUTES_API.ACCOUNT_SET_DASHBOARD_NOTE,
          method: 'POST',
          token: ctx.stylistToken,
          body: { note: null, account_type: AccountTypeValue.STYLIST },
        });
      } catch {
        /* cleanup must not mask a real failure */
      }
    }

    const afterClear = await apiCall({
      endpoint: ROUTES_API.ACCOUNT_GET_DASHBOARD_NOTE,
      token: ctx.stylistToken,
    });
    assert.status(afterClear, 200);
    assert.equals(
      getData<{ stylist_note: string | null }>(afterClear).stylist_note,
      null,
      'clearing with note:null must actually erase the stored note'
    );
  });
};

// ============================================================================
// 10. PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT + GET_GALLERY_RECORD_BY_ID
// ============================================================================

const runPublicGalleryTests = async (ctx: TestContext): Promise<void> => {
  const dict = await getTwoOfEach(ctx.stylistToken);

  await test('PUBLIC_GALLERY_SHOWS_ONLY_PINNED_RECORDS_WITH_WRITTEN_VALUES', async () => {
    let recordId: string | null = null;
    try {
      const accountRes = await apiCall({
        endpoint: ROUTES_API.SESSION_GET_CURRENT,
        token: ctx.stylistToken,
      });
      assert.status(accountRes, 200);
      const accountId = getData<{
        stylist_account?: { account_id: string };
      }>(accountRes).stylist_account?.account_id;
      if (!accountId) {
        throw new Error('No stylist account_id in session');
      }

      recordId = await createRecord(ctx.stylistToken, {
        color_id: dict.colorA,
        trait_id: dict.traitB,
        nail_length: NAIL_LENGTHS.MEDIUM,
        tag: 'public-gallery',
      });

      // ── Un-pinned first: the public profile is a CURATED surface, so a fresh
      //    record must NOT be visible before it is pinned.
      const beforePin = await apiCall({
        endpoint: `${ROUTES_API.PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT}?account_id=${encodeURIComponent(accountId)}`,
      });
      assert.status(beforePin, 200);
      const beforeData =
        getData<
          GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE']
        >(beforePin);
      assert.equals(
        beforeData.records.some(r => r.gallery_record_id === recordId),
        false,
        'an un-pinned record must not appear on the public profile'
      );

      const pinRes = await apiCall({
        endpoint: ROUTES_API.GALLERY_PIN_RECORD,
        method: 'POST',
        token: ctx.stylistToken,
        body: { gallery_record_id: recordId },
      });
      assert.status(pinRes, 200);

      const afterPin = await apiCall({
        endpoint: `${ROUTES_API.PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT}?account_id=${encodeURIComponent(accountId)}`,
      });
      assert.status(afterPin, 200);
      const afterData =
        getData<
          GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE']
        >(afterPin);
      const published = afterData.records.find(
        r => r.gallery_record_id === recordId
      );
      if (!published) {
        throw new Error(
          `pinned record ${recordId} did not appear on the public profile`
        );
      }
      assert.equals(
        published.nail_length,
        NAIL_LENGTHS.MEDIUM,
        'the public record must carry the nail_length the stylist wrote'
      );
      assert.equals(
        idFingerprint(published.colors),
        dict.colorA,
        'the public record must carry the color the stylist attached'
      );
      assert.equals(
        idFingerprint(published.traits),
        dict.traitB,
        'the public record must carry the trait the stylist attached'
      );
      assert.equals(
        afterData.stylist_info.account_id,
        accountId,
        'stylist_info must describe the account we asked about'
      );

      // ── GET_GALLERY_RECORD_BY_ID: the owner's detail view must agree with the
      //    public projection AND report the pin state we just created.
      const detail = await readRecord(ctx.stylistToken, recordId);
      assert.equals(
        detail.gallery_record.gallery_record_id,
        recordId,
        'detail view must return the record we asked for'
      );
      assert.equals(
        detail.gallery_record.nail_length,
        NAIL_LENGTHS.MEDIUM,
        'detail nail_length must equal the stored value'
      );
      assert.equals(
        idFingerprint(detail.gallery_record.colors),
        dict.colorA,
        'detail colors must equal the stored junction'
      );
      assert.equals(
        detail.is_pinned,
        true,
        'the owner detail view must report is_pinned=true after pinning'
      );
      assert.equals(
        detail.stylist_info.account_id,
        accountId,
        'detail stylist_info must be the owning account'
      );

      // ── MIRROR NEGATIVE: unpin, and the SAME public request must stop
      //    returning it. Only the pin flag changed.
      const unpinRes = await apiCall({
        endpoint: ROUTES_API.GALLERY_UNPIN_RECORD,
        method: 'POST',
        token: ctx.stylistToken,
        body: { gallery_record_id: recordId },
      });
      assert.status(unpinRes, 200);

      const afterUnpin = await apiCall({
        endpoint: `${ROUTES_API.PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT}?account_id=${encodeURIComponent(accountId)}`,
      });
      assert.status(afterUnpin, 200);
      assert.equals(
        getData<
          GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE']
        >(afterUnpin).records.some(r => r.gallery_record_id === recordId),
        false,
        'un-pinning must remove the record from the public profile again'
      );
      assert.equals(
        (await readRecord(ctx.stylistToken, recordId)).is_pinned,
        false,
        'the detail view must report is_pinned=false after unpinning'
      );
    } finally {
      await deleteRecordQuietly(ctx.stylistToken, recordId);
    }
  });
};

// ============================================================================
// 11. PAIRING_SESSION_REVOKE — a revoked QR token must stop working
// ============================================================================

const runPairingSessionRevokeTests = async (
  ctx: TestContext
): Promise<void> => {
  await test('PAIRING_SESSION_REVOKE_KILLS_THE_ISSUED_TOKEN', async () => {
    const issue = await apiCall({
      endpoint: ROUTES_API.PAIRING_SESSION_ISSUE,
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    if (issue.status !== 200 && issue.status !== 201) {
      throw new Error(`issue-session failed: ${issue.status}`);
    }
    const issued =
      getData<PAIRING_DTO_API_V1['PAIRING_SESSION_ISSUE']['RESPONSE']>(issue);

    const revoke = await apiCall({
      endpoint: ROUTES_API.PAIRING_SESSION_REVOKE,
      method: 'POST',
      token: ctx.stylistToken,
      body: { token: issued.token },
    });
    assert.status(revoke, 200);
    assert.equals(
      getData<PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE']['RESPONSE']>(revoke)
        .success,
      true,
      'revoke must report success'
    );

    // ── MIRROR NEGATIVE: the very token that WOULD have paired the client is
    //    now dead. Without this, "success: true" proves nothing.
    const claim = await apiCall({
      endpoint: ROUTES_API.PAIRING_SESSION_CLAIM,
      method: 'POST',
      token: ctx.clientToken,
      body: { token: issued.token },
    });
    if (claim.status === 200 || claim.status === 201) {
      throw new Error(
        'a revoked pairing token still paired the client — revoke did nothing'
      );
    }

    // Re-revoking is IDEMPOTENT BY DESIGN (`if (session.revoked_at) return
    // success(...)` in pairing-revoke.operations.ts), so 200 here is correct —
    // but a foreign/unknown token must still be refused, which is what proves
    // the second 200 comes from the idempotency branch and not from a handler
    // that says "success" to anything.
    const secondRevoke = await apiCall({
      endpoint: ROUTES_API.PAIRING_SESSION_REVOKE,
      method: 'POST',
      token: ctx.stylistToken,
      body: { token: issued.token },
    });
    assert.status(
      secondRevoke,
      200,
      're-revoking the same token is idempotent by design'
    );
    assert.equals(
      getData<PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE']['RESPONSE']>(
        secondRevoke
      ).success,
      true,
      'the idempotent re-revoke must still report success'
    );

    const unknownRevoke = await apiCall({
      endpoint: ROUTES_API.PAIRING_SESSION_REVOKE,
      method: 'POST',
      token: ctx.stylistToken,
      body: { token: `ghost-pairing-token-${Date.now()}` },
    });
    assert.status(
      unknownRevoke,
      404,
      'an unknown token must 404 — otherwise the idempotent 200 above means nothing'
    );
  });
};

// ============================================================================
// 12. EMAIL_UPDATE_PREFERENCES + EMAIL_UNSUBSCRIBE (POST, HMAC token)
// ============================================================================

/**
 * Mirror of web-1 `generateHmacToken` (application/email-handler/hmac-token.utils.ts).
 *
 * DELIBERATE DUPLICATION, narrowly scoped: the unsubscribe token is minted
 * server-side inside outgoing email bodies, so there is NO API that hands one to
 * a caller — without reproducing the signature the endpoint's entire success
 * path is untestable and would keep only its 400s (exactly the blind spot this
 * file exists to close). The secret is read from the SAME SSOT the rest of the
 * suite uses (web-1/.env.development via fromBackendEnv), never hardcoded. If
 * the token format ever changes, this test failing is CORRECT: links already
 * sitting in real inboxes carry the old format, so the change is a contract
 * break that deserves to be loud.
 */
const buildUnsubscribeToken = (
  userId: string,
  category: 'TRIAL_SEQUENCE' | 'MARKETING' | 'TRANSACTIONAL'
): string => {
  const base = fromBackendEnv('EMAIL_UNSUBSCRIBE_SECRET');
  const secret = base
    ? `${base}-unsubscribe`
    : 'dev-only-email-token-secret-do-not-use-in-production-unsubscribe';
  const payload = [userId, category, String(Date.now())].join(':');
  const payloadBase64 = Buffer.from(payload).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payloadBase64}.${signature}`;
};

const runEmailPreferenceTests = async (ctx: TestContext): Promise<void> => {
  await test('EMAIL_PREFERENCES_AND_UNSUBSCRIBE_AGREE_ON_THE_SAME_STATE', async () => {
    // Email preferences live on the StylistAccount, so the identity must be a
    // stylist. FRESH per run: the unsubscribe path is one-way (it can only turn
    // a category OFF), so a reused account would already be unsubscribed and the
    // `already_unsubscribed` assertions would be decided by an earlier run.
    const user = await mintFreshUser('temp-hpg-emailprefs');
    try {
      const switchRes = await apiCall({
        endpoint: ROUTES_API.USER_SWITCH_ROLE,
        method: 'POST',
        token: user.token,
        body: { account_type: AccountTypeValue.STYLIST },
      });
      assert.status(switchRes, 200);

      // 1. Turn BOTH categories on and check the echo value-for-value.
      const bothOn = await apiCall({
        endpoint: ROUTES_API.EMAIL_UPDATE_PREFERENCES,
        method: 'POST',
        token: user.token,
        body: { trial_sequence: true, marketing: true },
      });
      assert.status(bothOn, 200);
      const bothOnPrefs =
        getData<EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['RESPONSE']>(
          bothOn
        ).preferences;
      assert.equals(
        bothOnPrefs.trial_sequence,
        true,
        'trial_sequence must echo the true we wrote'
      );
      assert.equals(
        bothOnPrefs.marketing,
        true,
        'marketing must echo the true we wrote'
      );

      // 2. Unsubscribe from TRIAL_SEQUENCE. `already_unsubscribed:false` is a
      //    READ of the pre-write state — it proves the preference really was on,
      //    i.e. step 1 persisted.
      const unsub = await apiCall({
        endpoint: ROUTES_API.EMAIL_UNSUBSCRIBE,
        method: 'POST',
        body: { token: buildUnsubscribeToken(user.userId, 'TRIAL_SEQUENCE') },
      });
      assert.status(unsub, 200);
      const unsubData = getData<{
        unsubscribed: boolean;
        category: string;
        already_unsubscribed: boolean;
      }>(unsub);
      assert.equals(unsubData.unsubscribed, true, 'unsubscribe must confirm');
      assert.equals(
        unsubData.category,
        'TRIAL_SEQUENCE',
        'the response must name the category encoded in the token'
      );
      assert.equals(
        unsubData.already_unsubscribed,
        false,
        'the category was ON before this call, so this must be a REAL unsubscribe'
      );

      // 3. Repeat: now the same call must report the state it just wrote.
      const unsubAgain = await apiCall({
        endpoint: ROUTES_API.EMAIL_UNSUBSCRIBE,
        method: 'POST',
        body: { token: buildUnsubscribeToken(user.userId, 'TRIAL_SEQUENCE') },
      });
      assert.status(unsubAgain, 200);
      assert.equals(
        getData<{ already_unsubscribed: boolean }>(unsubAgain)
          .already_unsubscribed,
        true,
        'the second unsubscribe must see the column the first one flipped'
      );

      // 4. The unsubscribe must have touched ONLY that category — MARKETING is
      //    still on, so unsubscribing it is also a real change.
      const unsubMarketing = await apiCall({
        endpoint: ROUTES_API.EMAIL_UNSUBSCRIBE,
        method: 'POST',
        body: { token: buildUnsubscribeToken(user.userId, 'MARKETING') },
      });
      assert.status(unsubMarketing, 200);
      assert.equals(
        getData<{ already_unsubscribed: boolean }>(unsubMarketing)
          .already_unsubscribed,
        false,
        'unsubscribing TRIAL_SEQUENCE must not have silently killed MARKETING too'
      );

      // 5. Cross-endpoint agreement: EMAIL_UPDATE_PREFERENCES turning the
      //    category back ON must be visible to the unsubscribe path.
      const reEnable = await apiCall({
        endpoint: ROUTES_API.EMAIL_UPDATE_PREFERENCES,
        method: 'POST',
        token: user.token,
        body: { trial_sequence: true, marketing: false },
      });
      assert.status(reEnable, 200);
      const reEnabled =
        getData<EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['RESPONSE']>(
          reEnable
        ).preferences;
      assert.equals(
        reEnabled.trial_sequence,
        true,
        'trial_sequence must be back on'
      );
      assert.equals(reEnabled.marketing, false, 'marketing must be off');

      const afterReEnable = await apiCall({
        endpoint: ROUTES_API.EMAIL_UNSUBSCRIBE,
        method: 'POST',
        body: { token: buildUnsubscribeToken(user.userId, 'TRIAL_SEQUENCE') },
      });
      assert.status(afterReEnable, 200);
      assert.equals(
        getData<{ already_unsubscribed: boolean }>(afterReEnable)
          .already_unsubscribed,
        false,
        'the preferences endpoint and the unsubscribe endpoint must read the SAME column'
      );

      // ── MIRROR NEGATIVE 1: TRANSACTIONAL cannot be unsubscribed (PKE).
      const transactional = await apiCall({
        endpoint: ROUTES_API.EMAIL_UNSUBSCRIBE,
        method: 'POST',
        body: { token: buildUnsubscribeToken(user.userId, 'TRANSACTIONAL') },
      });
      assert.status(transactional, 400);
      assert.equals(
        getData<{ unsubscribed: boolean; error: string }>(transactional).error,
        'EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE',
        'transactional must be refused with the dedicated reason, not a silent success'
      );

      // ── MIRROR NEGATIVE 2: a token whose signature was tampered with.
      const forged = `${buildUnsubscribeToken(user.userId, 'MARKETING').split('.')[0]}.forged-signature`;
      const forgedRes = await apiCall({
        endpoint: ROUTES_API.EMAIL_UNSUBSCRIBE,
        method: 'POST',
        body: { token: forged },
      });
      assert.status(forgedRes, 400);
      assert.equals(
        getData<{ error: string }>(forgedRes).error,
        'EMAIL_INVALID_UNSUBSCRIBE_TOKEN',
        'a forged signature must be rejected as an invalid token'
      );
    } finally {
      try {
        await apiCall({
          endpoint: ROUTES_API.USER_DELETE_ANY,
          method: 'POST',
          token: ctx.adminToken,
          body: { id: user.userId },
        });
      } catch {
        /* cleanup must not mask a real failure */
      }
    }
  });
};

// ============================================================================
// 13. ADMIN_PURGE_DELETED_USER — GDPR Art.17 hard purge of the archive row
// ============================================================================

const runPurgeDeletedUserTests = async (ctx: TestContext): Promise<void> => {
  await test('PURGE_DELETED_USER_REMOVES_THE_ARCHIVE_ROW_ONCE', async () => {
    // FRESH USER PER RUN — the whole point is to destroy this identity's
    // archive; there is no way to recreate one for a shared account.
    const victim = await mintFreshUser('temp-hpg-purge');

    // Admin deletion moves the account into the DeletedUser archive, which is
    // exactly what purge targets.
    const archive = await apiCall({
      endpoint: ROUTES_API.USER_DELETE_ANY,
      method: 'POST',
      token: ctx.adminToken,
      body: { id: victim.userId },
    });
    assert.status(archive, 200);

    const purge = await apiCall({
      endpoint: ROUTES_API.ADMIN_PURGE_DELETED_USER,
      method: 'POST',
      token: ctx.adminToken,
      body: { user_id: victim.userId },
    });
    assert.status(
      purge,
      200,
      'purging an existing archive row must succeed — this is the only real hard-delete path'
    );

    // ── MIRROR NEGATIVE: the row is gone, so the same call must now 404. A
    //    second 200 would mean purge never verified the row existed.
    const purgeAgain = await apiCall({
      endpoint: ROUTES_API.ADMIN_PURGE_DELETED_USER,
      method: 'POST',
      token: ctx.adminToken,
      body: { user_id: victim.userId },
    });
    assert.status(
      purgeAgain,
      404,
      'purging an already-purged archive row must 404, proving the first purge really deleted it'
    );
  });
};

// ============================================================================
// 14. SWITCH_BACKEND_DEBUG_MODE — idempotent setter, verified through the stored config
// ============================================================================

const runDebugModeTests = async (ctx: TestContext): Promise<void> => {
  await test('SWITCH_DEBUG_MODE_PERSISTS_THE_STATE_IT_REPORTS', async () => {
    // The read-back goes through ADMIN_GET_CONFIGS (a direct findMany), NOT
    // through GET_RUNTIME_CONFIG_PUBLIC. The public projection is served from a
    // 5-minute per-instance cache that this toggle never invalidates (it writes
    // runtimeConfig.updateMany directly, while ADMIN_UPDATE_CONFIG calls
    // runtimeConfigCache.invalidate) — measured lag, documented as by-design TTL
    // staleness in admin-runtime-config.operations.ts. Asserting on the public
    // read would make this test a clock race, not a coverage test.
    const readStoredVerbose = async (): Promise<string> => {
      const res = await apiCall({
        endpoint: ROUTES_API.ADMIN_GET_CONFIGS,
        token: ctx.adminToken,
      });
      assert.status(res, 200);
      const entry = getData<
        ADMIN_DTO_API_V1['ADMIN_GET_CONFIGS']['RESPONSE']
      >(res).configs.find(c => c.key === 'VERBOSE_LOG_MODE');
      if (!entry) {
        throw new Error('VERBOSE_LOG_MODE is missing from runtime config');
      }
      return entry.value;
    };

    const setVerbose = async (enabled: boolean): Promise<string> => {
      const res = await apiCall({
        endpoint: ROUTES_API.SWITCH_BACKEND_DEBUG_MODE,
        method: 'POST',
        token: ctx.adminToken,
        body: { enabled },
      });
      assert.status(res, 200);
      return getData<{ event: string }>(res).event;
    };

    const originalValue = await readStoredVerbose();
    try {
      assert.equals(await setVerbose(true), 'DEBUG_MODE_ENABLED', 'set on');
      assert.equals(await readStoredVerbose(), 'true', 'stored value is on');

      // A retry of the same request must NOT flip it back (s34: it used to toggle).
      assert.equals(await setVerbose(true), 'DEBUG_MODE_ENABLED', 'retry stays on');
      assert.equals(await readStoredVerbose(), 'true', 'still on after the retry');

      assert.equals(await setVerbose(false), 'DEBUG_MODE_DISABLED', 'set off');
      assert.equals(await readStoredVerbose(), 'false', 'stored value is off');

      const bogus = await apiCall({
        endpoint: ROUTES_API.SWITCH_BACKEND_DEBUG_MODE,
        method: 'POST',
        token: ctx.adminToken,
        body: { bogus: 1 },
      });
      assert.status(bogus, 400);
      assert.equals(await readStoredVerbose(), 'false', 'a junk body changes nothing');
    } finally {
      // Restore the original value through the endpoint that DOES invalidate the
      // cache, so the run never leaves the backend logging verbosely.
      try {
        await apiCall({
          endpoint: ROUTES_API.ADMIN_UPDATE_CONFIG,
          method: 'POST',
          token: ctx.adminToken,
          body: { key: 'VERBOSE_LOG_MODE', value: originalValue },
        });
      } catch {
        /* cleanup must not mask a real failure */
      }
    }

    assert.equals(
      await readStoredVerbose(),
      originalValue,
      'the restore step must put VERBOSE_LOG_MODE back where the run found it'
    );
  });
};

// ============================================================================
// 15. SESSION_CONTAINER_GET_BY_ID + SESSION_CONTAINER_SET_NOTE
// ============================================================================

const runSessionContainerTests = async (ctx: TestContext): Promise<void> => {
  await test('SESSION_CONTAINER_NOTE_ROUND_TRIPS_AND_STAYS_PRIVATE_TO_THE_OWNER', async () => {
    // FRESH CLIENT PER RUN: a client may hold only a limited number of ACTIVE
    // containers at once, and the shared test client is used by the messaging /
    // quota suites in the same run. A new identity starts at zero containers.
    const client = await mintFreshUser('temp-hpg-container');
    let sessionId: string | null = null;
    try {
      const onboard = await apiCall({
        endpoint: ROUTES_API.USER_ONBOARD_AS_CLIENT,
        method: 'POST',
        token: client.token,
        body: {},
      });
      if (onboard.status !== 200 && onboard.status !== 201) {
        throw new Error(`client onboarding failed: ${onboard.status}`);
      }

      const containerName = `smoke-session-${Date.now()}`;
      const createRes = await apiCall({
        endpoint: ROUTES_API.SESSION_CONTAINER_CREATE,
        method: 'POST',
        token: client.token,
        body: { name: containerName },
      });
      assert.status(createRes, 201);
      const created =
        getData<
          SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE']
        >(createRes).session;
      sessionId = created.id;
      assert.equals(
        created.name,
        containerName,
        'the container must be created with the name we passed'
      );

      // Read it back by id and compare the values the create response reported.
      const readRes = await apiCall({
        endpoint: `${ROUTES_API.SESSION_CONTAINER_GET_BY_ID}?session_id=${encodeURIComponent(sessionId)}`,
        token: client.token,
      });
      assert.status(readRes, 200);
      const read =
        getData<
          SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['RESPONSE']
        >(readRes).session;
      assert.equals(read.id, sessionId, 'get-by-id must return the same row');
      assert.equals(
        read.name,
        containerName,
        'get-by-id must report the stored name'
      );
      assert.equals(
        read.lifecycleState,
        created.lifecycleState,
        'get-by-id must agree with create on the lifecycle state'
      );
      assert.equals(
        read.clientNote,
        null,
        'a brand-new container must start with no client note'
      );

      // Write the client-side note and compare the value in BOTH the write
      // response and an independent read.
      const noteText = `smoke client note ${Date.now()}`;
      const setRes = await apiCall({
        endpoint: ROUTES_API.SESSION_CONTAINER_SET_NOTE,
        method: 'POST',
        token: client.token,
        body: { session_id: sessionId, note: noteText, side: 'client' },
      });
      assert.status(setRes, 200);
      const written =
        getData<
          SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['RESPONSE']
        >(setRes).session;
      assert.equals(
        written.clientNote,
        noteText,
        'the write response must echo exactly the note we submitted'
      );
      assert.equals(
        written.stylistNote,
        null,
        'writing the client note must not populate the stylist note'
      );

      const reread = await apiCall({
        endpoint: `${ROUTES_API.SESSION_CONTAINER_GET_BY_ID}?session_id=${encodeURIComponent(sessionId)}`,
        token: client.token,
      });
      assert.status(reread, 200);
      assert.equals(
        getData<
          SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['RESPONSE']
        >(reread).session.clientNote,
        noteText,
        'the stored note must equal the text written (the write actually persisted)'
      );

      // ── MIRROR NEGATIVE: this container was never shared with anyone, so a
      //    stylist asking for it by id must be refused. Without this, the 200s
      //    above do not show that get-by-id is scoped at all.
      const foreignRead = await apiCall({
        endpoint: `${ROUTES_API.SESSION_CONTAINER_GET_BY_ID}?session_id=${encodeURIComponent(sessionId)}`,
        token: ctx.stylistToken,
      });
      if (foreignRead.status === 200) {
        throw new Error(
          'a stylist read an unshared client container by id — the ownership gate is missing'
        );
      }

      const foreignWrite = await apiCall({
        endpoint: ROUTES_API.SESSION_CONTAINER_SET_NOTE,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          session_id: sessionId,
          note: 'injected by a stranger',
          side: 'stylist',
        },
      });
      if (foreignWrite.status === 200) {
        throw new Error(
          'a stylist wrote a note on an unshared client container — the ownership gate is missing'
        );
      }

      assert.equals(
        getData<
          SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['RESPONSE']
        >(
          await apiCall({
            endpoint: `${ROUTES_API.SESSION_CONTAINER_GET_BY_ID}?session_id=${encodeURIComponent(sessionId)}`,
            token: client.token,
          })
        ).session.clientNote,
        noteText,
        'the rejected foreign write must have left the owner note untouched'
      );
    } finally {
      if (sessionId) {
        try {
          await apiCall({
            endpoint: ROUTES_API.SESSION_CONTAINER_CLOSE,
            method: 'POST',
            token: client.token,
            body: { session_id: sessionId },
          });
        } catch {
          /* cleanup must not mask a real failure */
        }
      }
      try {
        await apiCall({
          endpoint: ROUTES_API.USER_DELETE_ANY,
          method: 'POST',
          token: ctx.adminToken,
          body: { id: client.userId },
        });
      } catch {
        /* cleanup must not mask a real failure */
      }
    }
  });
};

// ============================================================================
// ENTRY POINT
// ============================================================================

export async function runHappyPathGapTests(ctx: TestContext): Promise<void> {
  console.log('\n🎯 HAPPY-PATH GAP TESTS\n');

  await runUpdateGalleryRecordTests(ctx);
  await runPairedClientGalleryTests(ctx);
  await runReportGalleryRecordTests(ctx);
  await runApplyStrikeTests(ctx);
  await runAdminNotesTests(ctx);
  await runAdminDictionaryTests(ctx);
  await runUpdatePermissionsTests(ctx);
  await runEmailChangeRequestTests(ctx);
  await runDashboardNoteTests(ctx);
  await runPublicGalleryTests(ctx);
  await runPairingSessionRevokeTests(ctx);
  await runEmailPreferenceTests(ctx);
  await runPurgeDeletedUserTests(ctx);
  await runDebugModeTests(ctx);
  await runSessionContainerTests(ctx);
}
