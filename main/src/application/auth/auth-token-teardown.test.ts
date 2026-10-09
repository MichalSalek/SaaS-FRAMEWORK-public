import { describe, it, expect, beforeEach } from 'vitest';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  AUTH_TOKEN_CLEARED_EVENT,
  clearAuthChannelTokens,
  isAuthRejection,
  tearDownRejectedSessionToken,
} from './auth-token-teardown';

/**
 * Guards the bug class from 2026-08-31: a dead bearer token that nobody cleared
 * made the native pre-paint entry bridge route every cold start to /app → 401 →
 * login, so /welcome became unreachable. These tests pin the SAFETY conditions
 * of the teardown — clearing too eagerly would log out legitimate users.
 */

const LIVE_TOKEN = 'live-token-abc123';
const OTHER_TOKEN = 'other-token-xyz789';

const setStoredToken = (value: string | null): void => {
  if (value === null) {
    localStorage.removeItem(CUSTOM_HEADERS.authorization);
    return;
  }
  localStorage.setItem(CUSTOM_HEADERS.authorization, value);
};

const storedToken = (): string | null =>
  localStorage.getItem(CUSTOM_HEADERS.authorization);

describe('isAuthRejection', () => {
  it('recognises LOGIN_FIRST (server could not map the credentials)', () => {
    expect(
      isAuthRejection({
        event: APP_EVENTS.INFO.USER.LOGIN_FIRST,
        status: 401,
      })
    ).toBe(true);
  });

  it('recognises a bare 401 with no readable event (truncated / non-JSON body)', () => {
    expect(isAuthRejection({ event: undefined, status: 401 })).toBe(true);
  });

  it('does NOT treat UNAUTHORIZED as a dead token (valid token, missing permission)', () => {
    expect(
      isAuthRejection({
        event: APP_EVENTS.INFO.USER.UNAUTHORIZED,
        status: 403,
      })
    ).toBe(false);
  });

  it('does NOT treat a 401 carrying UNAUTHORIZED as a dead token (S122: role refusal logged the admin out)', () => {
    expect(
      isAuthRejection({
        event: APP_EVENTS.INFO.USER.UNAUTHORIZED,
        status: 401,
      })
    ).toBe(false);
  });

  it('does NOT treat USER_DISABLED as a dead token (ban/soft-delete has its own flow)', () => {
    expect(
      isAuthRejection({
        event: APP_EVENTS.INFO.USER.USER_DISABLED,
        status: 403,
      })
    ).toBe(false);
  });

  it('does NOT treat a connectivity failure as a rejection', () => {
    expect(
      isAuthRejection({
        event: APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM,
        status: 0,
      })
    ).toBe(false);
  });
});

describe('tearDownRejectedSessionToken', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('clears the token when the server refused exactly this token', () => {
    setStoredToken(LIVE_TOKEN);
    const didClear = tearDownRejectedSessionToken({
      rejectedAuthorization: `Bearer ${LIVE_TOKEN}`,
    });
    expect(didClear).toBe(true);
    expect(storedToken()).toBeNull();
  });

  it('matches a raw (prefix-less) request value against a stored raw token', () => {
    setStoredToken(LIVE_TOKEN);
    expect(
      tearDownRejectedSessionToken({ rejectedAuthorization: LIVE_TOKEN })
    ).toBe(true);
    expect(storedToken()).toBeNull();
  });

  it('matches a stored Bearer-prefixed token against a Bearer request value', () => {
    setStoredToken(`Bearer ${LIVE_TOKEN}`);
    expect(
      tearDownRejectedSessionToken({
        rejectedAuthorization: `Bearer ${LIVE_TOKEN}`,
      })
    ).toBe(true);
    expect(storedToken()).toBeNull();
  });

  // THE fresh-login race: a slow request sent before login lands its 401 after
  // the new token was stamped. Clearing here would destroy a valid session.
  it('keeps a NEWER token when a stale verdict about an older token arrives', () => {
    setStoredToken(LIVE_TOKEN);
    const didClear = tearDownRejectedSessionToken({
      rejectedAuthorization: `Bearer ${OTHER_TOKEN}`,
    });
    expect(didClear).toBe(false);
    expect(storedToken()).toBe(LIVE_TOKEN);
  });

  it('keeps both channels while an impersonation is active', () => {
    setStoredToken(LIVE_TOKEN);
    localStorage.setItem(CUSTOM_HEADERS.becomeUser, 'hmac.ref.expires');
    const didClear = tearDownRejectedSessionToken({
      rejectedAuthorization: `Bearer ${LIVE_TOKEN}`,
    });
    expect(didClear).toBe(false);
    expect(storedToken()).toBe(LIVE_TOKEN);
    expect(localStorage.getItem(CUSTOM_HEADERS.becomeUser)).toBe(
      'hmac.ref.expires'
    );
  });

  it('is a no-op for a logged-out visitor (no credentials went out)', () => {
    setStoredToken(null);
    expect(
      tearDownRejectedSessionToken({ rejectedAuthorization: undefined })
    ).toBe(false);
    expect(tearDownRejectedSessionToken({ rejectedAuthorization: '' })).toBe(
      false
    );
  });

  it('is a no-op when storage no longer holds any token', () => {
    setStoredToken(null);
    expect(
      tearDownRejectedSessionToken({
        rejectedAuthorization: `Bearer ${LIVE_TOKEN}`,
      })
    ).toBe(false);
  });

  // The clear removes the idle-expiry guard's precondition (`getToken() !== null`),
  // so AuthContext must be told same-tab — otherwise the cache keeps serving the
  // previous identity behind a stale isLoggedIn.
  it('announces the clear so AuthContext can drop the cached identity', () => {
    setStoredToken(LIVE_TOKEN);
    let announced = 0;
    const listener = () => {
      announced += 1;
    };
    window.addEventListener(AUTH_TOKEN_CLEARED_EVENT, listener);
    tearDownRejectedSessionToken({
      rejectedAuthorization: `Bearer ${LIVE_TOKEN}`,
    });
    window.removeEventListener(AUTH_TOKEN_CLEARED_EVENT, listener);
    expect(announced).toBe(1);
  });

  it('stays silent when nothing was cleared (no spurious identity teardown)', () => {
    setStoredToken(LIVE_TOKEN);
    let announced = 0;
    const listener = () => {
      announced += 1;
    };
    window.addEventListener(AUTH_TOKEN_CLEARED_EVENT, listener);
    tearDownRejectedSessionToken({
      rejectedAuthorization: `Bearer ${OTHER_TOKEN}`,
    });
    window.removeEventListener(AUTH_TOKEN_CLEARED_EVENT, listener);
    expect(announced).toBe(0);
  });
});

describe('clearAuthChannelTokens', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('drops BOTH auth-channel tokens (logout shape)', () => {
    localStorage.setItem(CUSTOM_HEADERS.authorization, LIVE_TOKEN);
    localStorage.setItem(CUSTOM_HEADERS.becomeUser, 'hmac.ref.expires');
    clearAuthChannelTokens();
    expect(localStorage.getItem(CUSTOM_HEADERS.authorization)).toBeNull();
    expect(localStorage.getItem(CUSTOM_HEADERS.becomeUser)).toBeNull();
  });
});
