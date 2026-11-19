import { VALIDATION_REGEX, VALIDATION_LENGTHS } from '../validation.config';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { ValidationFlag } from './validation.types';

export const hasReturnObjectValidationError = (
  obj: ValidationFlag & unknown
) => {
  return Object.keys(obj).every(objKey => {
    const key = objKey as keyof ValidationFlag & unknown;
    if (objKey === '__isValid') {
      return true;
    }
    return !obj[key];
  });
};

/**
 * Validates the FORMAT of a cursor-pagination cursor (a Prisma `@default(cuid())`
 * primary key) BEFORE it reaches a Prisma `findMany` cursor anchor.
 *
 * DECISION: a cuid id matches `[a-z0-9]{20,40}` (cuid v1 = 25 chars `c...`, cuid2 = 24). The format
 * gate before a cursor reaches Prisma gives two effects: (1) input robustness: a null byte (\0) or
 * other sequences illegal for PG `text` would throw in Prisma as an unmapped 500 GENERAL_ERROR; the
 * gate rejects them before the DB (the caller returns the first page, not a 5xx). (2) defense in depth
 * against a PK-existence oracle: Prisma `cursor` anchors a row by PK across the WHOLE table before
 * applying `where`, so a foreign (victim's) cuid vs a fabricated one gives a different result, a 1-bit
 * oracle; the gate plus the caller's ownership check closes the leak. SSOT for both call sites
 * (user-session.operations, event-log.client): do not duplicate the regex inline.
 */
export const isValidCursorFormat = (value: string): boolean =>
  /^[a-z0-9]{20,40}$/.test(value);

/**
 * Normalizes a Polish NIP: strips spaces, hyphens and an optional "PL" country prefix.
 * Returns the raw digit string (length and checksum are isValidNip's job).
 */
export const normalizeNip = (value: string): string =>
  value.replace(/[\s-]/g, '').replace(/^PL/i, '').trim();

/**
 * Waliduje polski NIP (numer identyfikacji podatkowej) — checksum modulo 11.
 *
 * DECISION: the one NIP validator for backend (zod `.refine`) and frontend (client-side field
 * validator), one algorithm, no drift. Rule: after normalisation exactly 10 digits; the sum of the
 * first 9 digits times weights [6,5,7,2,3,4,5,6,7] modulo 11 must equal the 10th digit. If
 * `mod === 10` the NIP is REJECTED (no such NIP exists; 10 does not fit one check digit).
 */
export const isValidNip = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false;
  }
  const nip = normalizeNip(value);
  if (!/^\d{10}$/.test(nip)) {
    return false;
  }
  const digits = nip.split('').map(Number);
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * (digits[i] ?? 0), 0);
  const checkDigit = sum % 11;
  if (checkDigit === 10) {
    return false;
  }
  return checkDigit === digits[9];
};

export const validateEmail = (value: unknown) => {
  // Type guard before .match(): a truthy non-string (array/object/number/boolean)
  // would otherwise throw `TypeError: value.match is not a function` → 500 instead
  // of a clean validation failure. Falsy values (incl. '') are invalid emails.
  if (typeof value !== 'string' || !value) {
    return false;
  }
  // RFC 5321 cap before the regex: every email schema gets it here, so no caller
  // can forget it and a multi-KB string never reaches the pattern.
  if (value.length > VALIDATION_LENGTHS.EMAIL_MAX) {
    return false;
  }
  const reg = VALIDATION_REGEX.EMAIL;
  return Boolean(value.match(reg));
};

export const validateByMinLength = (
  value: string | undefined | null,
  minLength: number = 3
): boolean => {
  if (!value) {
    return false;
  }
  return value.length >= minLength;
};

export const validateByMaxLength = (
  value: string | undefined | null,
  maxLength: number
): boolean => {
  if (!value) {
    return true; // Empty is valid for max length check
  }
  return value.length <= maxLength;
};

export const validateByWhiteSpaces = (value: unknown): boolean => {
  // Type guard before .match(): a truthy non-string would otherwise throw
  // `TypeError: value.match is not a function` → 500. Treat non-strings/falsy as
  // failing (caller already surfaces an invalid-value error for those).
  if (typeof value !== 'string' || !value) {
    return false;
  }
  return !value.match(VALIDATION_REGEX.WHITESPACE);
};

