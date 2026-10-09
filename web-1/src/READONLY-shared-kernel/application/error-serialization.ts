// DECISION (nie usuwaj tego komentarza):
// `JSON.stringify(new Error('boom'))` daje `{}` — `name`, `message` i `stack` są
// NIEENUMEROWALNE. Każdy `reportIssue*({ payload: err })` zapisywał więc do
// AppLogRecord pusty obiekt albo — dla błędów z własnymi polami (Prisma) — sam
// szum typu `{"clientVersion":"7.8.0"}`, BEZ powodu błędu. Zweryfikowane na
// produkcji: incydent 2026-08-03/05 (`AI_CRAWLER_TRACK`) zapisał
// `{"clientVersion":"7.8.0"}`, a realny komunikat ("Connection terminated due to
// connection timeout") przetrwał wyłącznie w PostHogu, bo `captureException`
// czyta Error natywnie. Ten moduł jest JEDNYM źródłem normalizacji dla obu
// sinków (backend error-handler + frontend reportIssueFrontend), żeby log-store
// i PostHog widziały ten sam błąd.

/**
 * Maksymalna dlugosc zachowanego stack trace (znaki). Pelne stacki Node/Next
 * potrafią mieć kilkadziesiąt kB — w kolumnie `payload` to czysty balast.
 */
const MAX_STACK_CHARS = 4_000;

/** Limit zagnieżdżenia przy schodzeniu po `cause` / polach obiektu. */
const MAX_DEPTH = 4;

/** Limit elementów tablicy — chroni przed zalaniem loga partią N rekordów. */
const MAX_ARRAY_ITEMS = 50;

export type SerializedError = {
  __error: true;
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
  [ownProperty: string]: unknown;
};

// DECISION (nie usuwaj tego komentarza):
// Odkąd `message`/`stack` faktycznie trafiają do log-store (wcześniej ginęły w
// `JSON.stringify(Error)` → `{}`), treść błędu jest realnym kanałem wyciekowym:
// pg/Prisma potrafi wkleić cały connection string z hasłem do komunikatu. Scrub
// jest WĄSKI i celowo tylko taki — wycina credentiale z URI (`scheme://user:pass@host`)
// i wartości parametrów tokenowych z query-stringów. Reszta scrubu zostaje
// KEY-based na poziomie callera (SENSITIVE_KEY_REGEX w error-handler.ts) — pełny
// content-scan wszystkich stringów to gold-plating i źródło fałszywych trafień.
const URI_CREDENTIALS_REGEX = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const URI_SECRET_PARAM_REGEX =
  /([?&](?:password|passwd|pwd|token|api[_-]?key|apikey|secret|access[_-]?token|refresh[_-]?token|signature|sig|auth)=)[^&\s"']+/gi;

function scrubSecretsInText(text: string): string {
  return text
    .replace(URI_CREDENTIALS_REGEX, '$1[REDACTED]@')
    .replace(URI_SECRET_PARAM_REGEX, '$1[REDACTED]');
}

function truncateStack(stack: string): string {
  const scrubbed = scrubSecretsInText(stack);
  return scrubbed.length <= MAX_STACK_CHARS
    ? scrubbed
    : scrubbed.slice(0, MAX_STACK_CHARS) + '\n… [stack truncated]';
}

/**
 * True dla obiektów błędo-podobnych, które NIE przechodzą `instanceof Error`.
 * Realne źródła: błędy przeniesione przez granicę realmu (worker/vm/iframe),
 * błędy zdeserializowane z JSON-a oraz structured-clone z `postMessage`.
 */
function isErrorLikeShape(value: object): boolean {
  return (
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string' &&
    'stack' in value &&
    typeof (value as { stack: unknown }).stack === 'string'
  );
}

function serializeErrorInstance(
  error: Error,
  depth: number,
  path: Set<object>
): SerializedError {
  const out: SerializedError = {
    __error: true,
    name: error.name,
    message: scrubSecretsInText(error.message),
  };

  if (typeof error.stack === 'string' && error.stack.length > 0) {
    out.stack = truncateStack(error.stack);
  }

  // Własne pola enumerowalne (Prisma `code`/`clientVersion`/`meta`, `errno`,
  // `syscall` z pg itd.) — to one niosły dotąd JEDYNY zapisany kontekst.
  const record = error as unknown as Record<string, unknown>;
  for (const key of Object.keys(error)) {
    if (key === 'name' || key === 'message' || key === 'stack') {
      continue;
    }
    out[key] = walk(record[key], depth + 1, path);
  }

  // `cause` jest nieenumerowalne (ES2022), więc pętla wyżej go nie złapie —
  // a to zwykle właśnie ono niesie prawdziwą przyczynę (Prisma → pg → ECONNRESET).
  if ('cause' in error && error.cause !== undefined) {
    out.cause = walk(error.cause, depth + 1, path);
  }

  return out;
}

function walkErrorLikeShape(
  value: object,
  depth: number,
  path: Set<object>
): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = { __error: true };
  for (const key of Object.keys(record)) {
    out[key] =
      key === 'stack' && typeof record.stack === 'string'
        ? truncateStack(record.stack)
        : walk(record[key], depth + 1, path);
  }
  out.name = typeof record.name === 'string' ? record.name : 'Error';
  return out;
}

