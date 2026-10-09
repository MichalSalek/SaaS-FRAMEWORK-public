import { http, HttpResponse } from 'msw';

/**
 * Default MSW handlers — intentionally MINIMAL.
 *
 * Contract tests (W0.3) register per-test handlers via `mswServer.use(...)`
 * to characterize the exact endpoint they exercise. Keeping the default set
 * empty means an unhandled request throws (see vitest.setup.ts
 * `onUnhandledRequest: 'error'`) — which is what surfaces an `enabled`-gated
 * query firing when it should not.
 *
 * Add a handler here ONLY if it is genuinely shared by most tests.
 */
export const handlers = [
  // Better-Auth session probe fired by some providers on mount. Returning an
  // unauthenticated shape keeps Auth-wrapped renders from hanging when a test
  // does not care about auth. Tests that DO care override this.
  http.get('*/api/auth/get-session', () => HttpResponse.json(null)),
];
