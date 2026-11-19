import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readAuthCodeFromUrl, scrubAuthCodeFromUrl } from './auth-code.helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set window.location.search in jsdom (navigate to a synthetic URL). */
function setSearch(search: string): void {
  // jsdom supports window.location.search assignment via assign/href
  Object.defineProperty(window, 'location', {
    value: new URL(`http://localhost${search ? search : ''}`),
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// readAuthCodeFromUrl
// ---------------------------------------------------------------------------

describe('readAuthCodeFromUrl', () => {
  beforeEach(() => {
    // Reset to a clean URL before each test
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/'),
      writable: true,
      configurable: true,
    });
  });

  it('returns the authCode value when present', () => {
    setSearch('http://localhost/en/app?authCode=abc123');
    expect(readAuthCodeFromUrl()).toBe('abc123');
  });

  it('returns null when authCode param is absent', () => {
    setSearch('http://localhost/en/app');
    expect(readAuthCodeFromUrl()).toBeNull();
  });

  it('returns null when authCode is empty string', () => {
    setSearch('http://localhost/en/app?authCode=');
    expect(readAuthCodeFromUrl()).toBeNull();
  });

  it('returns null when authCode is whitespace-only', () => {
    setSearch('http://localhost/en/app?authCode=   ');
    expect(readAuthCodeFromUrl()).toBeNull();
  });

  it('returns the code when other params are also present', () => {
    setSearch('http://localhost/en/app?role=stylist&authCode=xyz789');
    expect(readAuthCodeFromUrl()).toBe('xyz789');
  });

  it('returns the code when authCode is first param', () => {
    setSearch('http://localhost/en/app?authCode=first&other=val');
    expect(readAuthCodeFromUrl()).toBe('first');
  });

  it('returns null when only unrelated params present', () => {
    setSearch('http://localhost/en/app?role=client&foo=bar');
    expect(readAuthCodeFromUrl()).toBeNull();
  });

  it('returns code with special characters (URL-encoded)', () => {
    // URLSearchParams will decode %2B as '+'
    setSearch('http://localhost/app?authCode=abc%2B123');
    expect(readAuthCodeFromUrl()).toBe('abc+123');
  });

  it('returns null when running on server (window is undefined)', () => {
    // Simulate SSR by temporarily removing window (restored after assertion).
    const originalWindow = global.window;
    delete (global as { window?: Window }).window;
    expect(readAuthCodeFromUrl()).toBeNull();
    global.window = originalWindow;
  });
});

// ---------------------------------------------------------------------------
// scrubAuthCodeFromUrl
// ---------------------------------------------------------------------------

describe('scrubAuthCodeFromUrl', () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    replaceStateSpy = vi.spyOn(window.history, 'replaceState');
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/'),
      writable: true,
      configurable: true,
    });
  });

  it('calls replaceState to remove authCode when present', () => {
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/en/app?authCode=abc123'),
      writable: true,
      configurable: true,
    });
    scrubAuthCodeFromUrl();
    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const calledWith = replaceStateSpy.mock.calls[0];
    const cleanedUrl = calledWith[2] as string;
    expect(cleanedUrl).not.toContain('authCode');
  });

  it('does NOT call replaceState when authCode is absent', () => {
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/en/app?role=client'),
      writable: true,
      configurable: true,
    });
    scrubAuthCodeFromUrl();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('preserves the pathname (locale prefix stays intact)', () => {
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/pl/app?authCode=tok&role=stylist'),
      writable: true,
      configurable: true,
    });
    scrubAuthCodeFromUrl();
    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const cleanedUrl = replaceStateSpy.mock.calls[0][2] as string;
    expect(cleanedUrl).toContain('/pl/app');
  });

  it('preserves other query params when removing authCode', () => {
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/en/app?authCode=tok&role=stylist'),
      writable: true,
      configurable: true,
    });
    scrubAuthCodeFromUrl();
    const cleanedUrl = replaceStateSpy.mock.calls[0][2] as string;
    expect(cleanedUrl).toContain('role=stylist');
    expect(cleanedUrl).not.toContain('authCode');
  });

  it('preserves hash fragment when removing authCode', () => {
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/en/app?authCode=tok#section'),
      writable: true,
      configurable: true,
    });
    scrubAuthCodeFromUrl();
    const cleanedUrl = replaceStateSpy.mock.calls[0][2] as string;
    expect(cleanedUrl).toContain('#section');
    expect(cleanedUrl).not.toContain('authCode');
  });

  it('produces a relative URL (no host) to avoid cross-origin issues', () => {
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/en/app?authCode=tok'),
      writable: true,
      configurable: true,
    });
    scrubAuthCodeFromUrl();
    const cleanedUrl = replaceStateSpy.mock.calls[0][2] as string;
    // Relative URL does not start with http://
    expect(cleanedUrl.startsWith('/')).toBe(true);
    expect(cleanedUrl).not.toContain('http://');
  });

  it('does not throw when replaceState throws (swallows error silently)', () => {
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/en/app?authCode=tok'),
      writable: true,
      configurable: true,
    });
    replaceStateSpy.mockImplementationOnce(() => {
      throw new Error('Security error');
    });
    expect(() => scrubAuthCodeFromUrl()).not.toThrow();
  });

  it('is a no-op on the server (window undefined)', () => {
    const originalWindow = global.window;
    delete (global as { window?: Window }).window;
    expect(() => scrubAuthCodeFromUrl()).not.toThrow();
    global.window = originalWindow;
  });
});

// ---------------------------------------------------------------------------
// scrubRestoredAuthCodeFromUrl
// ---------------------------------------------------------------------------

describe('scrubRestoredAuthCodeFromUrl', () => {
  beforeEach(() => {
    // The „exchange has scrubbed” flag is module state: a fresh module per test.
    vi.resetModules();
  });

  it('leaves the code alone before the exchange has scrubbed it (the exchange still has to read it)', async () => {
    const helpers = await import('./auth-code.helpers');
    setSearch('/app?authCode=abc123');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    helpers.scrubRestoredAuthCodeFromUrl();
    expect(replaceState).not.toHaveBeenCalled();
    expect(helpers.readAuthCodeFromUrl()).toBe('abc123');
    replaceState.mockRestore();
  });

  it('removes a code the router wrote back after the exchange finished', async () => {
    const helpers = await import('./auth-code.helpers');
    // The exchange finished while the address was already clean…
    setSearch('/app?role=stylist');
    helpers.scrubAuthCodeFromUrl();
    // …and then the router's query sync restored the address it read at start.
    setSearch('/app?role=stylist&authCode=abc123');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    helpers.scrubRestoredAuthCodeFromUrl();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(String(replaceState.mock.calls[0]?.[2])).toBe('/app?role=stylist');
    replaceState.mockRestore();
  });
});
