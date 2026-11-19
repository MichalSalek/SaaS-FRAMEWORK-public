import { getClientVerboseLog } from './client-verbose.state';

/**
 * Run the supplied callback only when verbose logging is on — the single
 * VERBOSE_LOG_MODE switch mirrored into client-verbose.state (see docs/LOGGING.md).
 * Same gate reportIssueFrontend uses for info logs, so a __debuggerGate block and an
 * info-mode reportIssueFrontend inside it fire together. Replaces the dead isDevMode
 * Zustand flag (which had no runtime toggle → these blocks never ran in prod).
 */
export const __debuggerGate = (evalOnDebugMode: () => void): void => {
  if (getClientVerboseLog()) {
    evalOnDebugMode();
  }
};

export const captureStackTrace = (): string[] => {
  // A fresh Error is created only to read its stack; it is never thrown.
  const error = new Error();
  const stackLines = error.stack?.split('\n') || [];

  // Line 0 is "Error", line 1 is captureStackTrace itself, line 2 is the logging function that
  // called it; the real callers start at line 3.

  return stackLines
    .slice(3) // drop the first 3 lines (noise)
    .slice(0, 5); // keep at most 5 lines
};
