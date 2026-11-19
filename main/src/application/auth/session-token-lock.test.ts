import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistSessionToken } from './login-confirmation';
import { withSessionTokenLock } from './session-token-lock';
import { clearAuthChannelTokens } from './auth-token-teardown';
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
describe('session token write coordination', () => {
  it('serializes cooperating writers and rechecks inside the lock', async () => {
    let release!: () => void;
    let tail = new Promise<void>(resolve => {
      release = resolve;
    });
    const request = vi.fn(
      (_name: string, _options: unknown, job: () => unknown) => {
        const result = tail.then(job);
        tail = result.then(() => undefined);
        return result;
      }
    );
    vi.stubGlobal('navigator', { locks: { request } });
    const first = withSessionTokenLock(() => {
      localStorage.setItem('authorization', 'other');
    });
    const second = persistSessionToken('exchange', false);
    expect(localStorage.getItem('authorization')).toBeNull();
    release();
    await first;
    expect(await second).toBe(false);
    expect(localStorage.getItem('authorization')).toBe('other');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('rechecks and writes synchronously when locks are unavailable', async () => {
    vi.stubGlobal('navigator', {});
    localStorage.setItem('authorization', 'other');
    expect(await persistSessionToken('exchange', false)).toBe(false);
    expect(localStorage.getItem('authorization')).toBe('other');
    localStorage.removeItem('authorization');
    const result = persistSessionToken('exchange', false);
    expect(localStorage.getItem('authorization')).toBe('exchange');
    expect(await result).toBe(true);
  });
  it('never clears a replacement bearer while waiting for the lock', async () => {
    let release!: () => void;
    let tail = new Promise<void>(resolve => {
      release = resolve;
    });
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, _options: unknown, job: () => unknown) => {
          const result = tail.then(job);
          tail = result.then(() => undefined);
          return result;
        },
      },
    });
    localStorage.setItem('authorization', 'a');
    const other = withSessionTokenLock(() =>
      localStorage.setItem('authorization', 'b')
    );
    const logout = clearAuthChannelTokens('a');
    release();
    await other;
    expect(await logout).toBe(false);
    expect(localStorage.getItem('authorization')).toBe('b');
  });
});
