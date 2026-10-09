// main/src/application/date/date.utils.ts
// Locale-aware date formatters with formatter cache.
//
// DECISION (nie usuwaj tego komentarza):
// Wczesniej kazdy komponent w tabeli/liscie tworzyl `new Intl.DateTimeFormat('pl-PL', {...})`
// per row (8+ plikow x ~N rzedow per page = setki instancji per render). Intl.DateTimeFormat
// jest drogim obiektem (ICU lookup). Cache `Map<locale+key, Intl.DateTimeFormat>` = max
// 1 instancja per (locale, format).
//
// Format conventions (pl):
// - DATE: "23 maj 2026" (numeric day, short month, numeric year)
// - DATE_TIME: "23 maj 2026, 14:32"
// - TIMESTAMP: "23 maj 2026, 14:32:15"
// - DATE_SHORT: "23.05.2026" (numeric DD.MM.YYYY)
// - DATE_LONG: "23 maja 2026" (long month name)
//
// Locale param defaults to 'pl-PL' for backwards compatibility with existing call sites.
// New code SHOULD pass router.locale (i18n) — see useLocalizedDateFormatters() for the hook variant.

type FormatKind =
  | 'DATE'
  | 'DATE_TIME'
  | 'TIMESTAMP'
  | 'DATE_SHORT'
  | 'DATE_LONG'
  | 'MONTH_YEAR';

const FORMAT_OPTIONS: Record<FormatKind, Intl.DateTimeFormatOptions> = {
  DATE: { day: 'numeric', month: 'short', year: 'numeric' },
  DATE_TIME: {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
  TIMESTAMP: {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  },
  DATE_SHORT: { day: '2-digit', month: '2-digit', year: 'numeric' },
  DATE_LONG: { day: 'numeric', month: 'long', year: 'numeric' },
  MONTH_YEAR: { month: 'long', year: 'numeric' },
};

// Polish genitive month names — wymagane dla frazy "od {miesiac}" (memberSince,
// pairedSinceLabel). Intl `month:'long'` BEZ dnia daje mianownik ("czerwiec"), a po
// przyimku "od" gramatycznie potrzebny jest dopelniacz ("czerwca"). Deterministyczne
// (locale jawny → brak hydration mismatch, spojnie z DECISION w call-site).
const PL_GENITIVE_MONTHS = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
] as const;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(locale: string, kind: FormatKind): Intl.DateTimeFormat {
  const cacheKey = `${locale}::${kind}`;
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, FORMAT_OPTIONS[kind]);
    formatterCache.set(cacheKey, formatter);
  }
  return formatter;
}

type DateInput = Date | string | number | null | undefined;

function toDate(d: DateInput): Date | null {
  if (d === null || d === undefined || d === '') {
    return null;
  }
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) {
    return null;
  }
  return date;
}

const DEFAULT_LOCALE = 'pl-PL';

function formatWith(
  kind: FormatKind,
  d: DateInput,
  locale: string,
  fallback: string
): string {
  const date = toDate(d);
  if (!date) {
    return fallback;
  }
  try {
    return getFormatter(locale, kind).format(date);
  } catch {
    return fallback;
  }
}

// ── Locale-explicit API (preferred for new code) ───────────────────────────

export function formatDate(
  d: DateInput,
  locale: string = DEFAULT_LOCALE,
  fallback = '—'
): string {
  return formatWith('DATE', d, locale, fallback);
}

export function formatDateTime(
  d: DateInput,
  locale: string = DEFAULT_LOCALE,
  fallback = '—'
): string {
  return formatWith('DATE_TIME', d, locale, fallback);
}

export function formatTimestamp(
  d: DateInput,
  locale: string = DEFAULT_LOCALE,
  fallback = '—'
): string {
  return formatWith('TIMESTAMP', d, locale, fallback);
}

export function formatDateShort(
  d: DateInput,
  locale: string = DEFAULT_LOCALE,
  fallback = '—'
): string {
  return formatWith('DATE_SHORT', d, locale, fallback);
}

export function formatDateLong(
  d: DateInput,
  locale: string = DEFAULT_LOCALE,
  fallback = '—'
): string {
  return formatWith('DATE_LONG', d, locale, fallback);
}

/**
 * Format: "czerwca 2026" (pl — dopelniacz) / "June 2026" (inne locale).
 * Do uzycia w frazach "od {date}" (memberSince, pairedSinceLabel), gdzie polski
 * wymaga dopelniacza miesiaca. Dla pl uzywa mapy genitive; dla reszty — Intl long.
 */
export function formatMonthYear(
  d: DateInput,
  locale: string = DEFAULT_LOCALE,
  fallback = '—'
): string {
  const date = toDate(d);
  if (!date) {
    return fallback;
  }
  if (locale.startsWith('pl')) {
    const month = PL_GENITIVE_MONTHS[date.getMonth()];
    return month ? `${month} ${date.getFullYear()}` : fallback;
  }
  return formatWith('MONTH_YEAR', d, locale, fallback);
}

// ── pl-PL convenience wrappers (default-locale shorthand) ──────────────────
// Existing call sites use these names. New code should prefer the locale-aware variants
// above and pass router.locale explicitly.

/** Format: "23 maj 2026, 14:32" (pl-PL default). */
export function formatDateTimePL(d: DateInput, fallback = '—'): string {
  return formatDateTime(d, DEFAULT_LOCALE, fallback);
}

/** Format: "23 maj 2026, 14:32:15" (pl-PL default). */
export function formatTimestampPL(d: DateInput, fallback = '—'): string {
  return formatTimestamp(d, DEFAULT_LOCALE, fallback);
}

/** Format: "23.05.2026" (pl-PL default). */
export function formatDateShortPL(d: DateInput, fallback = '—'): string {
  return formatDateShort(d, DEFAULT_LOCALE, fallback);
}

/** Format: "23 maja 2026" (pl-PL default). */
export function formatDateLongPL(d: DateInput, fallback = '—'): string {
  return formatDateLong(d, DEFAULT_LOCALE, fallback);
}
