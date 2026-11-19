import { Prisma } from '../../prisma/js-client';
import {
  recordLockAcquisition,
  sortLockTargets,
  lockKey,
  type LockMode,
  type LockTable,
  type LockTarget,
} from './lock-order';

export type LockedStylistAccount = { account_id: string };

// StylistAccount: no @@map -> table "StylistAccount", PK "account_id". The single StylistAccount lock
// (moderation, gallery, favorites, salon, email, pairing revoke). Returns null for a missing row.
export const lockStylistAccount = async (
  tx: Prisma.TransactionClient,
  accountId: string
): Promise<LockedStylistAccount | null> => {
  recordLockAcquisition(tx, 'StylistAccount', accountId, 'FOR UPDATE');
  const rows = await tx.$queryRaw<LockedStylistAccount[]>`
    SELECT "account_id" FROM "StylistAccount" WHERE "account_id" = ${accountId} FOR UPDATE`;
  return rows[0] ?? null;
};

export type LockedUser = { id: string };

// DECISION: a broadcast locks one announcement, then inserts notifications for a dynamic user set.
// This cannot follow the static parent order; callers use withWriteTx for deadlock retries.
export const lockAnnouncementForBroadcast = async (
  tx: Prisma.TransactionClient,
  id: string
): Promise<void> => {
  await tx.$queryRaw`SELECT id FROM "Announcement" WHERE id = ${id} FOR UPDATE`;
};

// User: @@map("users") (Better Auth) -> table "users", PK "id". A pessimistic row lock on the user
// row is the lowest element of the global order (User -> StylistAccount -> SessionContainer ->
// SupportThread), so taking it FIRST keeps the ABBA invariant. Consumer: addSupportMessage_IO
// (User-first, then lockSupportThreadRow): it serializes per-user message adds so the per-user
// hourly cap is AUTHORITATIVE (the count sees the previous add's commit).
// The moderation copy (BAN, strikes) was merged here: same SQL, same `{ id } | null` result, null for
// a missing row. Consumers: support add-message, session create/share, salon pairing, moderation.
export const lockUserRow = async (
  tx: Prisma.TransactionClient,
  userId: string
): Promise<LockedUser | null> => {
  recordLockAcquisition(tx, 'User', userId, 'FOR UPDATE');
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
  return rows[0] ?? null;
};

export type LockedActivePair = { id: string };

// ClientStylistPair: no @@map -> table "ClientStylistPair", PK "id". A pessimistic FOR UPDATE on
// the row of an ACTIVE pair serializes a stylist's read/write with a parallel revoke: revoke is an
// UPDATE status->REVOKED, so our lock either waits for its commit and re-evaluates the WHERE
// (Postgres EPQ), excluding the row once REVOKED, or goes first and revoke waits. Returns the row
// or null (not ACTIVE / missing).
// Test: tests/concurrency/lock-order.concurrency.ts (covers the visit write barrier vs revoke lock
// order on live Postgres; not every caller of this helper).
//
// SCOPE: ONLY status=ACTIVE + lock. The `is_active` guard (soft-deleted client) is enforced per
// caller where it exists; `requireActiveClient` makes the visit write barrier mirror the outer
// `findActivePairing`.
// DECISION: LOCK-ORDER for ClientStylistPair (rank 30): after User and StylistAccount, before
// SessionContainer and VisitRecord. The visit write barrier pre-acquires the pair's User and
// StylistAccount in KEY SHARE before this lock, because the VisitRecord insert's FK check would
// take them later (cycle with revoke, LOCK_GRAPH.md C2).

