import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

// ---------------------------------------------------------------------------
// Ratchet for `silentBusinessError` (best-effort enrichment opt-out).
//
// Guards the exact suppression contract in onCatchMainInterceptor: when a query
// opts into `silentBusinessError`, a business 4xx (NOT 401, NOT 5xx) fails SOFT
// — no user-facing snackbar (pushEventToBus skipped) but STILL a settled error
// (passCallback) + STILL a log (reportIssueFrontend). A future refactor that
// widens the suppression to 401/5xx, or that drops the passCallback/log, breaks
// one of these cases. Mock the side-effect modules so we assert on calls, not IO.
// `vi.hoisted` so the spies exist when vi.mock factories (hoisted) reference them.
// ---------------------------------------------------------------------------

const { pushEventToBus, reportIssueFrontend } = vi.hoisted(() => ({
  pushEventToBus: vi.fn(async () => undefined),
  reportIssueFrontend: vi.fn(() => undefined),
}));

vi.mock('../event-bus/eventBus.possibilities.api', () => ({ pushEventToBus }));
vi.mock('../error-debugger/errorHandler.possibilities.api', () => ({
  reportIssueFrontend,
}));
vi.mock('../error-debugger/debugger.utils.api', () => ({
  __debuggerGate: (fn: () => void) => fn(),
}));
vi.mock('../client-device-storage/clientStorage.possibilities.api', () => ({
  getFromClientStorage: vi.fn(() => null),
  setToClientStorage: vi.fn(),
  deleteFromClientStorage: vi.fn(),
}));

import { interceptors } from './http.interceptor';
import {
  deleteFromClientStorage,
  setToClientStorage,
} from '../client-device-storage/clientStorage.possibilities.api';
import type { CallHTTPEndpointConfig } from './http.possibilities.api';

const baseConfig = (
  overrides: Partial<CallHTTPEndpointConfig> = {}
): CallHTTPEndpointConfig => ({
  url: () => 'https://example.test/api',
  mode: 'get',
  ...overrides,
});

const businessError = (status: number) => ({
  response: {
    data: {
      event: APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR,
      data: undefined,
    },
    status,
  },
  message: 'error',
});

