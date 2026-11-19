import { describe, expect, it, vi } from 'vitest';
import {
  beginNativeStartup,
  classifyNativeSessionValidation,
  completeNativeStartup,
  getNativeSessionErrorStatus,
  isNativeStartupPending,
  isNativeEntryBootstrapCandidate,
  isNativeStartupPlatform,
  onNativeStartupReady,
} from './native-startup';

const candidate = (
  overrides: Partial<Parameters<typeof isNativeEntryBootstrapCandidate>[0]> = {}
) =>
  isNativeEntryBootstrapCandidate({
    pathname: '/',
    search: '?platform=android',
    hash: '',
    isNativeApp: true,
    entryResolved: false,
    ...overrides,
  });

describe('native entry bootstrap policy', () => {
  it('recognizes wrapper query platforms even when platform detection cannot read storage', () => {
    expect(isNativeStartupPlatform(false, '?platform=android')).toBe(true);
    expect(isNativeStartupPlatform(false, '?platform=ios')).toBe(true);
    expect(isNativeStartupPlatform(false, '?platform=web')).toBe(false);
    expect(isNativeStartupPlatform(true, '')).toBe(true);
  });

  it('starts only on a bare native home entry', () => {
    expect(candidate()).toBe(true);
    expect(candidate({ pathname: '/en/' })).toBe(true);
    expect(candidate({ pathname: '/app' })).toBe(false);
    expect(candidate({ isNativeApp: false })).toBe(false);
    expect(candidate({ entryResolved: true })).toBe(false);
  });

  it('preserves explicit auth, QR, target and anchor routes', () => {
    expect(candidate({ search: '?platform=android&authCode=once' })).toBe(
      false
    );
    expect(candidate({ search: '?platform=android&qrCode=pairing' })).toBe(
      false
    );
    expect(
      candidate({ search: '?platform=android&target=%2Fapp%2Fgallery' })
    ).toBe(false);
    expect(candidate({ hash: '#faq' })).toBe(false);
  });
});

describe('native session validation verdict', () => {
  const base = {
    tokenAtRequest: 'token-a',
    liveToken: 'token-a',
    hasSession: false,
    isPending: false,
    hasError: false,
    errorStatus: null,
  };

  it('waits for the session request and only opens /app for a confirmed session', () => {
    expect(classifyNativeSessionValidation({ ...base, isPending: true })).toBe(
      'pending'
    );
    expect(classifyNativeSessionValidation({ ...base, hasSession: true })).toBe(
      'authenticated'
    );
  });

  it('routes an explicit 401 verdict away and keeps null/transport uncertainty distinct', () => {
    expect(
      classifyNativeSessionValidation({
        ...base,
        hasError: true,
        errorStatus: 401,
      })
    ).toBe('invalid');
    expect(classifyNativeSessionValidation(base)).toBe('unauthenticated');
    expect(
      classifyNativeSessionValidation({
        ...base,
        hasError: true,
        errorStatus: 503,
      })
    ).toBe('unavailable');
  });

  it('does not let an old response decide the fate of a newer token', () => {
    expect(
      classifyNativeSessionValidation({
        ...base,
        liveToken: 'token-b',
        hasError: true,
        errorStatus: 401,
      })
    ).toBe('stale-token');
  });

  it('extracts only numeric HTTP status codes from auth errors', () => {
    expect(getNativeSessionErrorStatus({ status: 401 })).toBe(401);
    expect(getNativeSessionErrorStatus({ status: '401' })).toBeNull();
    expect(getNativeSessionErrorStatus(null)).toBeNull();
  });
});

describe('native splash readiness bridge', () => {
  it('holds splash readiness until the coordinator commits a resolved screen', () => {
    beginNativeStartup();
    const ready = vi.fn();
    const unsubscribe = onNativeStartupReady(ready);

    expect(isNativeStartupPending()).toBe(true);
    expect(ready).not.toHaveBeenCalled();

    completeNativeStartup();

    expect(isNativeStartupPending()).toBe(false);
    expect(ready).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
