/**
 * Characterization tests for the kernel validation utils
 * (`.shared-kernel/policies/validation/validation.utils.ts`): pins the boolean verdict,
 * __isValid and which field is rejected, not i18n text. Boundaries are derived from
 * VALIDATION_LENGTHS and VALIDATION_REGEX.
 * Security priority:
 *  - validateOptionalHttpsUrl: 9 documented bypass vectors (javascript:, data:, vbscript:,
 *    file:, http, whitespace, credentials, empty host, case), each with a reject test.
 *  - isValidCursorFormat: cuid oracle defense, format [a-z0-9]{20,40}.
 *  - validateEmail / validatePhone / validateByMin|MaxLength / validateRequiredId.
 * Helpers are tested both directly and through the `validationUtils` object
 * (VALIDATION_POLICY.utils); both must agree.
 */
import { describe, it, expect } from 'vitest';
import {
  isValidCursorFormat,
  parsePgSafeDate,
  validateEmail,
  validateByMinLength,
  validateByMaxLength,
  validateByWhiteSpaces,
  validatePhone,
  normalizeStringEliminateWhitespaces,
  normalizeStringCapitalizedWords,
  validateOptionalString,
  validateOptionalHttpsUrl,
  validateRequiredId,
  validationUtils,
  hasReturnObjectValidationError,
  isCloudinaryAssetUrl,
} from '@kernel/policies/validation/validation.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';

// ── Helper: a field is "rejected" when its accumulated error string is non-empty. ──
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