function walkArray(
  value: unknown[],
  depth: number,
  path: Set<object>
): unknown[] {
  const items: unknown[] = value
    .slice(0, MAX_ARRAY_ITEMS)
    .map(item => walk(item, depth + 1, path));
  if (value.length > MAX_ARRAY_ITEMS) {
    items.push(`[… ${value.length - MAX_ARRAY_ITEMS} more items]`);
  }
  return items;
}

function walkPlainObject(
  value: object,
  depth: number,
  path: Set<object>
): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    out[key] = walk(record[key], depth + 1, path);
  }
  return out;
}

// DECISION (nie usuwaj tego komentarza):
// `path` śledzi WYŁĄCZNIE aktualną ścieżkę zejścia (add przed, delete po), nie
// wszystkie odwiedzone obiekty. Globalny WeakSet oznaczałby drugie wystąpienie
// tego samego obiektu w RODZEŃSTWIE jako `[circular]` i gubił realny kontekst
// (np. ten sam `error` w `{ payload, error }`). Cykl to powrót na WŁASNĄ ścieżkę.
function walk(value: unknown, depth: number, path: Set<object>): unknown {
  if (typeof value === 'string') {
    return scrubSecretsInText(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (path.has(value)) {
    return '[circular]';
  }

  if (depth >= MAX_DEPTH) {
    return '[max depth reached]';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  path.add(value);
  try {
    if (value instanceof Error) {
      return serializeErrorInstance(value, depth, path);
    }
    if (Array.isArray(value)) {
      return walkArray(value, depth, path);
    }
    if (isErrorLikeShape(value)) {
      return walkErrorLikeShape(value, depth, path);
    }
    return walkPlainObject(value, depth, path);
  } finally {
    path.delete(value);
  }
}

/**
 * Zamienia dowolny payload loga na strukturę bezpieczną dla `JSON.stringify`,
 * zachowując `name` / `message` / `stack` / `cause` każdego błędu — także gdy
 * błąd siedzi zagnieżdżony w obiekcie (`{ error: err }`) albo w tablicy.
 *
 * Czysta funkcja, zero IO — celowo, żeby dało się ją testować wprost
 * (`error-serialization.test.ts`) i żeby działała identycznie na froncie i backu.
 */
export function serializeErrorLike(payload: unknown): unknown {
  return walk(payload, 0, new Set<object>());
}

/**
 * Jednolinijkowe streszczenie błędu do pola `message` loga — żeby dashboard i
 * grep działały bez rozpakowywania `payload`. Pusty string = brak czytelnego
 * komunikatu (caller zostawia wtedy swój własny `message` bez sufiksu).
 */
export function describeErrorLike(payload: unknown): string {
  if (payload instanceof Error) {
    return `${payload.name}: ${payload.message}`;
  }
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.length > 0) {
      const name = typeof record.name === 'string' ? record.name : 'Error';
      return `${name}: ${record.message}`;
    }
  }
  return '';
}
