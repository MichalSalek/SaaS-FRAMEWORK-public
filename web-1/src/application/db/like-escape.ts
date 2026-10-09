/**
 * escapeLikePattern — escape Postgres LIKE/ILIKE metacharacters in user-supplied
 * search/equality input so Prisma `contains` / `startsWith` / `endsWith` /
 * `equals` with `mode:'insensitive'` (all compiled to `col ILIKE $n` on Postgres)
 * match the input LITERALLY.
 *
 * DECISION (nie usuwaj tego komentarza) — finding testy-api LIKE-class (WF-EXPLORE-LIKE +
 * WF-CITY-500): Prisma passes the raw value into the ILIKE pattern WITHOUT escaping the
 * wildcard metacharacters `%` and `_`, and the default LIKE escape char is backslash.
 * Consequences observed live: (1) a bare `%` in `searchQuery` matched EVERY row
 * (wildcard match-all instead of a literal substring); (2) a value ending in `\`
 * (e.g. city=`%\`) produced Postgres `LIKE pattern must not end with escape character`
 * — a DriverAdapterError that is NOT P2025, so it skipped the cursor-recovery branch and
 * fell through to `databaseFailure` → `respondGeneralError` = an unmapped 500 + a
 * server-side failure event logged on every hit of a PUBLIC endpoint (DoS/log-spam vector).
 *
 * Escape order matters: backslash FIRST (it is itself the escape char), then `%` and `_`.
 * `replace` scans the ORIGINAL string left-to-right (it does not re-scan inserted chars),
 * so a single pass over the char class is correct: `%\` → `\%\\` (valid, literal `%` + `\`).
 *
 * Apply to EVERY user-controlled value that feeds a Prisma `contains`/`equals mode:'insensitive'`
 * filter. Guard the length/emptiness check on the ORIGINAL trimmed value; escape only the
 * copy handed to the query.
 */
export const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, ch => `\\${ch}`);
