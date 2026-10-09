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
 * DECISION (nie usuwaj tego komentarza):
 * cuid id ma format `[a-z0-9]{20,40}` (cuid v1 = 25 znakow `c...`, cuid2 = 24).
 * Format-gate ZANIM cursor trafi do Prisma daje dwa efekty:
 *   1) input robustness: null-byte (\0) i inne nielegalne dla PG `text` sekwencje w
 *      cursorze rzucalyby w Prisma -> niezmapowany 500 GENERAL_ERROR. Gate odrzuca je
 *      zanim dotkna DB (caller zwraca pierwsza strone, nie 5xx).
 *   2) defense-in-depth dla istnienia-PK oracle: Prisma `cursor` kotwiczy wiersz po
 *      PK PONAD CALA tabela ZANIM zaaplikuje `where` — cudze (cuid ofiary) vs
 *      sfabrykowane cursory daja rozny wynik => 1-bit oracle. Gate + ownership-check
 *      u callera zamyka wyciek.
 * SSOT dla obu call-sites (user-session.operations, event-log.client) — NIE
 * duplikowac inline regexa.
 */
export const isValidCursorFormat = (value: string): boolean =>
  /^[a-z0-9]{20,40}$/.test(value);

/**
 * Normalizuje polski NIP: usuwa spacje/myślniki oraz opcjonalny prefiks kraju „PL".
 * Zwraca surowy ciąg cyfr (bez walidacji długości/checksumu — to robi isValidNip).
 */
export const normalizeNip = (value: string): string =>
  value.replace(/[\s-]/g, '').replace(/^PL/i, '').trim();

/**
 * Waliduje polski NIP (numer identyfikacji podatkowej) — checksum modulo 11.
 *
 * DECISION (nie usuwaj tego komentarza):
 * SSOT walidacji NIP dla backendu (zod `.refine`) i frontendu (client-side field
 * validator) — jeden algorytm, zero rozjazdu. Reguła: po normalizacji dokładnie 10
 * cyfr; suma iloczynów pierwszych 9 cyfr przez wagi [6,5,7,2,3,4,5,6,7] modulo 11
 * musi równać się 10. cyfrze. Gdy `mod === 10` NIP jest ODRZUCANY (taki NIP nie
 * istnieje — 10 nie zmieści się w jednej cyfrze kontrolnej).
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
 * DECISION (nie usuwaj tego komentarza):
 * Zakres PHONE_MIN..PHONE_MAX (9-15) liczymy w CYFRACH, nie w znakach. Wcześniej
 * oba call-site'y porównywały `trimmed.length`, czyli DŁUGOŚĆ CAŁEGO CIĄGU — a ten
 * sam walidator regexem PHONE_FORMAT celowo dopuszcza `+`, spacje, myślniki i
 * nawiasy. Skutek: „+48 22 123 45 67" (11 cyfr, 16 znaków) leciało w odrzucenie z
 * komunikatem „Numer telefonu musi mieć 9-15 cyfr" — komunikat, dokumentacja stałej
 * („E.164 ... digits only") i regex mówiły o cyfrach, a kod mierzył znaki. Pole na
 * froncie nie ma `maxLength`, więc użytkowniczka trafiała na to normalnym zapisem
 * numeru. Sufit na surowy ciąg pilnuje PHONE_FIELD_MAX (20) — stała, która istnieje
 * dokładnie po to („15 cyfr + znaki formatujące") i której używa już siostrzane pole
 * telefonu lokalu stylistki (account.validation.ts).
 * Za długi numer dostaje `tooLong`, nie `tooShort` — wcześniej obie granice zwracały
 * ten sam, nieprawdziwy komunikat o zbyt krótkim numerze.
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
      // DECISION (nie usuwaj tego komentarza) — word regex BEZ kotwic \b (finding testy-api name-1):
      // JS \b jest zdefiniowane przez ASCII \w ([A-Za-z0-9_]) NAWET pod flaga /u, wiec przy nazwie
      // zaczynajacej sie od polskiej diakrytyki (Lukasz->Łukasz, Zaneta, Cma) \b NIE wystrzeliwal na
      // starcie stringu tylko MIEDZY diakrytykiem a nastepna litera -> match zaczynal sie od drugiej litery,
      // inner ^ kapitalizowal ja (ukasz->Ukasz), a diakrytyk zostawal nietkniety -> "ŁUkasz". Unicode
      // klasa [\p{L}\p{N}']+ (bez \b) matchuje cale slowo od pierwszej litery; inner (^|'|po-cyfrze)
      // kapitalizuje pierwsza litere slowa + po apostrofie (O'Brien) + po cyfrze. Edge z wiodacym
      // apostrofem identyczny jak wczesniej (apostrof zostaje, litera po nim kapitalizowana). NIE
      // przywracac \b — psuje kazda nazwe zaczynajaca sie od znaku spoza ASCII (rynek PL/DE).
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
 * DECISION (nie usuwaj tego komentarza) — D5 (2026-09-05):
 * Limity treści pisanej przez człowieka (wiadomość, notatka CRM, notatka wizyty)
 * liczymy w punktach kodowych, spójnie w walidatorze kernela (zod `.refine`),
 * w liczniku na froncie i w komunikacie błędu („maksymalnie N znaków"). Zod
 * `.max()` i `String.length` liczą jednostki UTF-16, więc piszący emoji dostawał
 * połowę deklarowanego limitu, a baza liczyła jeszcze inaczej. Jedna miara =
 * `Array.from(s).length` (iterator stringa idzie po punktach kodowych).
 */
