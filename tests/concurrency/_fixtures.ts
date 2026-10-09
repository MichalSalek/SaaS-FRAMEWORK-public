// tests/concurrency/_fixtures.ts
//
// Isolated, ephemeral fixtures for the LIVE concurrency suite. Two rules:
//   1. ACTORS (who fire racing HTTP calls) must be REAL users with valid sessions
//      — so they are minted through dev-login (Better Auth), never faked.
//   2. SOURCE DATA (gallery records, bookmarks, likes, pairs, reports) is seeded
//      DIRECTLY via SQL keyed to a unique run marker, for determinism + isolation.
//      We never seed via the API path that a family is testing — that would couple
//      the fixture to the code under test.
//
// All ephemeral users carry the `conc-` email prefix; cleanupRun() deletes them and
// lets ON DELETE CASCADE remove every dependent row (StylistAccount, GalleryRecord,
// FavoriteStylist, FavoriteGalleryRecord, ClientStylistPair, SessionContainer,
// ContentReport, Session — all FK-cascade off users). Idempotent and safe to call
// in a finally.
//
// dev-login semantics (verified): a fresh non-existent email → a STYLIST user+account.
// An EXISTING user → dev-login only mints a session (preserves account_type). So an
// ephemeral CLIENT is: SQL-insert users(CLIENT)+ClientAccount, THEN dev-login for a
// real token.

import { getDevLoginToken } from '../utils/api-client';
import { dbQuery, dbQueryOne } from '../utils/db-client';

// Unique-per-process marker. tsx test process → Date.now()/randomUUID are available
// here (this is NOT a workflow script). Two concurrent suite runs never collide.
const RUN_MARKER = `conc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
let seq = 0;
const uid = (): string => `${RUN_MARKER}-${(seq++).toString(36)}`;
const email = (label: string): string => `${uid()}-${label}@example.com`;
const newId = (label: string): string => `${RUN_MARKER}_${label}_${(seq++).toString(36)}`;

export type EphemeralStylist = {
  email: string;
  token: string;
  userId: string;
  accountId: string;
};

export type EphemeralClient = {
  email: string;
  token: string;
  userId: string;
  clientAccountId: string;
};

/**
 * Mint a fresh STYLIST: dev-login on a brand-new email creates the user +
 * stylist_account (ACTIVE), then we read back its ids. Destructive family tests
 * (BAN, plan-change) should target THIS, never the shared seeded stylist.
 */
export const createEphemeralStylist = async (
  label = 'stylist'
): Promise<EphemeralStylist> => {
  const e = email(label);
  const token = await getDevLoginToken(e);
  const row = await dbQueryOne<{ id: string; account_id: string }>(
    `SELECT u.id, sa.account_id
       FROM "users" u JOIN "StylistAccount" sa ON sa.created_by_user_id = u.id
      WHERE u.email = $1`,
    [e]
  );
  if (!row) {
    throw new Error(`createEphemeralStylist: no stylist_account for ${e}`);
  }
  return { email: e, token, userId: row.id, accountId: row.account_id };
};

/**
 * Mint a fresh CLIENT: SQL-insert users(CLIENT)+ClientAccount, then dev-login for a
 * real bearer (existing user ⇒ dev-login only mints a session). Use for the
 * destructive gdpr-erase cascade test and SessionContainer races.
 */
export const createEphemeralClient = async (
  label = 'client'
): Promise<EphemeralClient> => {
  const e = email(label);
  const userId = newId('u');
  const clientAccountId = newId('ca');
  await dbQuery(
    `INSERT INTO "users" (id, email, role_id, account_type, name, updated_at, is_active)
     VALUES ($1, $2, 'role_client', 'CLIENT', 'Conc Client', now(), true)`,
    [userId, e]
  );
  await dbQuery(
    `INSERT INTO "ClientAccount" (client_account_id, created_by_user_id, created_at)
     VALUES ($1, $2, now())`,
    [clientAccountId, userId]
  );
  const token = await getDevLoginToken(e);
  return { email: e, token, userId, clientAccountId };
};

// --- source-data seeders (direct SQL) ---------------------------------------

/** Insert a GalleryRecord for an account. Returns its id. */
export const seedGalleryRecord = async (
  accountId: string,
  opts: { isHidden?: boolean; assetUrl?: string } = {}
): Promise<string> => {
  const id = newId('gr');
  await dbQuery(
    `INSERT INTO "GalleryRecord"
       (gallery_record_id, created_by_account_id, asset_url, nail_length, is_hidden, is_pinned, created_at)
     VALUES ($1, $2, $3, 'MEDIUM', $4, false, now())`,
    [id, accountId, opts.assetUrl ?? `https://example.com/${id}.jpg`, opts.isHidden ?? false]
  );
  return id;
};

/** Insert a FavoriteStylist (bookmark) row: client bookmarks a stylist account. */
export const seedBookmark = async (
  clientUserId: string,
  stylistAccountId: string
): Promise<string> => {
  const id = newId('fs');
  await dbQuery(
    `INSERT INTO "FavoriteStylist" (id, client_user_id, stylist_account_id, created_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (client_user_id, stylist_account_id) DO NOTHING`,
    [id, clientUserId, stylistAccountId]
  );
  return id;
};

/** Insert a FavoriteGalleryRecord (like) row: client likes a gallery record. */
export const seedLike = async (
  clientUserId: string,
  galleryRecordId: string
): Promise<string> => {
  const id = newId('fgr');
  await dbQuery(
    `INSERT INTO "FavoriteGalleryRecord" (id, client_user_id, gallery_record_id, created_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (client_user_id, gallery_record_id) DO NOTHING`,
    [id, clientUserId, galleryRecordId]
  );
  return id;
};

