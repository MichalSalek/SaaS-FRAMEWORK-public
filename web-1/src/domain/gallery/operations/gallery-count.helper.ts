/**
 * Gallery — `cached_gallery_count` write-path (single owner).
 *
 * `cached_gallery_count` is a denormalized counter on StylistAccount that belongs to the
 * GALLERY concern (public photo_count + catalog ranking orderBy cached_gallery_count DESC).
 * This module is the ONE owner of every increment/decrement of that column, shared by the
 * three writer sites: gallery-create (increment), gallery-delete (decrement) and the
 * moderation cluster (HIDE/DELETE/BAN decrement). Moderation imports FROM here — gallery
 * owns the counter, so the dependency direction is moderation → gallery (never the reverse).
 *
 * Both helpers MUST be called INSIDE an active interactive `$transaction` (tx) so the counter
 * mutation commits/rolls back atomically with the record create/delete/hide it accompanies.
 */

import type { Prisma } from '../../../prisma/js-client';

// DECISION: this file is the only writer of cached_gallery_count: increment (create) and decrement
// (delete, moderation HIDE/DELETE/BAN) share one floor semantics. The row lock lives in @app/db/lock-rows and the deadlock
// detection (isDeadlockError) in moderation-admin-concurrency.helper.ts: concurrency concerns, not the counter. Dependency direction is moderation -> gallery, never the reverse.

// Increment in a single round-trip. Increment never produces a negative value, but we keep it
// as a single UPDATE statement (no read-modify-write) for parity with the floored decrement and
// to stay race-safe under concurrent inserts. `by` is always a record count (>=1 at every caller),
// interpolated as ${by}::int — parameterized, not concatenated. Returns the number of rows changed.
export const incrementGalleryCount = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  by: number
): Promise<number> => {
  return tx.$executeRaw`
    UPDATE "StylistAccount"
       SET "cached_gallery_count" = "cached_gallery_count" + ${by}::int
     WHERE "account_id" = ${accountId}`;
};

// DECISION: the decrement is GREATEST(0, count - n) in one round-trip (race-safe without a lock,
// idempotent under existing understated drift); a bare {decrement:n} went below zero once the counter was
// already low. The column has a CHECK(>=0) backstop (migration 20261023100000) but the floor stays in the writer:
// public photo_count and the ranking orderBy cached_gallery_count DESC cannot be negative. The counter
// is the VISIBLE count (is_hidden=false), matching cached-counts-backfill.ts. `by` is always a row count
// (>=1 at every caller) bound as ${by}::int. Returns the number of changed rows.
export const decrementGalleryCountFloored = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  by: number
): Promise<number> => {
  return tx.$executeRaw`
    UPDATE "StylistAccount"
       SET "cached_gallery_count" = GREATEST(0, "cached_gallery_count" - ${by}::int)
     WHERE "account_id" = ${accountId}`;
};