/** Liczba samych CYFR w numerze — znaki formatujące (+, spacje, myślniki, nawiasy) pomijane. */
export const countPhoneDigits = (value: string): number =>
  (value.match(/\d/g) ?? []).length;

/** Którą granicę długości numer przekracza (`null` = mieści się). */
export type PhoneLengthIssue = 'tooShort' | 'tooLong' | null;

/**
 * SSOT długości numeru telefonu dla WSZYSTKICH walidatorów (kernel + front).
 *
 * DECISION: the PHONE_MIN..PHONE_MAX (9-15) range counts DIGITS, not characters. Both call sites used
 * to compare `trimmed.length`, the length of the WHOLE string, while the same validator's PHONE_FORMAT
 * regex deliberately allows `+`, spaces, dashes and parentheses: "+48 22 123 45 67" (11 digits, 16
 * characters) was rejected with "must have 9-15 digits", although the message, the constant's docs
 * ("E.164 ... digits only") and the regex all talk about digits. The front field has no `maxLength`,
 * so users hit this with normal number notation. The raw-string ceiling is PHONE_FIELD_MAX (20), the
 * constant that exists for exactly this and is already used by the stylist's venue phone field
 * (account.validation.ts). A too-long number gets `tooLong`, not `tooShort`.
 */
export const checkPhoneLength = (trimmed: string): PhoneLengthIssue => {
  if (trimmed.length > VALIDATION_LENGTHS.PHONE_FIELD_MAX) {
    return 'tooLong';
  }
  const digits = countPhoneDigits(trimmed);
  if (digits < VALIDATION_LENGTHS.PHONE_MIN) {
    return 'tooShort';
  }
  if (digits > VALIDATION_LENGTHS.PHONE_MAX) {
    return 'tooLong';
  }
  return null;
};

export const validatePhone = (value: string | undefined | null): boolean => {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();

  // Length validation: 9-15 DIGITS (see checkPhoneLength DECISION)
  if (checkPhoneLength(trimmed) !== null) {
    return false;
  }

  // Format validation: digits, +, spaces, dashes, parentheses
  const phoneRegex = VALIDATION_REGEX.PHONE_FORMAT;
  return phoneRegex.test(trimmed);
};

export const normalizeStringEliminateWhitespaces = (
  value: string | undefined | null
): string => {
  if (!value) {
    return '';
  }
  return value.trim().replace(VALIDATION_REGEX.WHITESPACE, '').toLowerCase();
};

