// main/src/application/error-debugger/error-noise-filter.ts
//
// Pure predicate that classifies a handful of PROVABLY-non-actionable client
// error signatures so the global error sinks (AppLifecycle onError /
// onUnhandledRejection) can skip forwarding them to the backend AppLogRecord
// store. Everything else — anything carrying a real stack, filename or message
// — stays reported. The matchers are kept MAXIMALLY NARROW: over-suppression
// (silently swallowing a real bug) is the only risk here, so each branch pins
// the exact signature and nothing broader.
//
// This module is intentionally IO-free and framework-free so it can be unit
// tested directly (see error-noise-filter.test.ts, the RED-first guard).

// Exported as named consts so the guard test can assert the exact strings the
// prod signatures match — a regression that widens or renames them fails RED.

// (A) Cross-origin masked error. When a script loaded from a different origin
// throws, the browser strips all detail for security and reports the bare
// string "Script error." with NO filename, NO line/col, NO Error object. There
// is nothing to act on: no stack, no source location, not even our code
// guaranteed to be the culprit. A genuine SAME-ORIGIN error never looks like
// this — it carries a distinct message plus a filename and a stack.
export const CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE = 'Script error.';

// (B) Browser-extension injected rejection. This exact substring is emitted by
// extension content scripts (well-known signature, e.g. password managers /
// translation add-ons interacting with the DOM) — it originates OUTSIDE our
// bundle and we cannot fix or reproduce it. Matching the substring (not the
// whole message) tolerates the minor wording variants extensions ship while
// staying specific enough that no first-party rejection collides with it.
export const EXTENSION_OBJECT_NOT_FOUND_SIGNATURE =
  'Object Not Found Matching Id';

export const WINDOW_ERROR_NAMESPACE = 'window.error';
export const UNHANDLED_REJECTION_NAMESPACE = 'unhandledrejection';

type NoiseCandidate = {
  namespace: string;
  message: string;
  payload?: {
    // Exact types (ErrorEvent.filename = string, Error.stack = string|null): the eslint
    // `allowNullableString` option makes `!payload?.x` legal, and truthiness (an empty string is
    // falsy too) is kept, so class (A) matches as before.
    filename?: string;
    stack?: string | null;
  } | null;
};

/**
 * True only for the narrow, provably-non-actionable client noise classes.
 * Returning true tells the caller to skip backend reporting for THIS event.
 *
 * A real actionable error (own message + filename + stack, any real status)
 * matches NONE of the branches and is always reported.
 */
export function isNonActionableClientNoise({
  namespace,
  message,
  payload,
}: NoiseCandidate): boolean {
  // (A) Bare cross-origin mask: exact "Script error." AND no filename AND no
  // stack. The dual emptiness check is what makes this safe — the instant a
  // filename or stack is present the browser did NOT mask the error, so it is a
  // real same-origin fault and stays reported.
  if (
    namespace === WINDOW_ERROR_NAMESPACE &&
    message === CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE &&
    !payload?.filename &&
    !payload?.stack
  ) {
    return true;
  }

  // (B) Extension-injected rejection: known signature substring. Not our code,
  // not fixable from our side, not reproducible in the app.
  if (
    namespace === UNHANDLED_REJECTION_NAMESPACE &&
    message.includes(EXTENSION_OBJECT_NOT_FOUND_SIGNATURE)
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// The same noise threshold for the SECOND sink: PostHog Error Tracking.
// ---------------------------------------------------------------------------
//
// DECISION: both reporting paths must share one noise policy. Our own AppLogRecord drops the masked
// cross-origin "Script error." (class A above), but `posthog-js` registers global handlers
// INDEPENDENTLY of our sinks, so the same non-actionable noise created an active PostHog issue and
// ate the alert threshold. The predicate below ADAPTS the same rules to the `$exception` event
// shape, keeping the noise threshold in ONE place.

/** PostHog exception event name. */
export const POSTHOG_EXCEPTION_EVENT = '$exception';

type PosthogExceptionEntry = {
  type?: unknown;
  value?: unknown;
  stacktrace?: { frames?: unknown } | null;
};

const hasStackFrames = (entry: PosthogExceptionEntry): boolean =>
  Array.isArray(entry.stacktrace?.frames) && entry.stacktrace.frames.length > 0;

const entryValue = (entry: PosthogExceptionEntry): string =>
  typeof entry.value === 'string' ? entry.value : '';

/**
 * True when the `$exception` event carries ONLY class A/B noise: the masked cross-origin
 * "Script error." with no stack frame at all, or a signature injected by a browser extension.
 *
 * Deliberately requires EVERY list entry to be noise: if the browser adds a real exception to the
 * chain, the whole event passes through.
 */
export function isNonActionablePosthogException(
  exceptionList: readonly unknown[] | undefined
): boolean {
  if (!Array.isArray(exceptionList) || exceptionList.length === 0) {
    return false;
  }

  return exceptionList.every(raw => {
    if (raw === null || typeof raw !== 'object') {
      return false;
    }
    const entry = raw as PosthogExceptionEntry;
    const value = entryValue(entry);

    if (value.includes(EXTENSION_OBJECT_NOT_FOUND_SIGNATURE)) {
      return true;
    }

    return (
      value === CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE && !hasStackFrames(entry)
    );
  });
}