/** Insert an ACTIVE ClientStylistPair (precondition for SessionContainer create). */
export const seedActivePair = async (
  clientUserId: string,
  stylistAccountId: string
): Promise<string> => {
  const id = newId('csp');
  await dbQuery(
    `INSERT INTO "ClientStylistPair" (id, client_user_id, stylist_account_id, status, paired_at)
     VALUES ($1, $2, $3, 'ACTIVE', now())
     ON CONFLICT (client_user_id, stylist_account_id) DO UPDATE SET status='ACTIVE', revoked_at=NULL`,
    [id, clientUserId, stylistAccountId]
  );
  return id;
};

/** Insert a PENDING ContentReport on a gallery record. Returns report_id. */
export const seedContentReport = async (
  reporterUserId: string,
  galleryRecordId: string,
  reason = 'INAPPROPRIATE'
): Promise<string> => {
  const id = newId('cr');
  await dbQuery(
    `INSERT INTO "ContentReport" (id, gallery_record_id, reporter_id, reason, status, created_at)
     VALUES ($1, $2, $3, $4, 'PENDING', now())`,
    [id, galleryRecordId, reporterUserId, reason]
  );
  return id;
};

/** Overwrite the denormalized cached_* counters for an account (fixture setup). */
export const setCachedCounts = async (
  accountId: string,
  counts: { gallery?: number; likes?: number; bookmark?: number }
): Promise<void> => {
  await dbQuery(
    `UPDATE "StylistAccount"
        SET cached_gallery_count  = COALESCE($2, cached_gallery_count),
            cached_likes_count    = COALESCE($3, cached_likes_count),
            cached_bookmark_count = COALESCE($4, cached_bookmark_count)
      WHERE account_id = $1`,
    [accountId, counts.gallery ?? null, counts.likes ?? null, counts.bookmark ?? null]
  );
};

/** Directly set subscription/plan state (stand-in for a Stripe webhook write). */
export const setSubscriptionState = async (
  accountId: string,
  state: {
    pricing_plan?: string;
    subscription_id?: string | null;
    subscription_status?: string | null;
  }
): Promise<void> => {
  await dbQuery(
    `UPDATE "StylistAccount"
        SET pricing_plan        = COALESCE($2, pricing_plan),
            subscription_id     = $3,
            subscription_status = $4,
            last_stripe_event_at = now()
      WHERE account_id = $1`,
    [
      accountId,
      state.pricing_plan ?? null,
      state.subscription_id ?? null,
      state.subscription_status ?? null,
    ]
  );
};

/** Read a stylist account's full plan/sub state for invariant assertions. */
export const readAccountState = async (
  accountId: string
): Promise<{
  pricing_plan: string;
  subscription_id: string | null;
  subscription_status: string | null;
  payment_status: string;
  trial_started_at: Date | null;
} | null> =>
  dbQueryOne(
    `SELECT pricing_plan, subscription_id, subscription_status, payment_status, trial_started_at
       FROM "StylistAccount" WHERE account_id = $1`,
    [accountId]
  );

/** Read a user's disable/delete state for BAN/user-state invariants. */
export const readUserState = async (
  userId: string
): Promise<{
  is_active: boolean;
  disabled_at: Date | null;
  deleted_at: Date | null;
} | null> =>
  dbQueryOne(
    `SELECT is_active, disabled_at, deleted_at FROM "users" WHERE id = $1`,
    [userId]
  );

/** Count non-terminal SessionContainers for a (client_account, stylist_account) pair. */
export const countActiveContainers = async (
  clientAccountId: string,
  stylistAccountId: string
): Promise<number> => {
  const row = await dbQueryOne<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM "SessionContainer"
      WHERE client_account_id = $1 AND stylist_account_id = $2
        AND lifecycle_state NOT IN ('CLOSED','EXPIRED')`,
    [clientAccountId, stylistAccountId]
  );
  return Number(row?.cnt ?? 0);
};

/** Live count of a stylist's bookmarks (FavoriteStylist rows). */
export const countBookmarks = async (stylistAccountId: string): Promise<number> => {
  const row = await dbQueryOne<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM "FavoriteStylist" WHERE stylist_account_id = $1`,
    [stylistAccountId]
  );
  return Number(row?.cnt ?? 0);
};

/**
 * Delete every row created by THIS process (RUN_MARKER-scoped ephemeral users →
 * CASCADE removes accounts/gallery/favorites/pairs/containers/reports/sessions).
 * Scoped to RUN_MARKER (not all `conc-%`) so parallel suite/agent processes never
 * delete each other's in-flight fixtures. Call in a finally. Best-effort: never
 * throws (cleanup failure must not mask a real test result).
 */
export const cleanupRun = async (): Promise<void> => {
  try {
    await dbQuery(`DELETE FROM "users" WHERE email LIKE $1`, [`${RUN_MARKER}-%@example.com`]);
  } catch (e) {
    console.warn('cleanupRun warning:', e instanceof Error ? e.message : e);
  }
};

/**
 * Sweep ALL leftover `conc-%` ephemeral users from prior crashed runs. ONLY safe
 * when this process is the sole concurrency run (the orchestrator at startup) —
 * never call from a parallel context, it would delete other runs' in-flight users.
 */
export const cleanupAllStaleConcUsers = async (): Promise<void> => {
  try {
    await dbQuery(`DELETE FROM "users" WHERE email LIKE 'conc-%@example.com'`);
  } catch (e) {
    console.warn('cleanupAllStaleConcUsers warning:', e instanceof Error ? e.message : e);
  }
};

export { RUN_MARKER };
