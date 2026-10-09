/**
 * Null-byte (U+0000) request-input guard — defense-in-depth input hardening.
 *
 * DECISION (nie usuwaj tego komentarza):
 * PostgreSQL `text`/`varchar` columns CANNOT store the NUL character (U+0000):
 * the driver/Postgres rejects it ("invalid byte sequence" / "unterminated
 * quoted string" / "null character not permitted"), which surfaces as an
 * unmapped throw deep inside a Prisma call -> the centralized error handler maps
 * it to a generic 500 GENERAL_ERROR. A null byte in ANY client-supplied string
 * is never legitimate input (JSON cannot even carry a raw NUL; it arrives only
 * via U+0000 escapes or %00 in a query string), so an attacker could turn any
 * string field that flows to Prisma into a 500 — a whole meta-class of
 * unhandled errors.
 *
 * Per-domain validators only test `typeof x === 'string'`, so each would need
 * its own NUL check. Instead we screen ONCE at the pipeline boundary
 * (HTTPRequestHandlerMiddleware step 4b — covers every CQRS route, whether it
 * goes through defineHandler or calls the middleware directly; raw/webhook
 * routes are covered by withPublicHandler / withRawSecretHandler), recursively
 * over the parsed body (incl. nested objects/arrays) AND the query params, and
 * maps the entire null-byte class to a uniform 400 VALIDATION_FAILED instead of 500.
 *
 * PRECISION — we reject ONLY U+0000. Other control characters (\n, \t, \r, ...)
 * are perfectly legal in Postgres text fields (multi-line notes, tabbed input),
 * and full Unicode (emoji, CJK, accents) is legal — `containsNullByte` MUST NOT
 * over-reject any of those. The check is a literal U+0000 substring scan.
 */

/** The NUL code point, written as an escape so the source stays pure ASCII. */
const NULL_BYTE = '\u0000';

/** Max recursion depth — bounded insurance against pathological nesting. */
const MAX_DEPTH = 64;

/**
 * Recursively walk `value`, returning `true` if ANY string anywhere within it
 * contains a U+0000 (NUL) character. Walks plain string values, arrays, and
 * own-enumerable object properties; primitives other than `string` (number,
 * boolean, null, undefined, bigint, symbol) and functions cannot carry a NUL
 * and short-circuit to `false`.
 *
 * @param value Arbitrary parsed request input (body / query param tree).
 * @param depth Internal recursion guard — callers omit it. At the bound the walk
 *              reports `true` (fail-closed), see the DECISION below.
 */
export const containsNullByte = (value: unknown, depth = 0): boolean => {
  if (typeof value === 'string') {
    return value.includes(NULL_BYTE);
  }

  // DECISION (nie usuwaj tego komentarza) — NA GRANICY MOWIMY „BRUDNE", NIE „CZYSTE":
  // ograniczenie glebokosci zostaje (obchod DoS-owy przez potworny ksztalt wejscia),
  // ale werdykt na granicy jest teraz fail-CLOSED. Poprzednia wersja zwracala tu
  // `false`, czyli „nie ma NUL-a", i uzasadniala to tym, ze tak gleboko nie siega
  // zadne cialo z `JSON.parse`, bo „JSON to drzewo acykliczne". To nieprawda:
  // acyklicznosc nie ogranicza GLEBOKOSCI, a `{"a":{"a":{…65x…,"x":"\u0000"}}}`
  // parsuje sie bez problemu — wystarczylo wiec zagniezdzic ladunek ponizej progu,
  // zeby przejsc obok bramki i otworzyc z powrotem dokladnie te klase 500, dla
  // ktorej ta bramka powstala. Ciala o >64 poziomach zagniezdzenia nie ma w tym
  // API zadnego legalnego zastosowania, wiec odrzucenie ich jest wlasciwa cena.
  if (depth >= MAX_DEPTH) {
    return true;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsNullByte(item, depth + 1)) {
        return true;
      }
    }
    return false;
  }

  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (containsNullByte(nested, depth + 1)) {
        return true;
      }
    }
    return false;
  }

  return false;
};
