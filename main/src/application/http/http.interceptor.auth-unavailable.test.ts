import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS } from '@kernel/application/auth/auth.config';
import { EVENT_PIPELINE_CONFIG } from '@kernel/domain/events/event-pipeline.config';

/**
 * Transport half of the AUTH_UNAVAILABLE contract: the error interceptor with REAL storage
 * and the REAL auth-token-teardown. 503 AUTH_UNAVAILABLE (the server could not check the token)
 * keeps the token, settles the caller with the event and tells the user; the honest 401
 * LOGIN_FIRST still clears exactly the live token, never a fresher one and never during an
 * impersonation.
 */

const { pushEventToBus } = vi.hoisted(() => ({
  pushEventToBus: vi.fn(async () => undefined),
}));
vi.mock('../event-bus/eventBus.possibilities.api', () => ({ pushEventToBus }));
vi.mock('../error-debugger/errorHandler.possibilities.api', () => ({
  reportIssueFrontend: vi.fn(),
}));
vi.mock('../error-debugger/debugger.utils.api', () => ({
  __debuggerGate: () => undefined,
}));

import { interceptors } from './http.interceptor';
import { AUTH_TOKEN_CLEARED_EVENT } from '../auth/auth-token-teardown';
import type { CallHTTPEndpointConfig } from './http.possibilities.api';

const LIVE_TOKEN = 'live-token-abc123';
const FRESH_TOKEN = 'fresh-token-after-login';

const config = (
  overrides: Partial<CallHTTPEndpointConfig> = {}
): CallHTTPEndpointConfig => ({
  url: () => 'https://example.test/api/v1/favorite/get-records',
  mode: 'get',
  ...overrides,
});

const response = (status: number, event: string | undefined) => ({
  response: {
    data:
      event === undefined
        ? undefined
        : {
            event,
            data:
              status === 503
                ? { retryAfter: AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS }
                : undefined,
          },
    status,
  },
  message: 'error',
});

const storedToken = (): string | null =>
  localStorage.getItem(CUSTOM_HEADERS.authorization);

const fail = async (
  status: number,
  event: string | undefined,
  overrides: Partial<CallHTTPEndpointConfig> = {}
) => {
  const passCallback = vi.fn(async () => undefined);
  let cleared = 0;
  const onCleared = () => {
    cleared += 1;
  };
  window.addEventListener(AUTH_TOKEN_CLEARED_EVENT, onCleared);
  await interceptors.error<unknown>({
    // The adapter error envelope is typed by the endpoint; the event string is the variable here.
    error: response(status, event) as Parameters<
      typeof interceptors.error<unknown>
    >[0]['error'],
    config: config(overrides),
    passCallback,
    requestAuthorization: `Bearer ${LIVE_TOKEN}`,
  });
  window.removeEventListener(AUTH_TOKEN_CLEARED_EVENT, onCleared);
  return { passCallback, cleared };
};

describe('error interceptor: AUTH_UNAVAILABLE keeps the session', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    pushEventToBus.mockClear();
    localStorage.setItem(CUSTOM_HEADERS.authorization, LIVE_TOKEN);
  });

  it('the kernel event exists and is not token-invalidating', () => {
    expect(APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE).toBe('AUTH_UNAVAILABLE');
    expect(EVENT_PIPELINE_CONFIG.AUTH_TOKEN_INVALIDATING).not.toContain(
      APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE
    );
  });

  it('503 AUTH_UNAVAILABLE on a foreground call: token kept, caller settled, message shown', async () => {
    const { passCallback, cleared } = await fail(
      503,
      APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE
    );
    expect(storedToken()).toBe(LIVE_TOKEN);
    expect(cleared).toBe(0);
    expect(passCallback).toHaveBeenCalledWith({
      event: APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE,
      data: { retryAfter: AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS },
    });
    expect(pushEventToBus).toHaveBeenCalledWith({
      event: APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE,
      payload: { snackbarColor: 'error' },
    });
  });

  it('503 AUTH_UNAVAILABLE on a background read: token kept, no toast (the screen renders it)', async () => {
    const { passCallback } = await fail(
      503,
      APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE,
      { errorFeedbackPolicy: 'background' }
    );
    expect(storedToken()).toBe(LIVE_TOKEN);
    expect(passCallback).toHaveBeenCalledTimes(1);
    expect(pushEventToBus).not.toHaveBeenCalled();
  });

  it('a bare 503 without a readable event keeps the token too', async () => {
    await fail(503, undefined);
    expect(storedToken()).toBe(LIVE_TOKEN);
  });

  it('a real 401 LOGIN_FIRST about the live token still clears it', async () => {
    const { cleared } = await fail(401, APP_EVENTS.INFO.USER.LOGIN_FIRST);
    expect(storedToken()).toBeNull();
    expect(cleared).toBe(1);
  });

  it('a 401 about an older token keeps a fresher login', async () => {
    localStorage.setItem(CUSTOM_HEADERS.authorization, FRESH_TOKEN);
    await fail(401, APP_EVENTS.INFO.USER.LOGIN_FIRST);
    expect(storedToken()).toBe(FRESH_TOKEN);
  });

  it('a 401 during an impersonation keeps both channels', async () => {
    localStorage.setItem(CUSTOM_HEADERS.becomeUser, 'hmac.ref.expires');
    await fail(401, APP_EVENTS.INFO.USER.LOGIN_FIRST);
    expect(storedToken()).toBe(LIVE_TOKEN);
    expect(localStorage.getItem(CUSTOM_HEADERS.becomeUser)).toBe(
      'hmac.ref.expires'
    );
  });
});
