// DECISION: `JSON.stringify(new Error('boom'))` is `{}` because name, message and stack are
// non-enumerable, so `reportIssue*({ payload: err })` stored an empty object (or only Prisma noise
// like `{"clientVersion":"7.8.0"}`) without the cause. This module is the one normaliser for both
// sinks (backend error-handler, frontend reportIssueFrontend) so the log store and PostHog see the
// same error.

/** Max kept stack trace length (chars). Full Node/Next stacks run to tens of kB, pure ballast in `payload`. */
const MAX_STACK_CHARS = 4_000;

/** Nesting limit when walking `cause` / object fields. */
const MAX_DEPTH = 4;

/** Array element limit, so a batch of N records cannot flood the log. */
const MAX_ARRAY_ITEMS = 50;

export type SerializedError = {
  __error: true;
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
  [ownProperty: string]: unknown;
};

// DECISION: error text is a real leak channel (pg/Prisma can paste a whole connection string with
// the password into a message), so the scrub strips URI credentials (`scheme://user:pass@host`) and
// token-like query parameter values. It stays narrow on purpose; the rest is KEY-based in the caller
// (SENSITIVE_KEY_REGEX in error-handler.ts), a full content scan of every string invites false hits.
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
 * True for error-like objects that do NOT pass `instanceof Error`: errors that crossed a realm
 * boundary (worker/vm/iframe), errors deserialised from JSON and structured clones from `postMessage`.
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

  // Own enumerable fields (Prisma `code`/`clientVersion`/`meta`, `errno`, pg `syscall`, ...); they
  // used to be the ONLY stored context.
  const record = error as unknown as Record<string, unknown>;
  for (const key of Object.keys(error)) {
    if (key === 'name' || key === 'message' || key === 'stack') {
      continue;
    }
    out[key] = walk(record[key], depth + 1, path);
  }

  // `cause` is non-enumerable (ES2022), so the loop above misses it, yet it usually carries the
  // real reason (Prisma -> pg -> ECONNRESET).
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

// DECISION: `path` tracks only the current descent path (add before, delete after), not every visited
// object. A global WeakSet would mark the second occurrence of the same object among SIBLINGS as
// `[circular]` and lose real context (e.g. the same `error` in `{ payload, error }`).
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
 * Turns any log payload into a `JSON.stringify`-safe structure, keeping `name` / `message` /
 * `stack` / `cause` of every error, also when nested in an object (`{ error: err }`) or array.
 *
 * Pure function, no IO, so it is testable directly (`error-serialization.test.ts`) and behaves the
 * same on front and back.
 */
export function serializeErrorLike(payload: unknown): unknown {
  return walk(payload, 0, new Set<object>());
}

/**
 * One-line error summary for the log `message` field, so the dashboard and grep work without
 * unpacking `payload`. Empty string = no readable message (the caller keeps its own `message`).
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