describe('onCatchMainInterceptor — silentBusinessError suppression', () => {
  beforeEach(() => {
    pushEventToBus.mockClear();
    reportIssueFrontend.mockClear();
  });

  it('suppresses the snackbar on a business 4xx (403) but still settles + logs', async () => {
    const passCallback = vi.fn(async () => undefined);

    await interceptors.error<undefined>({
      error: businessError(403),
      config: baseConfig({ silentBusinessError: true }),
      passCallback,
    });

    // No user-facing toast for the best-effort enrichment failure.
    expect(pushEventToBus).not.toHaveBeenCalled();
    // TanStack Query still gets the error (isError → hook falls back to []).
    expect(passCallback).toHaveBeenCalledTimes(1);
    // Still logged for diagnostics.
    expect(reportIssueFrontend).toHaveBeenCalledTimes(1);
  });

  it('does NOT suppress when the flag is absent (default behavior unchanged)', async () => {
    const passCallback = vi.fn(async () => undefined);

    await interceptors.error<undefined>({
      error: businessError(403),
      config: baseConfig(),
      passCallback,
    });

    expect(pushEventToBus).toHaveBeenCalledTimes(1);
    expect(passCallback).toHaveBeenCalledTimes(1);
  });

  it('does NOT suppress a 401 even under the flag (re-auth must surface)', async () => {
    const passCallback = vi.fn(async () => undefined);

    await interceptors.error<undefined>({
      error: businessError(401),
      config: baseConfig({ silentBusinessError: true }),
      passCallback,
    });

    expect(pushEventToBus).toHaveBeenCalledTimes(1);
  });

  it('does NOT suppress a 5xx even under the flag (real server fault)', async () => {
    const passCallback = vi.fn(async () => undefined);

    await interceptors.error<undefined>({
      error: businessError(500),
      config: baseConfig({ silentBusinessError: true }),
      passCallback,
    });

    expect(pushEventToBus).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Ratchet for endpoint-level background feedback policy.
//
// Background reads are not explicit user actions. Their failures still settle
// the caller and real HTTP failures still reach diagnostics, but they must not
// create one snackbar per failed XHR/retry. Auth/account-state 401/403 events are
// preserved because the event pipeline owns re-auth and critical redirects.
// ---------------------------------------------------------------------------

describe('onCatchMainInterceptor — background feedback policy', () => {
  beforeEach(() => {
    pushEventToBus.mockClear();
    reportIssueFrontend.mockClear();
  });

  it.each([404, 500])(
    'suppresses a background HTTP %i toast but still settles and logs',
    async status => {
      const passCallback = vi.fn(async () => undefined);

      await interceptors.error<undefined>({
        error: businessError(status),
        config: baseConfig({ errorFeedbackPolicy: 'background' }),
        passCallback,
      });

      expect(pushEventToBus).not.toHaveBeenCalled();
      expect(passCallback).toHaveBeenCalledTimes(1);
      expect(reportIssueFrontend).toHaveBeenCalledTimes(1);
    }
  );

  it.each([401, 403])(
    'keeps a background HTTP %i event in the pipeline for auth/account-state handling',
    async status => {
      const passCallback = vi.fn(async () => undefined);

      await interceptors.error<undefined>({
        error: businessError(status),
        config: baseConfig({ errorFeedbackPolicy: 'background' }),
        passCallback,
      });

      expect(pushEventToBus).toHaveBeenCalledTimes(1);
      expect(passCallback).toHaveBeenCalledTimes(1);
    }
  );

  it('gives background 403 safety handling precedence over silentBusinessError', async () => {
    const passCallback = vi.fn(async () => undefined);

    await interceptors.error<undefined>({
      error: businessError(403),
      config: baseConfig({
        errorFeedbackPolicy: 'background',
        silentBusinessError: true,
      }),
      passCallback,
    });

    expect(pushEventToBus).toHaveBeenCalledTimes(1);
    expect(passCallback).toHaveBeenCalledTimes(1);
  });

  it('suppresses a background NETWORK toast and still settles the caller', async () => {
    const passCallback = vi.fn(async () => undefined);

    await interceptors.error<undefined>({
      error: { message: 'Failed to fetch' },
      config: baseConfig({ errorFeedbackPolicy: 'background' }),
      passCallback,
    });

    expect(pushEventToBus).not.toHaveBeenCalled();
    expect(passCallback).toHaveBeenCalledTimes(1);
    expect(reportIssueFrontend).not.toHaveBeenCalled();
  });

  it('suppresses a background TIMEOUT toast and still settles the caller', async () => {
    const passCallback = vi.fn(async () => undefined);

    await interceptors.error<undefined>({
      error: { message: 'timeout', code: 'ERR_TIMEOUT' },
      config: baseConfig({ errorFeedbackPolicy: 'background' }),
      passCallback,
    });

    expect(pushEventToBus).not.toHaveBeenCalled();
    expect(passCallback).toHaveBeenCalledTimes(1);
    expect(reportIssueFrontend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Ratchet for client-error-noise hygiene (class C: status-0 connectivity) +
// the interceptor log-message URL resolution.
//
// status 0 = no HTTP response at all (offline / backgrounded / CORS / adblock)
// = client connectivity, NOT an app error → the backend ERROR log is skipped
// while the user still gets the INTERNET_CONNECTION_PROBLEM snackbar. A genuine
// server 5xx keeps its status and STILL logs — with a RESOLVED URL string, not
// the raw EndpointURLFunction source.
// ---------------------------------------------------------------------------

// A NETWORK failure carries NO `response` → errorStatusCode resolves to 0.
const networkError = () => ({
  message: 'Failed to fetch',
});

describe('onCatchMainInterceptor — status-0 connectivity noise + resolved URL', () => {
  beforeEach(() => {
    pushEventToBus.mockClear();
    reportIssueFrontend.mockClear();
  });

  it('does NOT log a status-0 (no-response) NETWORK error to the backend', async () => {
    const passCallback = vi.fn(async () => undefined);

    await interceptors.error<undefined>({
      error: networkError(),
      config: baseConfig(),
      passCallback,
    });

    // Backend ERROR log skipped — non-actionable client connectivity failure.
    expect(reportIssueFrontend).not.toHaveBeenCalled();
    // User is still informed: the connectivity snackbar still fires.
    expect(pushEventToBus).toHaveBeenCalledTimes(1);
    // TanStack Query still settles the error.
    expect(passCallback).toHaveBeenCalledTimes(1);
  });

  it('STILL logs a real 500 with a RESOLVED URL string (not a function source)', async () => {
    const passCallback = vi.fn(async () => undefined);

    await interceptors.error<undefined>({
      error: businessError(500),
      config: baseConfig(),
      passCallback,
    });

    expect(reportIssueFrontend).toHaveBeenCalledTimes(1);
    const firstCall = reportIssueFrontend.mock.calls[0] as unknown as
      [{ message?: string }] | undefined;
    const loggedMessage = firstCall?.[0]?.message ?? '';
    // Endpoint identity is the resolved URL, not the minified function body.
    expect(loggedMessage).toContain('https://example.test/api');
    expect(loggedMessage).not.toContain('=>');
    expect(loggedMessage).not.toContain('function');
  });
});

// Login-CSRF gate: the ?authCode exchange must RECEIVE the bearer instead of
// having it persisted, or a reload / another tab runs as an unconfirmed account.
describe('onEveryCallHeadersSideEffectInterceptor — authorization capture', () => {
  beforeEach(() => {
    vi.mocked(setToClientStorage).mockClear();
    vi.mocked(deleteFromClientStorage).mockClear();
  });

  it('persists a response bearer by default', async () => {
    await interceptors.headers({ headers: { authorization: 'tok' } });
    expect(setToClientStorage).toHaveBeenCalledWith({
      key: 'authorization',
      value: 'tok',
    });
  });

  it('hands the bearer to the caller and writes NOTHING when capturing', async () => {
    const capture = vi.fn();
    await interceptors.headers({
      headers: { authorization: 'tok' },
      captureAuthorization: capture,
    });
    expect(capture).toHaveBeenCalledWith('tok');
    expect(setToClientStorage).not.toHaveBeenCalled();
    expect(deleteFromClientStorage).not.toHaveBeenCalled();
  });
});

describe('pair request outcome evidence', () => {
  it('forwards only creation evidence after the callback settles', async () => {
    pushEventToBus.mockClear();
    const passCallback = vi.fn(async () => undefined);
    await interceptors.success({
      response: {
        data: {
          event: APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT,
          data: { created: false, privateField: 'not forwarded' },
        },
      },
      config: baseConfig(),
      passCallback,
    });
    expect(passCallback).toHaveBeenCalledOnce();
    expect(pushEventToBus).toHaveBeenCalledWith({
      event: APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT,
      payload: {
        snackbarColor: 'success',
        outcomeEvidence: { created: false },
      },
    });
  });
  it('forwards a declared screen owner and omits the default', async () => {
    for (const [successFeedback, expected] of [
      ['screen', { snackbarColor: 'success', successFeedback: 'screen' }],
      ['silent', { snackbarColor: 'success', successFeedback: 'silent' }],
      ['event', { snackbarColor: 'success' }],
    ] as const) {
      pushEventToBus.mockClear();
      await interceptors.success({
        response: {
          data: {
            event: APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED,
            data: {},
          },
        },
        config: { ...baseConfig(), successFeedback },
        passCallback: async () => undefined,
      });
      expect(pushEventToBus).toHaveBeenCalledWith({
        event: APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED,
        payload: expected,
      });
    }
  });
  it('does not forward unrelated response data', async () => {
    pushEventToBus.mockClear();
    await interceptors.success({
      response: {
        data: {
          event: APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_CREATED,
          data: { created: true },
        },
      },
      config: baseConfig(),
      passCallback: async () => undefined,
    });
    expect(pushEventToBus).toHaveBeenCalledWith({
      event: APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_CREATED,
      payload: { snackbarColor: 'success' },
    });
  });
});

describe('HTTP error classification', () => {
  beforeEach(() => {
    pushEventToBus.mockClear();
    reportIssueFrontend.mockClear();
  });
  it.each([
    [429, APP_EVENTS.INFO.APPLICATION.RATE_LIMIT_EXCEEDED_INFO, 'warn'],
    [403, APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO, 'warn'],
    [403, APP_EVENTS.INFO.USER.UNAUTHORIZED, 'error'],
    [500, APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error'],
  ] as const)(
    'classifies HTTP %s event %s as %s',
    async (status, event, mode) => {
      await interceptors.error({
        error: { response: { status, data: { event, data: undefined } } },
        config: baseConfig(),
        passCallback: async () => undefined,
      });
      expect(reportIssueFrontend).toHaveBeenCalledWith(
        expect.objectContaining({ mode })
      );
    }
  );
  it('classifies a stale plan quote as a recoverable rejection', async () => {
    await interceptors.error({
      error: {
        response: {
          status: 409,
          data: {
            event: APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
            data: { field: 'quoteId', reason: 'expired' },
          },
        },
      },
      config: baseConfig(),
      passCallback: async () => undefined,
    });
    expect(reportIssueFrontend).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'warn' })
    );
  });
  it.each(['foreground', 'background'] as const)(
    'records a local defect under %s policy without calling it offline',
    async errorFeedbackPolicy => {
      const passCallback = vi.fn(async () => undefined);
      await interceptors.error({
        error: {
          code: 'ERR_CLIENT_REQUEST',
          message: 'Cannot serialize request',
          stack: 'test stack',
        },
        config: baseConfig({ errorFeedbackPolicy }),
        passCallback,
      });
      expect(passCallback).toHaveBeenCalledWith({
        event: APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR,
        data: undefined,
      });
      expect(reportIssueFrontend).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'http.client', mode: 'error' })
      );
      expect(pushEventToBus).toHaveBeenCalledTimes(
        errorFeedbackPolicy === 'foreground' ? 1 : 0
      );
    }
  );
});