// ────────────────────────────────────────────────────────────────────────────
//  isValidCursorFormat — cuid format gate (oracle-defense, null-byte robustness)
// ────────────────────────────────────────────────────────────────────────────
describe('isValidCursorFormat (cuid format gate)', () => {
  it('accepts a lowercase-alphanumeric cuid of length 20..40', () => {
    expect(isValidCursorFormat('a'.repeat(20))).toBe(true);
    expect(isValidCursorFormat('cjld2cjxh0000qzrmn831i7rn')).toBe(true); // cuid v1, 25 chars
    expect(isValidCursorFormat('clf3k2j9x0000abcd1234efgh')).toBe(true);
    expect(isValidCursorFormat('z9'.repeat(20))).toBe(true); // 40 chars exactly
  });

  it('rejects values shorter than 20 or longer than 40', () => {
    expect(isValidCursorFormat('a'.repeat(19))).toBe(false);
    expect(isValidCursorFormat('a'.repeat(41))).toBe(false);
    expect(isValidCursorFormat('')).toBe(false);
  });

  it('SECURITY: rejects uppercase, hyphens, and non-[a-z0-9] characters', () => {
    expect(isValidCursorFormat('A'.repeat(25))).toBe(false); // uppercase
    expect(isValidCursorFormat('cjld2cjxh-000qzrmn831i7rn')).toBe(false); // hyphen
    expect(isValidCursorFormat('cjld2cjxh.000qzrmn831i7rn')).toBe(false); // dot
  });

  it('SECURITY: rejects a null-byte / control char (the documented Prisma-500 vector)', () => {
    expect(isValidCursorFormat('cjld2cjxh\x00000qzrmn831i7')).toBe(false);
    expect(isValidCursorFormat('cjld2cjxh\n000qzrmn831i7rnn')).toBe(false);
  });

  it('SECURITY: anchored regex rejects an injection wrapped around a valid cuid', () => {
    // A valid 25-char cuid embedded in extra chars must NOT pass (^...$ anchors).
    expect(isValidCursorFormat(`${'a'.repeat(25)} OR 1=1`)).toBe(false);
    expect(isValidCursorFormat(`x'${'a'.repeat(25)}`)).toBe(false);
  });

  it('agrees with the validationUtils object wrapper', () => {
    expect(VALIDATION_POLICY.utils.isValidCursorFormat('a'.repeat(25))).toBe(
      true
    );
    expect(validationUtils.isValidCursorFormat('A'.repeat(25))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  validateEmail
// ────────────────────────────────────────────────────────────────────────────
describe('validateEmail', () => {
  it('accepts well-formed addresses (dots, #, underscore in local part)', () => {
    for (const ok of [
      'user@example.com',
      'a.b@sub.example.co',
      'has#hash@example.com',
      'with_underscore@example.com',
    ]) {
      expect(validateEmail(ok), ok).toBe(true);
    }
  });

  it('accepts plus-addressing in the local part', () => {
    expect(validateEmail('tag+plus@example.com')).toBe(true);
    expect(validateEmail('user.name+tag@example.com')).toBe(true);
  });

  it('rejects empty / missing-at / missing-domain-dot shapes', () => {
    for (const bad of [
      '',
      'plainstring',
      'no-at-sign.com',
      'user@nodot',
      '@example.com',
      'user@',
    ]) {
      expect(validateEmail(bad), bad).toBe(false);
    }
  });

  it('SECURITY: type-guards non-string input (never throws TypeError → no 500)', () => {
    expect(validateEmail(undefined)).toBe(false);
    expect(validateEmail(null)).toBe(false);
    expect(validateEmail(123 as unknown)).toBe(false);
    expect(validateEmail({} as unknown)).toBe(false);
    expect(validateEmail(['user@example.com'] as unknown)).toBe(false);
    expect(validateEmail(true as unknown)).toBe(false);
  });

  it('agrees with the validationUtils object wrapper', () => {
    expect(validationUtils.validateEmail('user@example.com')).toBe(true);
    expect(validationUtils.validateEmail('nope')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  validateByMinLength — default min 3, falsy → false
// ────────────────────────────────────────────────────────────────────────────
describe('validateByMinLength', () => {
  it('uses default min of 3 when no min provided', () => {
    expect(validateByMinLength('ab')).toBe(false);
    expect(validateByMinLength('abc')).toBe(true);
  });

  it('respects an explicit min (boundary derived from VALIDATION_LENGTHS)', () => {
    const min = VALIDATION_LENGTHS.NAME_MIN; // 2
    expect(validateByMinLength('x'.repeat(min - 1), min)).toBe(false);
    expect(validateByMinLength('x'.repeat(min), min)).toBe(true);
  });

  it('treats falsy (empty string, null, undefined) as invalid', () => {
    expect(validateByMinLength('')).toBe(false);
    expect(validateByMinLength(null)).toBe(false);
    expect(validateByMinLength(undefined)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  validateByMaxLength — falsy → TRUE (empty is valid for a max check)
// ────────────────────────────────────────────────────────────────────────────
describe('validateByMaxLength', () => {
  it('SURPRISE: treats falsy (empty / null / undefined) as VALID (empty passes max check)', () => {
    const max = VALIDATION_LENGTHS.NAME_MAX;
    expect(validateByMaxLength('', max)).toBe(true);
    expect(validateByMaxLength(null, max)).toBe(true);
    expect(validateByMaxLength(undefined, max)).toBe(true);
  });

  it('rejects strings above max, accepts at/below the boundary (derived from config)', () => {
    const max = VALIDATION_LENGTHS.NAME_MAX; // 100
    expect(validateByMaxLength('x'.repeat(max), max)).toBe(true);
    expect(validateByMaxLength('x'.repeat(max + 1), max)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  validateByWhiteSpaces — true iff string has NO whitespace
// ────────────────────────────────────────────────────────────────────────────
describe('validateByWhiteSpaces', () => {
  it('accepts a non-empty string with no whitespace', () => {
    expect(validateByWhiteSpaces('nowhitespace')).toBe(true);
  });

  it('rejects strings containing any whitespace (space, tab, newline)', () => {
    expect(validateByWhiteSpaces('has space')).toBe(false);
    expect(validateByWhiteSpaces('tab\there')).toBe(false);
    expect(validateByWhiteSpaces('line\nbreak')).toBe(false);
  });

  it('SECURITY: type-guards non-string / falsy (never throws → no 500)', () => {
    expect(validateByWhiteSpaces('')).toBe(false);
    expect(validateByWhiteSpaces(undefined)).toBe(false);
    expect(validateByWhiteSpaces(null)).toBe(false);
    expect(validateByWhiteSpaces(42 as unknown)).toBe(false);
    expect(validateByWhiteSpaces({} as unknown)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  validatePhone — 9..15 CYFR after trim (+ PHONE_FIELD_MAX ceiling on the raw
//  string), PHONE_FORMAT allowlist
// ────────────────────────────────────────────────────────────────────────────
describe('validatePhone', () => {
  it('accepts well-formed numbers within the PHONE_MIN..PHONE_MAX DIGIT window', () => {
    expect(validatePhone('123456789')).toBe(true); // 9 digits = PHONE_MIN
    expect(validatePhone('(12) 345-6789')).toBe(true); // 10 digits + format chars
  });

  // REGRESJA (czerwony przed poprawka): zakres liczony byl w ZNAKACH, wiec normalnie
  // zapisany numer z odstepami i nawiasami wypadal poza okno 9-15 mimo poprawnej liczby
  // cyfr — i dostawal komunikat „musi miec 9-15 cyfr". Kazdy z ponizszych ma 11 cyfr
  // i WIECEJ niz 15 znakow, wiec pod stara regula bylby odrzucony.
  it('accepts a normally formatted number whose CHARACTER count exceeds PHONE_MAX', () => {
    expect('+48 22 123 45 67'.length).toBeGreaterThan(
      VALIDATION_LENGTHS.PHONE_MAX
    );
    expect(validatePhone('+48 22 123 45 67')).toBe(true);
    expect(validatePhone('+48 (22) 123-45-67')).toBe(true);
  });

  // Odwrotna strona tej samej regresji: ciag mieszczacy sie w 9-15 ZNAKACH, ale majacy
  // za malo CYFR, byl wczesniej akceptowany jako poprawny numer.
  it('rejects a short-on-digits value that fits the old character window', () => {
    expect(validatePhone('+48 123 456')).toBe(false); // 8 cyfr, 11 znakow
    expect(validatePhone('(((((((((')).toBe(false); // 0 cyfr, 9 znakow
  });

  it('rejects too few / too many DIGITS (boundary from VALIDATION_LENGTHS)', () => {
    expect(validatePhone('1'.repeat(VALIDATION_LENGTHS.PHONE_MIN - 1))).toBe(
      false
    );
    expect(validatePhone('1'.repeat(VALIDATION_LENGTHS.PHONE_MAX + 1))).toBe(
      false
    );
  });

  // Sufit na SUROWY ciag: poprawna liczba cyfr, ale rozdeta formatowaniem ponad
  // PHONE_FIELD_MAX (= szerokosc kolumny/pola) nadal odpada.
  it('rejects a valid digit count padded past PHONE_FIELD_MAX with format chars', () => {
    const padded = '+48 (22) 123 - 45 - 67';
    expect(padded.length).toBeGreaterThan(VALIDATION_LENGTHS.PHONE_FIELD_MAX);
    expect(validatePhone(padded)).toBe(false);
  });

  it('SECURITY: rejects disallowed characters (letters, XSS punctuation) via the format allowlist', () => {
    expect(validatePhone('123456abc')).toBe(false);
    expect(validatePhone('12345<script>')).toBe(false);
    expect(validatePhone('123456789;DROP')).toBe(false);
  });

  it('treats falsy (empty / null / undefined) as invalid', () => {
    expect(validatePhone('')).toBe(false);
    expect(validatePhone(null)).toBe(false);
    expect(validatePhone(undefined)).toBe(false);
  });

  it('trims before measuring length (surrounding whitespace does not count)', () => {
    // '  123456789  ' trims to 9 valid digits → accepted.
    expect(validatePhone('  123456789  ')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  normalizeStringEliminateWhitespaces
// ────────────────────────────────────────────────────────────────────────────
describe('normalizeStringEliminateWhitespaces', () => {
  it('strips ALL whitespace and lowercases', () => {
    expect(normalizeStringEliminateWhitespaces('  Hello   World  ')).toBe(
      'helloworld'
    );
    expect(normalizeStringEliminateWhitespaces('A\tB\nC')).toBe('abc');
  });

  it('returns empty string for falsy input', () => {
    expect(normalizeStringEliminateWhitespaces('')).toBe('');
    expect(normalizeStringEliminateWhitespaces(null)).toBe('');
    expect(normalizeStringEliminateWhitespaces(undefined)).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  normalizeStringCapitalizedWords
// ────────────────────────────────────────────────────────────────────────────
describe('normalizeStringCapitalizedWords', () => {
  it('capitalizes the first letter of each word and collapses whitespace', () => {
    expect(normalizeStringCapitalizedWords('anna   kowalska')).toBe(
      'Anna Kowalska'
    );
    expect(normalizeStringCapitalizedWords('  jane mary  ')).toBe('Jane Mary');
  });

  it("capitalizes the letter after an apostrophe (O'Brien style)", () => {
    expect(normalizeStringCapitalizedWords("o'brien")).toBe("O'Brien");
  });

  it('strips disallowed punctuation (UNICODE_WORD_CLEANUP) into separators', () => {
    // Non-letter/number/space/apostrophe chars are replaced with a space → word break.
    expect(normalizeStringCapitalizedWords('anna@kowalska')).toBe(
      'Anna Kowalska'
    );
  });

  it('returns empty string for falsy input', () => {
    expect(normalizeStringCapitalizedWords('')).toBe('');
    expect(normalizeStringCapitalizedWords(null)).toBe('');
    expect(normalizeStringCapitalizedWords(undefined)).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  validateOptionalString — undefined/null OK, non-string reject, length cap
// ────────────────────────────────────────────────────────────────────────────
describe('validateOptionalString', () => {
  const MAX = VALIDATION_LENGTHS.DESCRIPTION_MAX; // 1000

  it('accepts undefined / null (optional field)', () => {
    expect(validateOptionalString(undefined, MAX)).toBe(true);
    expect(validateOptionalString(null, MAX)).toBe(true);
  });

  it('SURPRISE: accepts an empty string (length 0 <= max)', () => {
    expect(validateOptionalString('', MAX)).toBe(true);
  });

  it('rejects non-string types when present', () => {
    expect(validateOptionalString(123 as unknown, MAX)).toBe(false);
    expect(validateOptionalString({} as unknown, MAX)).toBe(false);
    expect(validateOptionalString([] as unknown, MAX)).toBe(false);
    expect(validateOptionalString(true as unknown, MAX)).toBe(false);
  });

  it('rejects strings over maxLength, accepts at the boundary (derived from config)', () => {
    expect(validateOptionalString('x'.repeat(MAX), MAX)).toBe(true);
    expect(validateOptionalString('x'.repeat(MAX + 1), MAX)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  validateOptionalHttpsUrl — SECURITY CORE: 9 documented bypass vectors
// ────────────────────────────────────────────────────────────────────────────
describe('validateOptionalHttpsUrl (XSS scheme-allowlist hardening)', () => {
  const MAX = VALIDATION_LENGTHS.ICON_URL_MAX; // 500

  it('accepts undefined / null / empty string (optional field = no URL)', () => {
    expect(validateOptionalHttpsUrl(undefined, MAX)).toBe(true);
    expect(validateOptionalHttpsUrl(null, MAX)).toBe(true);
    expect(validateOptionalHttpsUrl('', MAX)).toBe(true);
  });

  it('accepts a well-formed https URL', () => {
    expect(
      validateOptionalHttpsUrl('https://res.cloudinary.com/demo/x.png', MAX)
    ).toBe(true);
    expect(validateOptionalHttpsUrl('https://example.com', MAX)).toBe(true);
    expect(
      validateOptionalHttpsUrl('https://example.com/path?q=1#frag', MAX)
    ).toBe(true);
  });

  it('rejects a non-string value when present', () => {
    expect(validateOptionalHttpsUrl(123 as unknown, MAX)).toBe(false);
    expect(validateOptionalHttpsUrl({} as unknown, MAX)).toBe(false);
  });

  it('SECURITY vector 1: rejects javascript: scheme', () => {
    expect(validateOptionalHttpsUrl('javascript:alert(1)', MAX)).toBe(false);
  });

  it('SECURITY vector 2: rejects javascript: regardless of case (URL lowercases protocol)', () => {
    expect(validateOptionalHttpsUrl('JavaScript:alert(1)', MAX)).toBe(false);
    expect(validateOptionalHttpsUrl('JAVASCRIPT:alert(1)', MAX)).toBe(false);
  });

  it('SECURITY vector 3: rejects data: scheme (data:text/html)', () => {
    expect(
      validateOptionalHttpsUrl('data:text/html,<script>alert(1)</script>', MAX)
    ).toBe(false);
  });

  it('SECURITY vector 4: rejects vbscript:/file:/ftp:/ws:/wss:/chrome: (only https allowed)', () => {
    for (const bad of [
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/x',
      'ws://example.com',
      'wss://example.com',
      'chrome://settings',
    ]) {
      expect(validateOptionalHttpsUrl(bad, MAX), bad).toBe(false);
    }
  });

  it('SECURITY vector 5: rejects http:// (HTTPS-only policy)', () => {
    expect(validateOptionalHttpsUrl('http://example.com', MAX)).toBe(false);
  });

  it('SECURITY vector 6: rejects leading whitespace', () => {
    expect(validateOptionalHttpsUrl('  https://example.com', MAX)).toBe(false);
    expect(validateOptionalHttpsUrl('\thttps://example.com', MAX)).toBe(false);
  });

  it('SECURITY vector 7: rejects trailing whitespace / newline', () => {
    expect(validateOptionalHttpsUrl('https://example.com\n', MAX)).toBe(false);
    expect(validateOptionalHttpsUrl('https://example.com ', MAX)).toBe(false);
  });

  it('SECURITY vector 8: rejects embedded credentials (user:pass@host)', () => {
    expect(validateOptionalHttpsUrl('https://user:pass@example.com', MAX)).toBe(
      false
    );
    expect(validateOptionalHttpsUrl('https://user@example.com', MAX)).toBe(
      false
    );
  });

  it('SECURITY vector 9: rejects unparseable URL / empty host (https: with no host)', () => {
    expect(validateOptionalHttpsUrl('https:', MAX)).toBe(false);
    expect(validateOptionalHttpsUrl('not a url at all', MAX)).toBe(false);
    expect(validateOptionalHttpsUrl('https://', MAX)).toBe(false);
  });

  it('rejects a value over maxLength even if otherwise a valid https URL', () => {
    const tooLong = 'https://example.com/' + 'a'.repeat(MAX);
    expect(validateOptionalHttpsUrl(tooLong, MAX)).toBe(false);
  });

  it('agrees with the validationUtils object wrapper on the core reject', () => {
    expect(
      validationUtils.validateOptionalHttpsUrl('javascript:alert(1)', MAX)
    ).toBe(false);
    expect(
      validationUtils.validateOptionalHttpsUrl('https://example.com', MAX)
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  validateRequiredId — returns DetailedErrorPayload + __isValid
// ────────────────────────────────────────────────────────────────────────────
describe('validateRequiredId', () => {
  const MSG = 'Id is required';

  it('accepts a non-empty string id (__isValid true, no field error)', () => {
    const r = validateRequiredId({ id: 'abc123' }, MSG);
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'id')).toBe(false);
  });

  it('rejects a missing / empty id (__isValid false + id field error)', () => {
    for (const bad of [{ id: '' }, { id: undefined }, {}]) {
      const r = validateRequiredId(bad, MSG);
      expect(r.__isValid, JSON.stringify(bad)).toBe(false);
      expect(rejected(r, 'id'), JSON.stringify(bad)).toBe(true);
    }
  });

  it('SECURITY: rejects a non-string id (number / object / array / boolean)', () => {
    for (const bad of [{ id: 123 }, { id: {} }, { id: [] }, { id: true }]) {
      const r = validateRequiredId(bad, MSG);
      expect(r.__isValid, JSON.stringify(bad)).toBe(false);
      expect(rejected(r, 'id')).toBe(true);
    }
  });

  it('rejects null / undefined payload entirely', () => {
    expect(validateRequiredId(null, MSG).__isValid).toBe(false);
    expect(validateRequiredId(undefined, MSG).__isValid).toBe(false);
  });

  it('agrees with the validationUtils object wrapper', () => {
    expect(
      validationUtils.validateRequiredId({ id: 'ok' }, MSG).__isValid
    ).toBe(true);
    expect(validationUtils.validateRequiredId({ id: '' }, MSG).__isValid).toBe(
      false
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  hasReturnObjectValidationError — the __isValid aggregator
// ────────────────────────────────────────────────────────────────────────────
describe('hasReturnObjectValidationError (aggregator: true === no errors)', () => {
  // The param is typed `ValidationFlag & unknown`; the extra error-field keys are
  // legitimate at runtime (real validators add them) but trip TSC's excess-property
  // check on object literals, so build the literal then widen for the call.
  const flag = (o: Record<string, unknown> & { __isValid: boolean }) =>
    hasReturnObjectValidationError(o);

  it('returns true when every non-__isValid field is falsy (= valid)', () => {
    expect(flag({ __isValid: false, a: '', b: '' })).toBe(true);
  });

  it('returns false when any field carries a (truthy) error string', () => {
    expect(flag({ __isValid: false, a: 'err', b: '' })).toBe(false);
  });

  it('ignores the __isValid key itself when aggregating', () => {
    // __isValid truthy must not, on its own, make the object "invalid".
    expect(flag({ __isValid: true, a: '' })).toBe(true);
  });
});

describe('parsePgSafeDate (zakres PostgreSQL, nie sama parsowalność)', () => {
  // `Date.parse` + `isNaN` let through dates valid in JS but outside the database range.
  // Such a value reached Prisma and came back as "time zone displacement out of range",
  // DATABASE_ERROR, an opaque 500 that any logged-in user could trigger with one URL
  // parameter, flooding the error store and alerts.
  it('odrzuca datę poprawną dla JS, ale odrzucaną przez stos', () => {
    // Dokładnie wartości z repro na /messaging/conversations?cursor=…
    expect(parsePgSafeDate('-271821-04-20T00:00:00.000Z')).toBeNull();
    expect(parsePgSafeDate('-004714-01-01T00:00:00.000Z')).toBeNull();
  });

  it('odrzuca daty p.n.e. tuż pod granicą — pierwsza wersja bramki je PRZEPUSZCZAŁA', () => {
    // A bound set at the theoretical PostgreSQL minimum (4713 BC) let these values through
    // the parser and the database layer still answered 500. Measured on a live stack, so
    // they are an explicit case.
    expect(parsePgSafeDate('-004712-01-01T00:00:00.000Z')).toBeNull();
    expect(parsePgSafeDate('-004000-01-01T00:00:00.000Z')).toBeNull();
    expect(parsePgSafeDate('-000001-01-01T00:00:00.000Z')).toBeNull();
    expect(parsePgSafeDate('0000-12-31T23:59:59.000Z')).toBeNull();
  });

  it('przepuszcza dokładnie pierwszą akceptowaną wartość (0001-01-01T00:00:00Z)', () => {
    // Measured bound: this value returns 200, one millisecond earlier returns 500.
    expect(parsePgSafeDate('0001-01-01T00:00:00.000Z')).toBeInstanceOf(Date);
  });

  it('przepuszcza daty realne oraz skrajne, ale mieszczące się w bazie', () => {
    expect(parsePgSafeDate('2026-01-01T00:00:00.000Z')).toBeInstanceOf(Date);
    // The ceiling is deliberately not tested: JS ends before PostgreSQL, so a date
    // buildable in JS never exceeds the database's upper bound.
    expect(parsePgSafeDate('+275000-01-01T00:00:00.000Z')).toBeInstanceOf(Date);
  });

  it('zwraca null dla śmieci i wartości nie-datowych — ten sam wynik co poza zakresem', () => {
    // Callers treat both cases the same (cursor: first page, form field: 400)
    // instead of breaking the query.
    for (const value of ['abc', '', null, undefined, {}, 42, NaN]) {
      expect(parsePgSafeDate(value)).toBeNull();
    }
  });

  it('przyjmuje też obiekt Date, nie tylko string', () => {
    expect(
      parsePgSafeDate(new Date('2026-01-01T00:00:00.000Z'))
    ).toBeInstanceOf(Date);
    expect(parsePgSafeDate(new Date('nope'))).toBeNull();
  });
});

describe('validateEmail — ReDoS and length cap (testy-api s34)', () => {
  it('rejects the backtracking payload in linear time', () => {
    // 57 chars blocked the event loop for 68 s under the nested-quantifier regex.
    const evil = `a@${'a.a'.repeat(80)}!`;
    const started = performance.now();
    expect(validateEmail(evil)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('caps the address at EMAIL_MAX before the pattern runs', () => {
    const domain = '@example.com';
    const atCap = `${'a'.repeat(VALIDATION_LENGTHS.EMAIL_MAX - domain.length)}${domain}`;
    expect(validateEmail(atCap)).toBe(true);
    expect(validateEmail(`a${atCap}`)).toBe(false);
  });

  it('keeps the accepted shape: dotted host, #, _ and local plus allowed', () => {
    expect(validateEmail('first.last_#1@mail.sub.example.pl')).toBe(true);
    expect(validateEmail('a@b.c')).toBe(true);
    expect(validateEmail('a@.bc')).toBe(false);
    expect(validateEmail('a@bc.')).toBe(false);
    expect(validateEmail('a+tag@example.com')).toBe(true);
  });
});

describe('parsePgSafeDate — impossible calendar days (testy-api L3-7)', () => {
  // V8 ROLLS an impossible day over instead of rejecting it: '2026-02-31' became
  // 3 March, so a visit form stored a different date than the one typed, silently.
  it.each([
    '2026-02-31',
    '2026-02-30',
    '2026-02-29', // 2026 is not a leap year
    '2026-04-31',
    '2026-06-31',
    '2026-09-31',
    '2026-11-31',
    '2100-02-29', // divisible by 100, not by 400 → not leap
    '2026-02-31T10:00:00.000Z',
    '2026-04-31T00:00:00+02:00',
    '2026-00-10',
    '2026-13-01',
    '2026-01-00',
  ])('rejects %s', value => {
    expect(parsePgSafeDate(value)).toBeNull();
  });

  it.each([
    '2026-02-28',
    '2024-02-29', // leap
    '2000-02-29', // divisible by 400 → leap
    '2026-01-31',
    '2026-04-30',
    '2026-12-31',
    '2026-12-31T23:59:59.000Z',
  ])('accepts %s and keeps its calendar date', value => {
    const parsed = parsePgSafeDate(value);
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.toISOString().slice(0, 10)).toBe(value.slice(0, 10));
  });

  it('checks the WRITTEN date, not the UTC one — an offset crossing midnight stays valid', () => {
    // UTC of this instant is 28 Feb; the written calendar date (1 March) is real.
    expect(parsePgSafeDate('2026-03-01T00:30:00+02:00')).toBeInstanceOf(Date);
  });
});

describe('isCloudinaryAssetUrl — our cloud, upload delivery, URL-safe (testy-api s34)', () => {
  const ours = 'https://res.cloudinary.com/example-cloud/image/upload/';

  it('accepts our upload URLs, with versions and transformations', () => {
    expect(isCloudinaryAssetUrl(`${ours}v1712345/folder/abc_def-1.jpg`)).toBe(
      true
    );
    expect(isCloudinaryAssetUrl(`${ours}w_400,c_fill/v1/x.webp`)).toBe(true);
  });

  it('rejects the stored-XSS payload that broke out of the JSON-LD block', () => {
    expect(
      isCloudinaryAssetUrl(
        `${ours}v1/x</script><script>window.__qa_xss=1</script>.jpg`
      )
    ).toBe(false);
    expect(isCloudinaryAssetUrl(`${ours}v1/x".jpg`)).toBe(false);
    expect(isCloudinaryAssetUrl(`${ours}v1/x%00.jpg`)).toBe(false);
  });

  it('rejects foreign clouds, the fetch proxy and a bare prefix', () => {
    expect(
      isCloudinaryAssetUrl(
        'https://res.cloudinary.com/foreign-cloud/image/upload/v1/x.jpg'
      )
    ).toBe(false);
    expect(
      isCloudinaryAssetUrl(
        'https://res.cloudinary.com/example-cloud/image/fetch/https://evil.example/x.jpg'
      )
    ).toBe(false);
    expect(isCloudinaryAssetUrl(ours)).toBe(false);
  });
});