export const countCodePoints = (value: string): number =>
  Array.from(value).length;

// Niesparowany surogat: wysoki (D800–DBFF) bez następującego niskiego ALBO niski
// (DC00–DFFF) bez poprzedzającego wysokiego. Poprawne pary (emoji) NIE pasują.
const UNPAIRED_SURROGATE_RE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * True, gdy ciąg zawiera osierocony (niesparowany) surogat UTF-16.
 *
 * DECISION (nie usuwaj tego komentarza) — D5 (2026-09-05):
 * Taki ciąg nie jest poprawnym Unicode: JSON.parse przepuszcza `"\uD800"`
 * bez błędu, a sterownik PostgreSQL przy kodowaniu do UTF-8 zamieniał go PO
 * CICHU na U+FFFD — treść użytkownika zmieniała się bez ostrzeżenia. Walidator
 * ODRZUCA go z komunikatem `validation.general.invalidCharacters`, zamiast
 * pozwolić na cichą podmianę. Bajt NUL (U+0000) odrzuca wcześniej middleware
 * (null-byte-guard) — to osobna, szersza bramka.
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

/**
 * Validates an optional HTTPS URL. Returns true if VALID, false if INVALID.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Scheme allowlist (https://) — NIE blocklist. XSS hardening dla pol typu icon_url
 * gdzie atakujący admin (lub przejęty admin account) moglby wstrzyknac javascript:,
 * data:text/html,..., vbscript:, file:// itp. — by RCE/XSS gdy URL renderowany
 * w UI (img src, link href, css url()). Hostname NIE walidowany (sam scheme wystarcza
 * by zablokowac executable URI schemes).
 *
 * Accepts: undefined, null, '' (optional field — treated as "no URL").
 * Rejects: non-string, leading/trailing whitespace, non-https scheme, value > maxLength,
 *          unparseable URLs (e.g. `https:` without host), URLs with embedded credentials.
 *
 * Bypass attempts mitigated:
 * - `javascript:alert(1)` → URL.protocol !== 'https:' → reject
 * - `JavaScript:alert(1)` → URL normalizes protocol to lowercase → !== 'https:' → reject
 * - `data:text/html,<script>...` → reject
 * - `vbscript:`, `file:`, `ftp:`, `ws:`, `wss:`, `chrome:` → reject (only https)
 * - `  https://x.com` → leading whitespace check → reject
 * - `https://x.com\n` → trailing whitespace check → reject
 * - `https://user:pass@x.com` → credentials check → reject (no embedded auth)
 * - `https:` (empty host) → new URL() throws or host is empty → reject
 * - `http://x.com` → not https → reject (HTTPS-only policy)
 */
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
 * DECISION (nie usuwaj tego komentarza):
 * Trzeci konsument (avatar stylistki, 2026-09-09) zamienił dwie lokalne kopie
 * stałej (`gallery.validation.ts`, `visit.validation.ts`) na jedno miejsce —
 * inaczej zmiana hosta dostawy wymagałaby znalezienia N literałów. Świadomie
 * `startsWith`, nie parsowanie URL-a: to jest bramka „nasz CDN", a nie walidacja
 * adresu; pełny scheme-allowlist dla adresów WPISYWANYCH przez użytkownika żyje
 * w `validateOptionalHttpsUrl` i to jego używa pole `website`.
 */
export const CLOUDINARY_ASSET_URL_PREFIX = 'https://res.cloudinary.com/';

/**
 * DECISION (nie usuwaj tego komentarza) — OUR cloud, upload delivery, URL-safe chars
 * (testy-api s34, HIGH): the bare host prefix accepted any cloud, the `fetch` proxy
 * (`/image/fetch/https://evil…`, arbitrary external images through our quota) and ANY
 * characters, so `…/x</script><script>…` was stored and broke out of the public
 * profile's JSON-LD block (stored XSS vector, closed). The cloud name is public (the
 * frontend uploads with NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, identical in every
 * environment). Changing the cloud = change this constant together with that env.
 * Allowed after the prefix: letters, digits and `_ - . / , :` (public ids,
 * versions, transformation segments); no `%`, quotes, `<`, `>`, `?`, `#`, spaces.
 */
