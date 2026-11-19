import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deeplinkHarness = vi.hoisted(() => {
  let inboundHandler: ((event: { url: string }) => void) | undefined;
  return {
    getHandler: (): ((event: { url: string }) => void) | undefined =>
      inboundHandler,
    reset: (): void => {
      inboundHandler = undefined;
    },
    App: {
      addListener: vi.fn(
        (_event: string, cb: (event: { url: string }) => void) => {
          inboundHandler = cb;
          return Promise.resolve({ remove: vi.fn() });
        }
      ),
    },
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: (): boolean => true,
  },
}));

vi.mock('@capacitor/app', () => ({
  App: deeplinkHarness.App,
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    close: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../error-debugger/errorHandler.possibilities.api', () => ({
  reportIssueFrontend: vi.fn(),
}));

const assignSpy = vi.fn();

function stubLocation(): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      href: 'https://nailfolio.app/app',
      origin: 'https://nailfolio.app',
      host: 'nailfolio.app',
      hostname: 'nailfolio.app',
      protocol: 'https:',
      pathname: '/app',
      search: '',
      hash: '',
      assign: assignSpy,
    },
  });
}

describe('initNativeLoginDeepLinkListener — D6 locale-aware landing', () => {
  beforeEach(async () => {
    vi.resetModules();
    deeplinkHarness.reset();
    deeplinkHarness.App.addListener.mockClear();
    assignSpy.mockReset();
    stubLocation();
    window.sessionStorage.clear();
    const { initNativeLoginDeepLinkListener } =
      await import('./native-deeplink-listener');
    await initNativeLoginDeepLinkListener();
  });

  afterEach(() => {
    assignSpy.mockReset();
  });

  function fireInbound(url: string): void {
    const handler = deeplinkHarness.getHandler();
    expect(handler).toBeDefined();
    handler?.({ url });
  }

  it('maps nailfolio://en/app?authCode=abc onto /en/app?authCode=abc', () => {
    fireInbound('nailfolio://en/app?authCode=abc');
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(String(assignSpy.mock.calls[0]?.[0])).toContain(
      '/en/app?authCode=abc'
    );
  });

  it('opens a same-origin lifecycle link in the warm native app without dropping opaque markers', () => {
    fireInbound(
      'https://nailfolio.app/en/app/gallery?nf_message=11111111-1111-4111-8111-111111111111&nf_cta=primary'
    );
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(String(assignSpy.mock.calls[0]?.[0])).toContain('nf_cta=primary');
  });

  it('rejects lifecycle links to a foreign origin or a path outside the app', () => {
    fireInbound(
      'https://foreign.example/app?nf_message=11111111-1111-4111-8111-111111111111&nf_cta=primary'
    );
    fireInbound(
      'https://nailfolio.app/en/apple?nf_message=11111111-1111-4111-8111-111111111111&nf_cta=primary'
    );
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('opens a plain e-mail link to an app screen (support reply CTA) in the warm native app', () => {
    fireInbound(
      'https://nailfolio.app/app/user/support/cmthread123?utm_source=email&utm_medium=transactional'
    );
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(String(assignSpy.mock.calls[0]?.[0])).toContain(
      '/app/user/support/cmthread123'
    );
  });

  it('refuses a plain https link that carries a token outside the login paths', () => {
    fireInbound('https://nailfolio.app/app/user/support/x?token=abc');
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('does not assign nailfolio://apple?authCode=abc', () => {
    fireInbound('nailfolio://apple?authCode=abc');
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('assigns a same-origin https /de/app landing with authCode', () => {
    fireInbound('https://nailfolio.app/de/app/onboarding?authCode=x');
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(String(assignSpy.mock.calls[0]?.[0])).toContain(
      '/de/app/onboarding?authCode=x'
    );
  });

  it('does not assign https://nailfolio.app/en/apple?authCode=x', () => {
    fireInbound('https://nailfolio.app/en/apple?authCode=x');
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