export const normalizeStringCapitalizedWords = (
  value: string | undefined | null
): string => {
  if (!value) {
    return '';
  }

  return (
    value
      .replace(VALIDATION_REGEX.UNICODE_WORD_CLEANUP, ' ')
      .replace(VALIDATION_REGEX.WHITESPACE, ' ')
      .trim()
      // DECISION: the word regex has NO \b anchors. JS \b is defined by ASCII \w even under /u, so for
      // a name starting with a Polish diacritic (Łukasz, Żaneta) it fired between the diacritic and the
      // next letter, the match started at the second letter, the inner ^ capitalised it (ukasz->Ukasz)
      // and left the diacritic untouched -> "ŁUkasz". The Unicode class [\p{L}\p{N}']+ matches the whole
      // word from its first letter; the inner (^|'|after-digit) capitalises the first letter, after an
      // apostrophe (O'Brien) and after a digit. Do not restore \b: it breaks every name starting with a
      // non-ASCII character (PL/DE market).
      .replace(/[\p{L}\p{N}']+/gu, word =>
        word.replace(/(^|'|(?<=\d))[\p{L}]/gu, char => char.toLocaleUpperCase())
      )
  );
};

/**
 * Liczba ZNAKÓW w rozumieniu użytkownika = punkty kodowe Unicode, nie jednostki
 * UTF-16. `'😀'.length === 2`, ale `countCodePoints('😀') === 1`; flaga 🇵🇱 to 2
 * punkty kodowe (dwa regional indicators), sekwencja ZWJ (👩‍💻) to 3.
 *
 * DECISION: limits on human-written content (message, CRM note, visit note) are counted in code
 * points, consistently in the kernel validator (zod `.refine`), the frontend counter and the error
 * message ("maksymalnie N znaków"). Zod `.max()` and `String.length` count UTF-16 units, so emoji
 * writers got half the declared limit and the database counted yet another way. The one measure is
 * `Array.from(s).length` (the string iterator walks code points).
 */
export const countCodePoints = (value: string): number =>
  Array.from(value).length;

// An unpaired surrogate: a high one (D800-DBFF) with no following low one, or a low
// one (DC00-DFFF) with no preceding high one. Well-formed pairs (emoji) do not match.
const UNPAIRED_SURROGATE_RE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * True, gdy ciąg zawiera osierocony (niesparowany) surogat UTF-16.
 *
 * DECISION: such a string is not valid Unicode: JSON.parse lets `"\uD800"` through, and the PostgreSQL
 * driver silently replaced it with U+FFFD when encoding to UTF-8, changing user content without
 * warning. The validator REJECTS it with `validation.general.invalidCharacters` instead. A NUL byte
 * (U+0000) is rejected earlier by the middleware (null-byte-guard), a separate, broader gate.
 */
export const hasUnpairedSurrogate = (value: string): boolean =>
  UNPAIRED_SURROGATE_RE.test(value);

/**
 * Validates an optional string field. Returns error if:
 * - value is present but not a string
 * - value is a string exceeding maxLength
 */
export const validateOptionalString = (
  value: unknown,
  maxLength: number
): boolean => {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  return value.length <= maxLength;
};

export const validateOptionalHttpsUrl = (
  value: unknown,
  maxLength: number
): boolean => {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  if (value.length === 0) {
    return true;
  } // empty string = no URL provided (optional)
  if (value.length > maxLength) {
    return false;
  }
  if (value !== value.trim()) {
    return false;
  } // reject leading/trailing whitespace
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') {
    return false;
  }
  if (parsed.hostname.length === 0) {
    return false;
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return false;
  }
  return true;
};

/**
 * Prefix of every asset our browser-side uploads land under. The browser uploads
 * to the image CDN and the API stores only the URL, so the ONLY thing the API can
 * assert about an `asset_url` in a request body is that it points at our own
 * delivery host — this predicate is that assertion.
 *
 * DECISION: one shared constant, replacing two local copies (`gallery.validation.ts`,
 * `visit.validation.ts`) when the stylist avatar became the third consumer; otherwise a delivery host
 * change means finding N literals. Deliberately `startsWith`, not URL parsing: this is an "our CDN"
 * gate, not address validation; the full scheme allowlist for user-TYPED addresses is
 * `validateOptionalHttpsUrl` (used by the `website` field).
 */
export const CLOUDINARY_ASSET_URL_PREFIX = 'https://res.cloudinary.com/';

export const CLOUDINARY_CLOUD_NAME = 'example-cloud';
export const CLOUDINARY_UPLOAD_URL_PREFIX = `${CLOUDINARY_ASSET_URL_PREFIX}${CLOUDINARY_CLOUD_NAME}/image/upload/`;
const CLOUDINARY_SAFE_PATH = /^[A-Za-z0-9_\-./,:]+$/;

export const isCloudinaryAssetUrl = (value: string): boolean =>
  value.startsWith(CLOUDINARY_UPLOAD_URL_PREFIX) &&
  value.length > CLOUDINARY_UPLOAD_URL_PREFIX.length &&
  CLOUDINARY_SAFE_PATH.test(value.slice(CLOUDINARY_UPLOAD_URL_PREFIX.length)) &&
  !value.split('/').some(segment => segment === '.' || segment === '..');

/**
 * Validates a required `id` field. Rejects falsy values and non-string types.
 *
 * Use for validators where the entire payload is a single `{ id }` field.
 * For multi-field payloads, run this check manually on the `id` slice only.
 *
 * Does NOT check for empty strings as valid ids (falsy check included).
 */
export const validateRequiredId = (
  data: unknown,
  idErrorMessage: string
): DetailedErrorPayload<{ id: string }> & ValidationFlag => {
  const typedData = data as { id?: unknown } | null | undefined;

  const returnObject: DetailedErrorPayload<{ id: string }> & ValidationFlag = {
    __isValid: false,
    __general: '',
    id: '',
  };

  if (typeof typedData?.id !== 'string' || typedData.id === '') {
    returnObject.id += idErrorMessage + ' ';
  }

  returnObject.__isValid = hasReturnObjectValidationError(returnObject);
  return returnObject;
};

/**
 * Najwcześniejsza data, którą stos NAPRAWDĘ przyjmuje: `0001-01-01T00:00:00Z`.
 *
 * DECISION: the floor is year 1 CE, from measurement, not from the Postgres docs. The constant was
 * first set to the theoretical `timestamp` minimum (4713 BCE), which was too low: on the live stack
 * `0001-01-01` passes, while `0000-12-31` and everything earlier (`-004712`, `-004000`, `-000001`) still
 * ends in an opaque 500. PostgreSQL supports BCE dates; the driver path (era encoding) does not, so the
 * stack is the binding constraint. No real date in this product (visit, subscription, cursor) is
 * earlier. There is deliberately no upper bound: PostgreSQL reaches year 294276 and JavaScript ends at
 * 275760, so any date JS can build is below the database ceiling.
 */
const POSTGRES_MIN_TIMESTAMP_MS = -62135596800000;

/**
 * Parses a user-supplied date and rejects one PostgreSQL will not accept.
 *
 * DECISION: `Date.parse` + `isNaN` is not enough. Dates valid for JavaScript but outside the database
 * range (e.g. `-271821-04-20T00:00:00.000Z`) passed validation, reached Prisma and came back as "time
 * zone displacement out of range", i.e. DATABASE_ERROR -> opaque 500: hostile input classified as a DB
 * failure. Worse, a logged-in user could produce an unbounded series of them with one URL parameter,
 * each writing a full DATABASE_ERROR record to the error store and firing a PostHog alert. Returns
 * `null` for unparseable AND out-of-range values so callers treat both the same (cursor: first page;
 * form field: 400 validation error).
 */
const LEADING_CALENDAR_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})(?![0-9])/;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