export const CLOUDINARY_CLOUD_NAME = 'dcuiuwkb0';
export const CLOUDINARY_UPLOAD_URL_PREFIX = `${CLOUDINARY_ASSET_URL_PREFIX}${CLOUDINARY_CLOUD_NAME}/image/upload/`;
const CLOUDINARY_SAFE_PATH = /^[A-Za-z0-9_\-./,:]+$/;

export const isCloudinaryAssetUrl = (value: string): boolean =>
  value.startsWith(CLOUDINARY_UPLOAD_URL_PREFIX) &&
  value.length > CLOUDINARY_UPLOAD_URL_PREFIX.length &&
  CLOUDINARY_SAFE_PATH.test(value.slice(CLOUDINARY_UPLOAD_URL_PREFIX.length));

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
 * DECISION (nie usuwaj tego komentarza):
 * Ta stała była najpierw ustawiona na teoretyczne minimum typu `timestamp`
 * w PostgreSQL (4713 p.n.e.) i to było ZA NISKO — bramka wyglądała na zamkniętą,
 * a klasa błędu została otwarta. Zmierzone na żywym stosie: `0001-01-01` przechodzi,
 * `0000-12-31` i wszystko wcześniejsze (w tym `-004712`, `-004000`, `-000001`) nadal
 * kończy się nieprzezroczystym 500. Sam PostgreSQL daty p.n.e. obsługuje — nie radzi
 * sobie z nimi ścieżka sterownika (zapis ery), więc wiążącym ograniczeniem jest STOS,
 * nie dokumentacja bazy.
 *
 * Wniosek na przyszłość: granicę bierzemy z pomiaru, nie z tabeli w dokumentacji.
 * Rok 1 n.e. jest przy okazji uczciwym progiem produktowym — żadna realna data
 * w tym produkcie (wizyta, subskrypcja, kursor) nie jest wcześniejsza.
 *
 * Górnej granicy NIE sprawdzamy celowo: PostgreSQL sięga roku 294276, a JavaScript
 * kończy się na 275760, więc data, którą da się w ogóle zbudować w JS, nigdy nie
 * przekroczy sufitu bazy.
 */
const POSTGRES_MIN_TIMESTAMP_MS = -62135596800000;

/**
 * Parsuje datę od użytkownika i odrzuca taką, której PostgreSQL nie przyjmie.
 *
 * DECISION (nie usuwaj tego komentarza):
 * `Date.parse` + `isNaN` to ZA MAŁO. Istnieją daty poprawne dla JavaScriptu, a
 * spoza zakresu bazy — np. `-271821-04-20T00:00:00.000Z`. Taka wartość przechodziła
 * walidację, docierała do Prismy i wracała jako „time zone displacement out of
 * range", czyli DATABASE_ERROR → nieprzezroczyste 500. Wrogi input był więc
 * klasyfikowany jako awaria bazy.
 *
 * Skutek był gorszy niż samo 500: zwykły zalogowany użytkownik jednym parametrem
 * w URL-u produkował dowolnie długą serię błędów, a każdy z nich zapisywał pełny
 * rekord DATABASE_ERROR (z komunikatem i stosem) do error-store'u i odpalał alert
 * PostHoga. Czyli zalewanie alertów i zaśmiecanie miejsca, w którym szuka się
 * prawdziwych awarii.
 *
 * Zwraca `null` dla wartości nieparsowalnej ORAZ dla poza-zakresowej — dzięki temu
 * wołający traktuje jedno i drugie tak samo (kursor: pierwsza strona; pole
 * formularza: błąd walidacji 400), zamiast wywracać zapytanie.
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
 * DECISION (nie usuwaj tego komentarza) — KALENDARZ SPRAWDZAMY SAMI:
 * V8 nie odrzuca niemożliwego dnia miesiąca w zapisie ISO, tylko go PRZEWIJA:
 * `new Date('2026-02-31')` to 3 marca, `'2026-04-31'` to 1 maja (miesiąc 13 już
 * daje Invalid Date, dzień 31 w 30-dniowym miesiącu — nie). Formularz z datą wizyty
 * zapisywał więc inną datę niż ta, którą użytkowniczka wpisała, bez żadnego błędu
 * (testy-api L3-7, 2026-09-25). Dzień z wiodącego `YYYY-MM-DD` musi istnieć w tym
 * miesiącu. Sprawdzamy SKŁADOWE NAPISU, a nie składowe sparsowanej daty w UTC: dla
 * `2026-03-01T00:30:00+02:00` UTC to 28 lutego, więc porównanie po UTC odrzucałoby
 * poprawną datę z przesunięciem strefy. Dla daty bez czasu (parsowanej jako UTC)
 * to jest dokładnie test „parsed Y-M-D === input Y-M-D".
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
