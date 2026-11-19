// DECISION: free-text admin filters (bot_name, path, event_name, user search) only strip NUL
// (U+0000) and trim; empty after cleaning means "no filter". Postgres text rejects NUL, so it would
// reach Prisma `where` as an unmapped 500. A strict allowlist (as for cuid cursors) would reject
// legal input (`/`, `.`, `%`, spaces, `_`), and other control characters are valid PG text.
// Malformed input degrades to no filter, never 5xx or 400, like the event-log cursor.

/**
 * Strip NUL bytes (U+0000) from a string -- the only byte Postgres text columns
 * reject. Other control characters are valid in PG text and are preserved.
 *
 * Uses split/join on the NUL string literal (not a regex literal) to avoid
 * ESLint `no-control-regex` while stripping exactly U+0000.
 */
const stripNullBytes = (value: string): string =>
  value.split('\u0000').join('');

/**
 * Normalize a free-text admin filter for safe use in a Prisma `where` clause:
 * strip NUL bytes, then trim. Returns `null` when the input is null/undefined or
 * becomes empty after cleaning -- callers treat `null` as "no filter"
 * (graceful-ignore), mirroring the event-log cursor degradation contract.
 */
export const cleanAdminFilter = (
  value: string | null | undefined
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = stripNullBytes(value).trim();
  return cleaned.length > 0 ? cleaned : null;
};
