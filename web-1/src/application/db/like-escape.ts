/**
 * escapeLikePattern: escape Postgres LIKE/ILIKE metacharacters in user-supplied input so Prisma
 * `contains` / `startsWith` / `endsWith` / `equals` with `mode:'insensitive'` (all compiled to
 * `col ILIKE $n`) match the input LITERALLY.
 *
 * DECISION: Prisma passes the raw value into the ILIKE pattern WITHOUT escaping `%` and `_`, and
 * the default LIKE escape char is backslash. Observed: (1) a bare `%` in `searchQuery` matched EVERY
 * row; (2) a value ending in `\` (e.g. city=`%\`) gave `LIKE pattern must not end with escape
 * character`, a DriverAdapterError that is NOT P2025, so it fell to `databaseFailure` and an unmapped
 * 500 plus a failure event on every hit of a PUBLIC endpoint (log-spam).
 *
 * Escape order matters: backslash FIRST (it is itself the escape char), then `%` and `_`. `replace`
 * scans the ORIGINAL string once (inserted chars are not re-scanned), so one pass over the class is
 * correct: `%\` -> `\%\\`.
 */
export const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, ch => `\\${ch}`);
