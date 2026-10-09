import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GenericEndpointContext } from 'better-auth';

const h = vi.hoisted(() => ({
  nativeDeeplinkEnabled: false,
  corsOrigins: [] as string[],
  env: {
    FRONTEND_PUBLIC_DOMAIN: 'front.example.test',
    FRONTEND_PUBLIC_PORT: '',
    get NATIVE_DEEPLINK_ENABLED() {
      return h.nativeDeeplinkEnabled;
    },
  },
}));

vi.mock('@app/cors/cors.config', () => ({
  CORS_ALLOWED_ORIGINS: h.corsOrigins,
}));

vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: h.env,
}));

vi.mock('@app/environment/environment.utils.api', () => ({
  IS_DEVELOPMENT_ENV: () => false,
}));

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: {}, useAppLogs: {} },
}));

vi.mock('@app/event-log/event-log.client', () => ({
  writeRawEventLog_IO: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@app/stripe/stripe-sync.operations', () => ({
  syncAccountWithStripe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

import { handleLoginTokenBridge } from './better-auth-hooks';

const makeCtx = (setHeader: ReturnType<typeof vi.fn>) =>
  ({
    path: '/callback/google',
    context: {
      newSession: {
        session: { token: 't' },
        user: { id: 'u' },
      },
      responseHeaders: new Headers({
        location: 'https://api.example.test/de/app?nativeAuth=1',
      }),
      internalAdapter: {
        createVerificationValue: vi.fn(
          async (d: { identifier: string; value: string; expiresAt: Date }) => d
        ),
      },
    },
    setHeader,
  }) as unknown as GenericEndpointContext;

describe('handleLoginTokenBridge', () => {
  beforeEach(() => {
    h.nativeDeeplinkEnabled = false;
  });

  it('NATIVE_DEEPLINK_ENABLED true → nailfolio://de/app?authCode=…', async () => {
    h.nativeDeeplinkEnabled = true;
    const setHeader = vi.fn();
    await handleLoginTokenBridge(makeCtx(setHeader));

    expect(setHeader).toHaveBeenCalledWith(
      'location',
      expect.stringMatching(/^nailfolio:\/\/de\/app\?authCode=/)
    );
  });

  it('NATIVE_DEEPLINK_ENABLED false → https frontend /de/app?authCode=…', async () => {
    h.nativeDeeplinkEnabled = false;
    const setHeader = vi.fn();
    await handleLoginTokenBridge(makeCtx(setHeader));

    expect(setHeader).toHaveBeenCalledTimes(1);
    const location = setHeader.mock.calls[0]?.[1];
    expect(typeof location).toBe('string');
    const parsed = new URL(String(location));
    expect(parsed.protocol).toBe('https:');
    expect(parsed.pathname).toBe('/de/app');
    expect(parsed.searchParams.get('authCode')).toBeTruthy();
  });
});
