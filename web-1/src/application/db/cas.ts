import { isP2025 } from './prisma-error';

/**
 * cas — compare-and-set / idempotent-write primitives that make "mutate-then-act-on-the-write-result"
 * the named default, replacing the racy "read-then-write" (findFirst → delete/update) the deep-hardening
 * pass found 33 bugs in. Both take the typed Prisma call as a THUNK so T / model arg-types are inferred
 * exactly (zero `any`, zero delegate-generics).
 */

/**
 * deleteIfExists — run a Prisma delete and return the deleted row, or `null` if the row was already
 * gone (P2025), instead of throwing. Lets the follow-up mutation gate on the ACTUAL deleted row (e.g.
 * its is_hidden) rather than a prior findFirst, and makes idempotent "delete-or-already-deleted" the
 * default. Structural P2025 (Turbopack-safe, NOT instanceof). Any non-P2025 error rethrows.
 *
 * Usage: const deleted = await deleteIfExists(() => tx.favoriteGalleryRecord.delete({ where, select }));
 *        if (deleted === null) return success(false);   // idempotent
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
 * casUpdate — run a conditional `updateMany` whose WHERE carries the compare-and-set guard, and
 * return the affected-row count so the caller branches on the WRITE result, NOT a prior read.
 * count===0 means the guard did not hold (lost the race / precondition false / row absent) — the
 * caller classifies that domain-specifically (re-fetch to distinguish not-found vs conflict). Using
 * updateMany (not update) is deliberate: the guard predicate is non-unique, and updateMany returns
 * count instead of throwing P2025, so the precondition becomes atomic with the write.
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