export const lockActivePair = async (
  tx: Prisma.TransactionClient,
  clientUserId: string,
  stylistAccountId: string,
  { requireActiveClient = false }: { requireActiveClient?: boolean } = {}
): Promise<LockedActivePair | null> => {
  // The pair is addressed by its unique (client, stylist) key, so that key is its id in the order.
  recordLockAcquisition(
    tx,
    'ClientStylistPair',
    `${clientUserId}:${stylistAccountId}`,
    'FOR UPDATE'
  );
  const activeClientClause = requireActiveClient
    ? Prisma.sql`AND EXISTS (
         SELECT 1 FROM "users" u
          WHERE u."id" = "ClientStylistPair"."client_user_id"
            AND u."is_active" = true
       )`
    : Prisma.empty;

  // DECISION: the `Prisma.sql` fragment is composed through `Prisma.sql` and the FINISHED object is
  // passed as an ARGUMENT to `$queryRaw(...)`. Do NOT put `${activeClientClause}` straight into a
  // TAGGED template (tx.$queryRaw`...`): it looks identical and is broken. Nested fragments are
  // flattened by the `Sql` constructor via `child instanceof Sql`, which holds only when fragment and
  // outer template come from the same `sql-template-tag` module instance. In the tagged form the
  // Prisma client runtime builds the outer template while this file builds the fragment; under
  // Next/Turbopack (dev and prod) those are different classes, `instanceof` is false and the
  // fragment goes to Postgres as a BIND PARAMETER (`... 'ACTIVE' $3 FOR UPDATE` -> 42601 syntax
  // error at "$3" -> 500 on every path taking this lock; the `Prisma.empty` branch breaks the same
  // way, so contact-reveal too). Bare node works with both forms (same client, 7.10.0), so it is
  // bundling, not Prisma. The argument form is safe by construction: flattening happens in
  // `Prisma.sql` in THIS module, so both sides of `instanceof` share one module copy. It is the
  // repo-wide convention (guard `nf/prisma-nested-sql`).
  const query = Prisma.sql`
    SELECT "id"
      FROM "ClientStylistPair"
     WHERE "client_user_id" = ${clientUserId}
       AND "stylist_account_id" = ${stylistAccountId}
       AND "status"::text = 'ACTIVE'
       ${activeClientClause}
     FOR UPDATE`;
  const rows = await tx.$queryRaw<LockedActivePair[]>(query);
  return rows[0] ?? null;
};

export type LockedVisitRecord = { id: string };

/** Shared serializer for text messages and mutable session cards. */
export const lockConversation = async (
  tx: Prisma.TransactionClient,
  pairId: string
): Promise<{ id: string; last_message_at: Date | null } | null> => {
  recordLockAcquisition(tx, 'ClientStylistPair', pairId, 'FOR UPDATE');
  const rows = await tx.$queryRaw<
    Array<{ id: string; last_message_at: Date | null }>
  >`
    SELECT "id", "last_message_at" FROM "ClientStylistPair"
    WHERE "id" = ${pairId} FOR UPDATE`;
  return rows[0] ?? null;
};

// VisitRecord: no @@map -> table "VisitRecord", PK "id". A pessimistic lock on the parent row
// serializes every writer of this visit's result_photos (position = max+1), closing the race on
// @@unique([visit_record_id, position]).
// DECISION: the consumer (addVisitResultPhoto_IO) takes pair (rank 30) -> this lock (rank 50), and
// its insert references only this VisitRecord, so it stays inside the order.
export const lockVisitRecord = async (
  tx: Prisma.TransactionClient,
  visitRecordId: string
): Promise<LockedVisitRecord | null> => {
  recordLockAcquisition(tx, 'VisitRecord', visitRecordId, 'FOR UPDATE');
  const rows = await tx.$queryRaw<LockedVisitRecord[]>`
    SELECT "id" FROM "VisitRecord" WHERE "id" = ${visitRecordId} FOR UPDATE`;
  return rows[0] ?? null;
};

export type LockedGalleryRecord = { created_by_account_id: string };

