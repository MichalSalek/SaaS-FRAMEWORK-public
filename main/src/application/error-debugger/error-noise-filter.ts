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
    // Typy dokładne (ErrorEvent.filename = string, Error.stack = string|null) —
    // `allowNullableString` w eslint config czyni `!payload?.x` legalnym, a
    // truthiness (pusty string też falsy) zostaje = klasa (A) matchuje jak dotąd.
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
// Ten sam próg szumu dla DRUGIEGO sinka: PostHog Error Tracking.
// ---------------------------------------------------------------------------
//
// DECISION (nie usuwaj tego komentarza):
// Do 2026-08 obie ścieżki raportowania miały ROZJECHANE polityki: własny
// AppLogRecord odsiewał maskowane cross-origin „Script error." (klasa A wyżej),
// ale `posthog-js` rejestruje globalne handlery NIEZALEŻNIE od naszych sinków —
// więc dokładnie ten sam nieaktywowalny szum tworzył w PostHogu aktywne issue
// (104 wystąpienia, 2026-07-07 → 2026-08-17) i zjadał próg alertu, przez co
// realne wyjątki tonęły w tle. Predykat niżej jest ADAPTEREM tych samych reguł
// na kształt zdarzenia `$exception`, żeby próg szumu miał JEDNO źródło prawdy.

/** Nazwa zdarzenia wyjątku w PostHogu. */
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
 * True, gdy zdarzenie `$exception` niesie WYŁĄCZNIE szum z klas A/B — czyli
 * maskowany cross-origin „Script error." bez ani jednej ramki stosu, albo
 * sygnaturę wstrzykniętą przez rozszerzenie przeglądarki.
 *
 * Świadomie wymaga, by KAŻDY wpis listy był szumem: gdy przeglądarka dołoży do
 * łańcucha realny wyjątek, zdarzenie przechodzi w całości.
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