/**
 * DECISION: the calendar is checked by hand. V8 does not reject an impossible day of the month in an
 * ISO string, it ROLLS it over: `new Date('2026-02-31')` is 3 March, `'2026-04-31'` is 1 May. A visit
 * date form therefore saved a different date than typed, with no error. The day of the leading
 * `YYYY-MM-DD` must exist in that month. The check uses the STRING's components, not the parsed UTC
 * ones: `2026-03-01T00:30:00+02:00` is 28 February in UTC, so a UTC comparison would reject a valid
 * date with a zone offset. For a date without time (parsed as UTC) it is exactly "parsed Y-M-D ===
 * input Y-M-D".
 */
const hasImpossibleCalendarDay = (value: string): boolean => {
  const match = LEADING_CALENDAR_DATE_REGEX.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month);
};

export const parsePgSafeDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return null;
  }
  if (typeof value === 'string' && hasImpossibleCalendarDay(value)) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  const time = parsed.getTime();
  if (Number.isNaN(time) || time < POSTGRES_MIN_TIMESTAMP_MS) {
    return null;
  }
  return parsed;
};

/** Object wrapper for barrel re-export compatibility */
export const validationUtils = {
  isValidCursorFormat,
  parsePgSafeDate,
  normalizeNip,
  isValidNip,
  validateEmail,
  validateByMinLength,
  validateByMaxLength,
  validateByWhiteSpaces,
  validatePhone,
  countPhoneDigits,
  checkPhoneLength,
  normalizeStringEliminateWhitespaces,
  normalizeStringCapitalizedWords,
  validateOptionalString,
  validateOptionalHttpsUrl,
  isCloudinaryAssetUrl,
  validateRequiredId,
  countCodePoints,
  hasUnpairedSurrogate,
} as const;