// GalleryRecord: brak @@map -> tabela "GalleryRecord", PK "gallery_record_id". Lock-and-READ
// (zwraca właściciela) serializuje równoległe edycje TEGO SAMEGO rekordu.
// DECISION: why lock, and why `FOR NO KEY UPDATE`. updateGalleryRecord_IO replaces colour/trait
// junctions via deleteMany+createMany. Without a lock, two parallel edits under READ COMMITTED
// interleaved: the second deleteMany waited for the first's commit but, holding an older snapshot,
// did not see its newly inserted rows, and its createMany then inserted the same pairs -> P2002 on
// @@unique([gallery_record_id, color_id]) -> 500 (10 of 15 parallel edits). `skipDuplicates` is not a
// fix: it removes the 500 but leaves the SUM of both sets, while an edit must leave the last
// writer's set. The parent-row lock serializes fully: the second edit starts from the state after
// the first's commit and its set wins whole.
// `FOR NO KEY UPDATE` rather than `FOR UPDATE`: it conflicts with other NO KEY UPDATE/UPDATE (so
// editors serialize) but NOT with `FOR KEY SHARE`, which Postgres takes on FK checks, so inserting a
// favourite, a session photo or a junction pointing at this record does not wait for an edit. The
// final `galleryRecord.update` (non-key column) takes the same level anyway. Rank 60; gallery-delete
// (StylistAccount -> DELETE GalleryRecord) waits for us, we wait for nothing it holds.
export const lockGalleryRecord = async (
  tx: Prisma.TransactionClient,
  galleryRecordId: string
): Promise<LockedGalleryRecord | null> => {
  recordLockAcquisition(
    tx,
    'GalleryRecord',
    galleryRecordId,
    'FOR NO KEY UPDATE'
  );
  const rows = await tx.$queryRaw<LockedGalleryRecord[]>`
    SELECT "created_by_account_id" FROM "GalleryRecord"
     WHERE "gallery_record_id" = ${galleryRecordId} FOR NO KEY UPDATE`;
  return rows[0] ?? null;
};

export type LockedOwnedStylistAccount = {
  account_id: string;
  subscription_status: string | null;
};

