import { getCurrentRequestTarget } from '@app/http/request-context';

export const captureStackTrace = (): string[] => {
  // A fresh Error object only to obtain a stack trace; it is never thrown.
  const error = new Error();

  // `stack` is one string; each line is one call.
  const stackLines = error.stack?.split('\n') || [];

  // Line 1 is the "Error" header, line 2 is captureStackTrace itself, line 3 is the logging
  // function that called it; the real callers start at line 4.

  return stackLines
    .slice(3) // drop the 3 noise lines
    .slice(0, 5); // keep at most 5 frames
};

/**
 * Marker for logs written outside request handling: startup, SIGTERM hooks, background sweeps.
 * Deliberately one constant string instead of `null`: the `client_url` column is NOT NULL, and an
 * explicit marker can be filtered in the admin panel.
 */
export const SYSTEM_CLIENT_URL = 'system';

/**
 * Current request target (`METHOD /pathname`) for the `client_url` column.
 *
 * DECISION: the target is the current request (`METHOD /pathname`) taken from the ALS set in
 * timing.middleware, without changing the signatures of ~100 reportIssueBackend call sites. It used
 * to return `FRONTEND_PUBLIC_DOMAIN + ':' + FRONTEND_PUBLIC_PORT`, i.e. a CONSTANT `"nailfolio.app:"`
 * in EVERY production record, which made it impossible to tell from the log store which endpoint
 * failed. The environment lives in its own `environment` column, so the domain was a duplicate.
 */
export const getClientURL = (): string =>
  getCurrentRequestTarget() ?? SYSTEM_CLIENT_URL;
