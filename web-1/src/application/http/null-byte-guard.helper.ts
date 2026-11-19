/**
 * Null-byte (U+0000) request-input guard — defense-in-depth input hardening.
 *
 * DECISION: PostgreSQL `text`/`varchar` cannot store U+0000; the driver rejects it, which
 * surfaces as an unmapped throw inside a Prisma call and a generic 500. A NUL in client input
 * is never legitimate, and per-domain validators only test `typeof x === 'string'`, so we
 * screen ONCE at the pipeline boundary (HTTPRequestHandlerMiddleware step 4b for defineHandler
 * routes; withPublicHandler / withRawSecretHandler for raw/webhook routes), recursively over
 * body and query, and map the class to a uniform 400 VALIDATION_FAILED.
 *
 * Only U+0000 is rejected. Other control characters (\n, \t, \r) and full Unicode are legal
 * in Postgres text, so `containsNullByte` must not over-reject them (literal substring scan).
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

  // DECISION: at the depth bound we answer "dirty", not "clean" (fail-closed). Returning `false`
  // there was wrong: JSON being acyclic does not bound its DEPTH, so a payload nested just below
  // the threshold (`{"a":{"a":{...65x..."x":"\u0000"}}}`) parsed fine and passed the gate,
  // reopening the 500 class. Bodies deeper than 64 levels have no legitimate use in this API.
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
