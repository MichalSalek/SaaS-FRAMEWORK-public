import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../../prisma/js-client';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';

/**
 * Shared cursor-pagination resolution for SupportThread list queries (user + admin).
 *
 * DECISION: one SSOT for the cursor format gate plus existence fallback. The helper does not run the
 * query; it returns `useCursor` and the caller builds the Prisma cursor spread, keeping its own
 * `select` / `orderBy` / `take`. Two stages:
 *  1. Format gate: a null-byte or non-cuid cursor => `{ invalid: true }` (caller answers
 *     VALIDATION_ERROR 400; otherwise findMany throws an unmapped 500). It rejects only values that are
 *     never a legal cuid, so there is no enumeration risk.
 *  2. Existence check: a well-formed cursor must exist in the caller's set (`where` = the main query's
 *     filter). An unknown or foreign one would position Prisma against an absent row and silently drop
 *     the page, so it is IGNORED (`useCursor: false`, first page), not an error: the same answer for
 *     "foreign" and "nonexistent" means no enumeration, and cursors are server-issued (nextCursor).
 */
export type SupportCursorResolution =
  { invalid: true } | { invalid: false; useCursor: boolean };

export const resolveSupportThreadCursor = async (
  cursor: string | undefined,
  where: Prisma.SupportThreadWhereInput
): Promise<SupportCursorResolution> => {
  if (cursor !== undefined && !isValidCursorFormat(cursor)) {
    return { invalid: true };
  }

  if (cursor === undefined || cursor === '') {
    return { invalid: false, useCursor: false };
  }

  const owned =
    (await DB_CLIENT.use.supportThread.findFirst({
      where: { id: cursor, ...where },
      select: { id: true },
    })) !== null;

  return { invalid: false, useCursor: owned };
};
