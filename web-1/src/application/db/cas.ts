import { isP2025 } from './prisma-error';

/**
 * cas: compare-and-set / delete-or-already-gone primitives that make "mutate-then-act-on-the-write-result"
 * the named default, replacing the racy "read-then-write" (findFirst -> delete/update). Both take the
 * typed Prisma call as a THUNK so T / model arg-types are inferred exactly (zero `any`).
 */

/**
 * deleteIfExists: run a Prisma delete and return the deleted row, or `null` if the row was already
 * gone (P2025), instead of throwing. The follow-up mutation can gate on the ACTUAL deleted row (e.g.
 * its is_hidden) rather than a prior findFirst, and a second delete of the same row is a no-op
 * returning `null`. Structural P2025 (Turbopack-safe, NOT instanceof). Any non-P2025 error rethrows.
 * No test pins the retry or concurrent-delete case.
 *
 * Usage: const deleted = await deleteIfExists(() => tx.favoriteGalleryRecord.delete({ where, select }));
 *        if (deleted === null) return success(false);   // already gone
 *        if (!deleted.record.is_hidden) await decrement(...);
 */
export const deleteIfExists = async <T>(
  deleteThunk: () => Promise<T>
): Promise<T | null> => {
  try {
    return await deleteThunk();
  } catch (error) {
    if (isP2025(error)) {
      return null;
    }
    throw error;
  }
};

/**
 * casUpdate: run a conditional `updateMany` whose WHERE carries the compare-and-set guard, and
 * return the affected-row count so the caller branches on the WRITE result, NOT a prior read.
 * count===0 means the guard did not hold (lost the race / precondition false / row absent); the
 * caller classifies that domain-specifically (re-fetch to distinguish not-found vs conflict). Using
 * updateMany (not update) is deliberate: the guard predicate is non-unique, and updateMany returns
 * count instead of throwing P2025. The guard is evaluated inside the same UPDATE statement as the
 * write, not in a separate read. No test pins that interleaving.
 *
 * Usage: const n = await casUpdate(() => tx.stylistAccount.updateMany({ where: { account_id, ...guard }, data }));
 *        if (n === 0) { ...classify why the guard failed... }
 */
export const casUpdate = async (
  updateManyThunk: () => Promise<{ count: number }>
): Promise<number> => {
  const result = await updateManyThunk();
  return result.count;
};
