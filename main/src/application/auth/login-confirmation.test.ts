import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { signOutMock, getSessionMock } = vi.hoisted(() => ({
  signOutMock: vi.fn((_opts?: unknown) => Promise.resolve()),
  getSessionMock: vi.fn((_opts?: unknown): Promise<{ data: unknown }> =>
    Promise.resolve({ data: null })
  ),
}));
vi.mock('./better-auth-client', () => ({
  signOut: signOutMock,
  authClient: { getSession: getSessionMock },
}));

import {
  LOGIN_INTENT_TTL_MS,
  captureFreshLoginSignals,
  clearLoginStarted,
  fetchPendingLoginEmail,
  isLoginIntentValid,
  markLoginStarted,
  needsLoginConfirmation,
  persistSessionToken,
  readLoginStartedAt,
  resolveRejectedLoginTarget,
  revokePendingLogin,
} from './login-confirmation';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';

const NOW = 1_800_000_000_000;
const TOKEN_KEY = 'authorization';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  signOutMock.mockClear();
  getSessionMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('needsLoginConfirmation (owner rule: previousToken || !validMarker)', () => {
  it.each([
    { hadPreviousToken: false, hadValidMarker: true, expected: false },
    { hadPreviousToken: false, hadValidMarker: false, expected: true },
    { hadPreviousToken: true, hadValidMarker: true, expected: true },
    { hadPreviousToken: true, hadValidMarker: false, expected: true },
  ])(
    'token=$hadPreviousToken marker=$hadValidMarker → $expected',
    ({ hadPreviousToken, hadValidMarker, expected }) => {
      expect(needsLoginConfirmation({ hadPreviousToken, hadValidMarker })).toBe(
        expected
      );
    }
  );
});

describe('isLoginIntentValid', () => {
  it('accepts a fresh marker and one exactly at the TTL', () => {
    expect(isLoginIntentValid(NOW, NOW)).toBe(true);
    expect(isLoginIntentValid(NOW - LOGIN_INTENT_TTL_MS, NOW)).toBe(true);
  });

  it('rejects an expired, missing or future marker', () => {
    expect(isLoginIntentValid(NOW - LOGIN_INTENT_TTL_MS - 1, NOW)).toBe(false);
    expect(isLoginIntentValid(null, NOW)).toBe(false);
    expect(isLoginIntentValid(NOW + 1000, NOW)).toBe(false);
  });

  it('uses a 30 minute window', () => {
    expect(LOGIN_INTENT_TTL_MS).toBe(30 * 60 * 1000);
  });
});

describe('marker helpers', () => {
  it('stores the start time in localStorage under the SSOT key', () => {
    markLoginStarted(NOW);
    expect(localStorage.getItem(STORAGE_KEYS.LOGIN_STARTED_AT)).toBe(
      String(NOW)
    );
    expect(readLoginStartedAt()).toBe(NOW);
  });

  it('defaults the stamp to the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    markLoginStarted();
    expect(readLoginStartedAt()).toBe(NOW);
  });

  it('clears the marker', () => {
    markLoginStarted(NOW);
    clearLoginStarted();
    expect(readLoginStartedAt()).toBeNull();
  });

  it.each(['', 'abc', '12.5', '-5', '1e12'])(
    'reads a malformed value %j as absent',
    raw => {
      localStorage.setItem(STORAGE_KEYS.LOGIN_STARTED_AT, raw);
      expect(readLoginStartedAt()).toBeNull();
    }
  );
});

describe('captureFreshLoginSignals', () => {
  it('no token, fresh marker → valid marker, no previous token', () => {
    markLoginStarted(NOW - 60_000);
    expect(captureFreshLoginSignals(NOW)).toEqual({
      hadPreviousToken: false,
      hadValidMarker: true,
    });
  });

  it('expired marker counts as no marker, so the login must be confirmed', () => {
    markLoginStarted(NOW - LOGIN_INTENT_TTL_MS - 1);
    const signals = captureFreshLoginSignals(NOW);
    expect(signals.hadValidMarker).toBe(false);
    expect(needsLoginConfirmation(signals)).toBe(true);
  });

  it('sees an existing token', () => {
    localStorage.setItem(TOKEN_KEY, 'victim-token');
    markLoginStarted(NOW);
    expect(captureFreshLoginSignals(NOW)).toEqual({
      hadPreviousToken: true,
      hadValidMarker: true,
    });
  });
});

describe('persistSessionToken', () => {
  it('writes the raw token under the authorization key', () => {
    persistSessionToken('new-token');
    expect(localStorage.getItem(TOKEN_KEY)).toBe('new-token');
  });
});

describe('fetchPendingLoginEmail', () => {
  it('asks for the session with the unconfirmed token as an explicit Bearer', async () => {
    localStorage.setItem(TOKEN_KEY, 'victim-token');
    getSessionMock.mockResolvedValueOnce({
      data: { user: { email: 'attacker@example.com' } },
    });

    await expect(fetchPendingLoginEmail('attacker-token')).resolves.toBe(
      'attacker@example.com'
    );
    expect(getSessionMock).toHaveBeenCalledWith({
      fetchOptions: { auth: { type: 'Bearer', token: 'attacker-token' } },
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('victim-token');
  });

  it('returns null when the session cannot be read', async () => {
    getSessionMock.mockResolvedValueOnce({ data: null });
    await expect(fetchPendingLoginEmail('t')).resolves.toBeNull();
    getSessionMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchPendingLoginEmail('t')).resolves.toBeNull();
  });
});

describe('revokePendingLogin', () => {
  it('signs out the unconfirmed session with its own token and never touches storage', async () => {
    localStorage.setItem(TOKEN_KEY, 'victim-token');
    markLoginStarted(NOW);

    await revokePendingLogin('attacker-token');

    expect(signOutMock).toHaveBeenCalledWith({
      fetchOptions: { auth: { type: 'Bearer', token: 'attacker-token' } },
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('victim-token');
    expect(readLoginStartedAt()).toBeNull();
  });

  it('swallows a failed revoke', async () => {
    signOutMock.mockImplementationOnce(() =>
      Promise.reject(new Error('offline'))
    );
    await expect(revokePendingLogin('attacker-token')).resolves.toBeUndefined();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('does not wait longer than the timeout for a hanging revoke', async () => {
    vi.useFakeTimers();
    signOutMock.mockImplementationOnce(() => new Promise<void>(() => {}));

    const done = revokePendingLogin('attacker-token');
    await vi.advanceTimersByTimeAsync(2500);
    await expect(done).resolves.toBeUndefined();
  });
});

describe('resolveRejectedLoginTarget', () => {
  it('returns to the app when a previous session is still stored', () => {
    expect(
      resolveRejectedLoginTarget({
        pathname: '/app/onboarding',
        hadPreviousSession: true,
      })
    ).toBe('/app');
  });

  it('returns to the login screen when there was no previous session', () => {
    expect(
      resolveRejectedLoginTarget({
        pathname: '/app',
        hadPreviousSession: false,
      })
    ).toBe('/user/login');
  });

  it('keeps the language of the landing path', () => {
    expect(
      resolveRejectedLoginTarget({
        pathname: '/en/app/onboarding',
        hadPreviousSession: false,
      })
    ).toBe('/en/user/login');
    expect(
      resolveRejectedLoginTarget({
        pathname: '/de/app',
        hadPreviousSession: true,
      })
    ).toBe('/de/app');
  });
});
