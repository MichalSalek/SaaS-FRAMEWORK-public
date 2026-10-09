// DECISION (nie usuwaj tego komentarza):
// Pre-DB sanitizer dla wolno-tekstowych filtrow admina (bot_name / path /
// event_name / user search). Lustro hardeningu kursora event-loga
// (event-log.client.ts isValidCursorFormat): null-byte (U+0000) i
// puste-po-przycieciu wartosci NIE moga trafic do Prisma `where`, bo:
//   - Postgres `text`/`varchar` odrzuca NUL (U+0000) -> Prisma rzuca ->
//     niezmapowany 500 GENERAL_ERROR (opaque) zamiast gracefulnego ignoru filtra.
//   - kursor uzyl strict-allowlist (cuid ma staly ksztalt); tu filtry sa wolnym
//     tekstem (path zawiera `/` `.` `%`, nazwa bota spacje, event_name `_`), wiec
//     allowlist by odrzucal legalny input. Wlasciwym lustrem jest denylist STRIP
//     dokladnie tego bajtu ktorego PG nie przyjmuje (U+0000) -- minimalny,
//     zachowujacy zachowanie fix. Inne control-chars sa legalne dla PG text, nie
//     ruszamy ich.
// Semantyka identyczna z kursorem: malformowany/pusty filtr => brak filtra (null),
// nie 5xx i nie 400 (kontrakt HTTP handlera bez zmian).

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
