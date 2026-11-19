/**
 * Failed-login audit (CANNOT_LOGIN): contract test on `ctx.context.returned`.
 *
 * WHY THIS FILE EXISTS: `ctx.context.returned` could disappear from the library and this path
 * would die SILENTLY. The test runs on the REAL `APIError` class from `better-auth/api` (not a
 * mock), because the point is the `isAPIError` discrimination: a mock would only prove that the
 * mock matches our own regex. The other half of the contract, the assignment existing in the
 * library runtime, is guarded by `audit:better-auth-contract`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GenericEndpointContext } from 'better-auth';
import { APIError } from 'better-auth/api';

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  writeRawEventLog: vi.fn(),
  reportIssue: vi.fn(),
}));

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { user: { findUnique: h.findUnique } } },
}));
vi.mock('@app/event-log/event-log.client', () => ({
  writeRawEventLog_IO: h.writeRawEventLog,
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: h.reportIssue,
}));
vi.mock('@app/http/extract-client-info', () => ({
  extractIpFromFetchHeaders: () => '203.0.113.9',
}));

import {
  classifyBrowser,
  handleAuthFailure,
  readOAuthCallbackDiagnostics,
} from './better-auth-failure-tracking';

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const makeCtx = (
  path: string,
  returned: unknown,
  body?: Record<string, unknown>
): GenericEndpointContext =>
  ({
    path,
    body,
    headers: new Headers({ 'user-agent': 'vitest', 'accept-language': 'pl' }),
    context: { returned },
  }) as unknown as GenericEndpointContext;

describe('handleAuthFailure — kontrakt ctx.context.returned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.findUnique.mockResolvedValue({ id: 'user-1' });
    h.writeRawEventLog.mockResolvedValue(undefined);
  });

  it('zapisuje CANNOT_LOGIN dla rzuconego APIError (złe hasło)', async () => {
    handleAuthFailure(
      makeCtx(
        '/sign-in/email',
        new APIError('UNAUTHORIZED', { code: 'INVALID_EMAIL_OR_PASSWORD' }),
        { email: 'ofiara@example.test' }
      )
    );
    await flush();

    expect(h.writeRawEventLog).toHaveBeenCalledTimes(1);
    const payload = h.writeRawEventLog.mock.calls[0]?.[0] as {
      eventPayloadToStringify?: Record<string, unknown>;
    };
    expect(payload.eventPayloadToStringify).toMatchObject({
      reason_code: 'INVALID_EMAIL_OR_PASSWORD',
      status_code: 401,
    });
  });

  it('sygnalizuje nieudany redirect 302 z ?error= (magic-link verify, e-mail nieznany)', async () => {
    // The real shape Better Auth 1.7 builds for a used link sent with a
    // RELATIVE errorCallbackURL: resolved against its OWN baseURL (the API
    // origin). The error carries that Location; the origin net in
    // auth-redirect-targets.ts rewrites only the response header, so this audit
    // still reads the code from here. An absolute front URL in this fixture hid
    // the API-origin dead end for months (owner report).
    handleAuthFailure(
      makeCtx(
        '/magic-link/verify',
        new APIError(
          'FOUND',
          {},
          { location: 'https://api.front.test/user/login?error=INVALID_TOKEN' }
        )
      )
    );
    await flush();

    // Magic-link verify carries no body, so the e-mail is unknown, and EventLog has an FK
    // to the user: the signal then goes to the tracker, not the table. This is the
    // DOCUMENTED behaviour (DECISION in the source file), not a lost case.
    expect(h.writeRawEventLog).not.toHaveBeenCalled();
    expect(h.reportIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'BA_HOOK_CANNOT_LOGIN',
        payload: expect.objectContaining({ reasonCode: 'INVALID_TOKEN' }),
      })
    );
  });

  it('MILCZY na redirekcie 302 BEZ ?error= — to jest udany login', async () => {
    handleAuthFailure(
      makeCtx(
        '/callback/google',
        new APIError('FOUND', {}, { location: 'https://front.test/app' })
      )
    );
    await flush();

    expect(h.writeRawEventLog).not.toHaveBeenCalled();
  });

  it('MILCZY, gdy returned nie jest APIError (ścieżka sukcesu, ciało JSON)', async () => {
    handleAuthFailure(
      makeCtx('/sign-in/email', { token: 'abc', user: { id: 'u' } })
    );
    await flush();

    expect(h.writeRawEventLog).not.toHaveBeenCalled();
  });

  /**
   * THIS IS THE TEST. The scenario that once justified pinning the version:
   * when the library stops setting `returned`, the function gets `undefined`.
   * We check that such a run is INDISTINGUISHABLE from silence, i.e. the code
   * itself cannot notice it and the only defence is the runtime guard.
   */
  it('cicho nie robi nic, gdy returned zniknie — dlatego kontraktu pilnuje strażnik, nie test', async () => {
    handleAuthFailure(
      makeCtx('/sign-in/email', undefined, {
        email: 'ofiara@example.test',
      })
    );
    await flush();

    expect(h.writeRawEventLog).not.toHaveBeenCalled();
    expect(h.reportIssue).not.toHaveBeenCalled();
  });

  it('nie dotyka ścieżek spoza logowania', async () => {
    handleAuthFailure(
      makeCtx('/get-session', new APIError('UNAUTHORIZED', { code: 'X' }))
    );
    await flush();

    expect(h.writeRawEventLog).not.toHaveBeenCalled();
  });
});

describe('OAuth callback diagnostics (state_mismatch explainability)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a callback without the state cookie says so, with the arrival and browser class', async () => {
    const ctx = {
      path: '/callback/google',
      headers: new Headers({
        'user-agent':
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
        'sec-fetch-site': 'cross-site',
        cookie: 'other=1',
      }),
      context: {
        returned: new APIError(
          'FOUND',
          {},
          {
            location: 'https://api.front.test/user/login?error=state_mismatch',
          }
        ),
      },
    } as unknown as GenericEndpointContext;
    handleAuthFailure(ctx);
    await flush();

    expect(h.reportIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'BA_HOOK_CANNOT_LOGIN',
        payload: expect.objectContaining({
          reasonCode: 'STATE_MISMATCH',
          oauth: {
            hasStateCookie: false,
            hasAnyCookie: true,
            secFetchSite: 'cross-site',
            browserClass: 'chrome',
          },
        }),
      })
    );
  });

  it('recognises the state cookie under both prefixes', () => {
    for (const cookie of [
      'better-auth.state=abc.sig',
      'x=1; __Secure-better-auth.state=abc.sig',
      'better-auth.oauth_state=enc',
    ]) {
      expect(
        readOAuthCallbackDiagnostics(new Headers({ cookie }), null)
          .hasStateCookie
      ).toBe(true);
    }
    expect(
      readOAuthCallbackDiagnostics(
        new Headers({ cookie: 'better-auth.session_token=x' }),
        null
      ).hasStateCookie
    ).toBe(false);
  });

  it('classifies the browsers that matter for a lost state cookie', () => {
    expect(
      classifyBrowser(
        'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'
      )
    ).toBe('android-webview');
    expect(
      classifyBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0'
      )
    ).toBe('in-app');
    expect(
      classifyBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
      )
    ).toBe('ios-webview');
    expect(
      classifyBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe('safari');
    expect(classifyBrowser(null)).toBe('unknown');
  });
});
