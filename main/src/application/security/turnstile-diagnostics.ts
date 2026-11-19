import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';

type FailurePhase = 'challenge' | 'initialization' | 'timeout' | 'unsupported';

/** One bounded reporter per mounted widget. Cloudflare can repeat a callback during automatic retry. An attempt starts on load, manual retry or submit reset. */
export function createTurnstileFailureReporter() {
  const reported = new Set<string>();
  return (phase: FailurePhase, attempt: number, errorCode?: unknown): void => {
    // Only the documented numeric code may cross this boundary, never a vendor object or token.
    const code =
      typeof errorCode === 'string' && /^\d{6}$/.test(errorCode)
        ? errorCode
        : null;
    const key = `${attempt}:${phase}:${code}`;
    if (reported.has(key) || reported.size >= 10) {
      return;
    }
    reported.add(key);
    reportIssueFrontend({
      namespace: 'TURNSTILE_WIDGET',
      message: 'Turnstile client verification failed',
      mode: 'warn',
      // The shared reporter adds path (without query), browser, environment and build ID.
      payload: { phase, attempt, error_code: code },
    });
  };
}