// StylistAccount addressed by its owner (`created_by_user_id` is @unique), lock-and-READ of
// subscription_status. Consumer: disableSelfUser_IO's active-subscription gate, which must re-read
// the status under the same lock the Stripe webhook's write waits on. Recorded with the real
// account_id AFTER the statement, because the id is only known from the row.
export const lockStylistAccountByOwnerUser = async (
  tx: Prisma.TransactionClient,
  ownerUserId: string
): Promise<LockedOwnedStylistAccount | null> => {
  const rows = await tx.$queryRaw<LockedOwnedStylistAccount[]>`
    SELECT "account_id", "subscription_status"
      FROM "StylistAccount"
     WHERE "created_by_user_id" = ${ownerUserId}
       FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  recordLockAcquisition(tx, 'StylistAccount', row.account_id, 'FOR UPDATE');
  return row;
};

export type LockedSessionContainer = { id: string };

// SessionContainer: no @@map, PK "id". Per-session write serializer (rationale: the DECISION at
// lockSessionContainerRow in session-container-concurrency.helper.ts, which delegates here).
export const lockSessionContainer = async (
  tx: Prisma.TransactionClient,
  sessionId: string
): Promise<LockedSessionContainer | null> => {
  recordLockAcquisition(tx, 'SessionContainer', sessionId, 'FOR UPDATE');
  const rows = await tx.$queryRaw<LockedSessionContainer[]>`
    SELECT "id"
      FROM "SessionContainer"
     WHERE "id" = ${sessionId}
       FOR UPDATE`;
  return rows[0] ?? null;
};

export type LockedSupportThreadRaw = {
  id: string;
  user_id: string;
  status: string;
  subject: string;
};

// SupportThread: no @@map, PK "id". Raw row; lockSupportThreadRow (support domain) narrows `status`
// (rationale for the lock: the DECISION there).
export const lockSupportThread = async (
  tx: Prisma.TransactionClient,
  threadId: string
): Promise<LockedSupportThreadRaw | null> => {
  recordLockAcquisition(tx, 'SupportThread', threadId, 'FOR UPDATE');
  const rows = await tx.$queryRaw<LockedSupportThreadRaw[]>`
    SELECT "id", "user_id", "status", "subject"
      FROM "SupportThread"
     WHERE "id" = ${threadId}
       FOR UPDATE`;
  return rows[0] ?? null;
};

// Identifiers come from this constant map only (never from input), so Prisma.raw is safe here.
const LOCK_TABLE_SQL: Record<
  Exclude<LockTable, 'ClientStylistPair'>,
  { table: string; pk: string }
> = {
  User: { table: '"users"', pk: '"id"' },
  StylistAccount: { table: '"StylistAccount"', pk: '"account_id"' },
  SessionContainer: { table: '"SessionContainer"', pk: '"id"' },
  VisitRecord: { table: '"VisitRecord"', pk: '"id"' },
  GalleryRecord: { table: '"GalleryRecord"', pk: '"gallery_record_id"' },
  SupportThread: { table: '"SupportThread"', pk: '"id"' },
};

export type LockInOrderTarget = LockTarget & {
  table: Exclude<LockTable, 'ClientStylistPair'>;
};

export type LockInOrderResult = {
  /** True when the row existed and is now locked by this transaction. */
  isLocked: (table: LockTable, id: string) => boolean;
};

/**
 * Lock several rows in the canonical order (LOCK_RANK, then id), one statement per row. Duplicates
 * collapse to the strongest requested mode. A missing row is skipped (isLocked() === false), the same
 * null semantics as the single-row primitives; the caller decides what a missing row means.
 *
 * DECISION: this orders only the rows passed IN THIS CALL. It does not reorder locks the tx already
 * holds or will take later; the lock-order checker reports those mistakes in dev and tests. The pair
 * lock keeps its own primitive (lockActivePair: composite key + ACTIVE predicate), called after this.
 */
export const lockInOrder = async (
  tx: Prisma.TransactionClient,
  targets: readonly LockInOrderTarget[]
): Promise<LockInOrderResult> => {
  const locked = new Set<string>();
  for (const target of sortLockTargets(targets)) {
    if (target.table === 'ClientStylistPair') {
      // Unreachable through the LockInOrderTarget type; kept as a runtime guard.
      throw new Error('lockInOrder: lock ClientStylistPair via lockActivePair');
    }
    const sql = LOCK_TABLE_SQL[target.table];
    recordLockAcquisition(tx, target.table, target.id, target.mode);
    const mode: LockMode = target.mode;
    const query = Prisma.sql`SELECT 1 AS "locked" FROM ${Prisma.raw(sql.table)} WHERE ${Prisma.raw(sql.pk)} = ${target.id} ${Prisma.raw(mode)}`;
    const rows = await tx.$queryRaw<{ locked: number }[]>(query);
    if (rows.length > 0) {
      locked.add(lockKey(target.table, target.id));
    }
  }
  return {
    isLocked: (table, id) => locked.has(lockKey(table, id)),
  };
};

// DECISION: webhook per-account serialization uses a TRANSACTION-scoped advisory lock
// (`pg_advisory_xact_lock`), not a session-level `pg_try_advisory_lock`. It is taken on the tx's
// own connection and released on commit/rollback, so it works under Neon transaction pooling
// (a session lock is DEAD there: acquire and unlock land on different backends). It BLOCKS (not
// `_try_`) until acquired, so concurrent operations on one key (webhooks of one account) run in
// series and the second reads the already-committed snapshot. Consumer: subscription-lifecycle.handler
// (key = customerId, customer<->account 1:1); it closes the lost update on the D10 no-op gate (the
// gate compared a STALE snapshot, so a newer rescind got lost behind an older cancel). Key -> bigint
// via md5 (a hash collision means needless serialization of two keys, never a correctness error).
// This is not a ROW lock (no entry in the global User->StylistAccount->... order) and is orthogonal
// to row locks; the webhook handler takes only this one advisory lock.
export const acquireAdvisoryXactLock = async (
  tx: Prisma.TransactionClient,
  key: string
): Promise<void> => {
  // DECISION: `::text` is NOT decoration. `pg_advisory_xact_lock()` returns `void`, which the
  // Prisma driver adapter cannot deserialize: a bare `$queryRaw` of that column throws "Failed to
  // deserialize column of type 'void'" on EVERY call, so the lock did not just fail to serialize, it
  // rolled back the whole webhook transaction (checkout.session.completed + customer.subscription.*).
  // Casting to `text` yields an empty string the adapter decodes; lock semantics are untouched. It
  // stays `$queryRaw` because this is a SELECT. Regression gate:
  // `tests/concurrency/advisory-xact-lock.concurrency.ts` (handler unit tests MOCK this function and
  // cannot catch it).
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint)::text AS locked`;
};
