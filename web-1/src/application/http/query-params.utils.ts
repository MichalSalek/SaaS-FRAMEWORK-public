/** Extract a string query param (handles string[] from Next.js) */
export const qStr = (
  query: Record<string, string | string[] | undefined>,
  key: string
): string | null => {
  const v = query[key];
  if (typeof v === 'string' && v.length > 0) {
    return v;
  }
  return null;
};

/** Extract a numeric query param (handles string[] from Next.js) */
export const qNum = (
  query: Record<string, string | string[] | undefined>,
  key: string
): number | null => {
  const v = qStr(query, key);
  if (v === null) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Integer query param (take/limit/page/offset): qNum floored. `take=1.5` reached
 * Prisma as a float and failed its integer validation → HTTP 500 on ~16 list
 * endpoints (testy-api s34). Every pagination param goes through this.
 */
export const qInt = (
  query: Record<string, string | string[] | undefined>,
  key: string
): number | null => {
  const n = qNum(query, key);
  return n === null ? null : Math.floor(n);
};

// DECISION (nie usuwaj tego komentarza):
// Pagination ceiling — client-supplied offset/page flows into Prisma skip ->
// Postgres OFFSET (int8/bigint, max ~9.2e18). A raw float like 1e20 (or int8max+1)
// overflows OFFSET -> Prisma throws -> unmapped HTTP 500 + spurious DATABASE_ERROR
// log. We clamp BELOW that: 10_000_000 is well within int8, stays in JS safe-integer
// range, and keeps derived skip = (page-1)*limit safe even at the largest page-size
// cap (100): 1e7 * 100 = 1e9, still within int4. No endpoint legitimately needs to
// page past 1e7 (page-size caps are 5/100), so past-end requests yield an empty page
// (200), not 500. Floors to an integer because Prisma skip rejects non-integer floats.
export const PAGINATION_CEILING = 10_000_000;

/**
 * Clamp a (possibly client-supplied) integer to [min, max] and floor to an int.
 * Use for any numeric param that reaches Prisma skip/take so an out-of-range or
 * fractional value can never overflow Postgres bigint OFFSET or trip Prisma's
 * integer validation. NaN/Infinity are coerced to `min` (defensive — callers
 * should already have passed through qNum, which returns null for non-finite).
 */
export const clampInt = (value: number, max: number, min = 0): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.floor(Math.min(Math.max(value, min), max));
};

/**
 * Clamp a pagination offset to [0, PAGINATION_CEILING]. Past-end offsets resolve
 * to an empty page (200) instead of overflowing Postgres OFFSET into an HTTP 500.
 */
export const clampOffset = (value: number): number =>
  clampInt(value, PAGINATION_CEILING);

/** Extract a boolean query param ('true'/'false') */
export const qBool = (
  query: Record<string, string | string[] | undefined>,
  key: string
): boolean | null => {
  const v = qStr(query, key);
  if (v === 'true') {
    return true;
  }
  if (v === 'false') {
    return false;
  }
  return null;
};

/** Extract a string array query param (handles repeated keys: ?key=a&key=b) */
export const qStrArray = (
  query: Record<string, string | string[] | undefined>,
  key: string
): string[] | null => {
  const v = query[key];
  if (Array.isArray(v) && v.length > 0) {
    return v;
  }
  if (typeof v === 'string' && v.length > 0) {
    return [v];
  }
  return null;
};
