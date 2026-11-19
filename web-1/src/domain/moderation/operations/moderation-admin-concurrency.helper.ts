/**
 * Moderation admin — concurrency helpers.
 *
 * Extracted from moderation-admin.operations.ts to keep the operation under the
 * max-lines budget and to group the two concurrency concerns surfaced by QA
 * (admin-state-cascade-l2-1 deadlock):
 *   1. the row locks — now in @app/db/lock-rows (see the DECISION below).
 *   2. isDeadlockError — detect SQLSTATE 40P01 (withWriteTx retry predicate, finding l2-1).
 *
 * NOTE: the floored cached_gallery_count writer moved to gallery (gallery owns that counter):
 * gallery/operations/gallery-count.helper.ts → decrementGalleryCountFloored / incrementGalleryCount.
 * Moderation imports it FROM gallery; this file keeps only the lock + deadlock-detector concern.
 */

import { isDeadlock } from '@app/db/prisma-error';

// DECISION: the StylistAccount and User row locks that lived here (lockStylistAccountRow, lockUserRow) were
// merged into @app/db/lock-rows (same SQL, same `{ id } | null` results). resolveContentReport_IO takes them
// through lockInOrder: User (BAN only) -> StylistAccount, before any ContentReport write. The StylistAccount
// is the one common ancestor of ALL reports of the account, so two resolves of sibling reports serialize on
// it instead of cross-locking each other's ContentReport rows (the 40P01 cycle of finding l2-1).

// DECISION: the canonical 40P01 structural detector lives in application/db/prisma-error.ts (isDeadlock),
// shared with session-container (isConcurrencyConflict) and the favorite-remove deadlock retry. It is
// re-exported here under a domain name so the resolve-report call site keeps its context: after the
// deterministic lock (StylistAccount via lockInOrder) the cycle is eliminated, so isDeadlockError in
// resolveContentReport_IO is the withWriteTx retry predicate for hidden cascade/FK locks. A deadlock left after
// the retries is a DATABASE_ERROR, never ALREADY_RESOLVED (a 40P01 does not mean another moderation won).
// isSerializationConflict catches 40001, a different error.
export const isDeadlockError = isDeadlock;
