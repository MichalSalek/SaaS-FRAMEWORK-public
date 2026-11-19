/**
 * The API origin is never a landing page (owner report: Google
 * sign-in ended on https://api.example.com/user/login?error=state_mismatch).
 *
 * These tests run the REAL Better Auth handler (memory adapter, real magic-link
 * plugin, real Google provider config) with our two hook functions wired the
 * way better-auth.config.ts wires them, and read the Location the browser would
 * follow. A unit test on hand-built contexts would only prove our own
 * assumptions about the library; the bug lived in the library's resolution of
 * relative URLs against its baseURL.
 */
import { describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuthMiddleware } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins';

const FRONT = 'https://front.example.test';
const API = 'https://api.example.test';

vi.mock('@app/cors/cors.config', () => ({
  CORS_ALLOWED_ORIGINS: [
    'http://front.example.test',
    'https://front.example.test',
    'front.example.test',
  ],
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: {
    FRONTEND_PUBLIC_DOMAIN: 'front.example.test',
    FRONTEND_PUBLIC_PORT: '',
  },
}));
vi.mock('@app/environment/environment.utils.api', () => ({
  IS_DEVELOPMENT_ENV: () => false,
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

import {
  absolutizeRedirectTarget,
  normalizeAuthRedirectTargets,
  pinFailedRedirectToFrontend,
  resolveRequestFrontendOrigin,
} from './auth-redirect-targets';

type Layers = { before: boolean; after: boolean };

const buildAuth = (layers: Layers) => {
  const sent: string[] = [];
  const auth = betterAuth({
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    secret: 'test-secret-test-secret-test-secret-0123456789',
    baseURL: API,
    trustedOrigins: [FRONT],
    // Better Auth turns its origin check OFF under NODE_ENV=test; production
    // runs with it, and the hooks must work together with it.
    advanced: { disableOriginCheck: false },
    socialProviders: {
      google: { clientId: 'cid', clientSecret: 'csecret' },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ url }) => {
          sent.push(url);
        },
      }),
    ],
    hooks: {
      ...(layers.before
        ? {
            before: createAuthMiddleware(
              async ctx => normalizeAuthRedirectTargets(ctx) ?? undefined
            ),
          }
        : {}),
      ...(layers.after
        ? {
            after: createAuthMiddleware(async ctx => {
              pinFailedRedirectToFrontend(ctx);
            }),
          }
        : {}),
    },
  });
  return { auth, sent };
};

const post = (path: string, body: unknown) =>
  new Request(`${API}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: FRONT },
    body: JSON.stringify(body),
  });

const followLocation = (res: Response): URL => {
  const location = res.headers.get('location');
  expect(location, `status ${res.status}`).toBeTruthy();
  return new URL(location ?? '');
};

const BOTH: Layers = { before: true, after: true };

describe('magic link: a used or unknown link returns to the FRONT login', () => {
  it('relative targets from an old bundle: verify lands on the front with from intact', async () => {
    const { auth, sent } = buildAuth(BOTH);
    const res = await auth.handler(
      post('/sign-in/magic-link', {
        email: 'a@example.test',
        callbackURL: '/app/user/support/abc',
        errorCallbackURL: `/user/login?from=${encodeURIComponent('/app/x?y=1&z=2')}`,
      })
    );
    expect(res.status).toBe(200);
    const emailed = new URL(sent[0] ?? '');
    // The e-mail already carries absolute front targets.
    expect(emailed.searchParams.get('callbackURL')).toBe(
      `${FRONT}/app/user/support/abc`
    );

    emailed.searchParams.set('token', 'not-a-real-token');
    const verify = await auth.handler(new Request(emailed.toString()));
    expect(verify.status).toBe(302);
    const landing = followLocation(verify);
    expect(landing.origin).toBe(FRONT);
    expect(landing.pathname).toBe('/user/login');
    expect(landing.searchParams.get('error')).toBe('INVALID_TOKEN');
    // The `&` inside `from` survives the plugin's double decode.
    expect(landing.searchParams.get('from')).toBe('/app/x?y=1&z=2');
  });

  it('absolute targets from the current front pass through unchanged', async () => {
    const { auth, sent } = buildAuth(BOTH);
    await auth.handler(
      post('/sign-in/magic-link', {
        email: 'a@example.test',
        callbackURL: `${FRONT}/en/app`,
        errorCallbackURL: `${FRONT}/en/user/login/?from=${encodeURIComponent('/app/a?b=1&c=2')}`,
      })
    );
    const emailed = new URL(sent[0] ?? '');
    emailed.searchParams.set('token', 'nope');
    const landing = followLocation(
      await auth.handler(new Request(emailed.toString()))
    );
    expect(landing.origin).toBe(FRONT);
    expect(landing.pathname).toBe('/en/user/login/');
    expect(landing.searchParams.get('from')).toBe('/app/a?b=1&c=2');
  });

  it('an e-mail sent before the fix (relative query) still lands on the front', async () => {
    const { auth } = buildAuth(BOTH);
    const url = new URL(`${API}/api/auth/magic-link/verify`);
    url.searchParams.set('token', 'old');
    url.searchParams.set('callbackURL', '/app');
    url.searchParams.set('errorCallbackURL', '/user/login');
    const landing = followLocation(
      await auth.handler(new Request(url.toString()))
    );
    expect(landing.origin).toBe(FRONT);
    expect(landing.pathname).toBe('/user/login');
  });

  it('without our hooks the library really sends her to the API origin (the bug)', async () => {
    const { auth } = buildAuth({ before: false, after: false });
    const url = new URL(`${API}/api/auth/magic-link/verify`);
    url.searchParams.set('token', 'old');
    url.searchParams.set('callbackURL', '/app');
    url.searchParams.set('errorCallbackURL', '/user/login');
    const landing = followLocation(
      await auth.handler(new Request(url.toString()))
    );
    expect(landing.origin).toBe(API);
  });
});

const startGoogle = async (
  auth: ReturnType<typeof buildAuth>['auth'],
  errorCallbackURL: string
): Promise<string> => {
  const res = await auth.handler(
    post('/sign-in/social', {
      provider: 'google',
      callbackURL: '/app',
      errorCallbackURL,
      disableRedirect: true,
    })
  );
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  const state = new URL(url).searchParams.get('state');
  expect(state).toBeTruthy();
  return state ?? '';
};

// The callback arrives in a browser WITHOUT the state cookie: the owner's
// case (a mail app's in-app browser, or a cookie past its lifetime).
const callbackWithoutCookie = (state: string) =>
  new Request(
    `${API}/api/auth/callback/google?state=${encodeURIComponent(state)}&code=x`
  );

describe('Google: state mismatch returns to the FRONT login', () => {
  it('relative errorCallbackURL (cached bundle): front host, from kept', async () => {
    const { auth } = buildAuth(BOTH);
    const state = await startGoogle(
      auth,
      `/user/login?from=${encodeURIComponent('/app/user/support/abc')}`
    );
    const landing = followLocation(
      await auth.handler(callbackWithoutCookie(state))
    );
    expect(landing.origin).toBe(FRONT);
    expect(landing.pathname).toBe('/user/login');
    expect(landing.searchParams.get('error')).toBe('state_mismatch');
    expect(landing.searchParams.get('from')).toBe('/app/user/support/abc');
  });

  it('the before-hook alone stores an absolute error URL in the state', async () => {
    const { auth } = buildAuth({ before: true, after: false });
    const state = await startGoogle(auth, '/user/login');
    const landing = followLocation(
      await auth.handler(callbackWithoutCookie(state))
    );
    expect(landing.origin).toBe(FRONT);
  });

  it('the after-net alone repairs a state stored before the deploy', async () => {
    const { auth } = buildAuth({ before: false, after: true });
    const state = await startGoogle(auth, '/user/login');
    const landing = followLocation(
      await auth.handler(callbackWithoutCookie(state))
    );
    expect(landing.origin).toBe(FRONT);
    expect(landing.searchParams.get('error')).toBe('state_mismatch');
  });

  it('an open-redirect target is still refused by Better Auth', async () => {
    const { auth } = buildAuth(BOTH);
    const res = await auth.handler(
      post('/sign-in/social', {
        provider: 'google',
        callbackURL: '/app',
        errorCallbackURL: '//evil.example/x',
        disableRedirect: true,
      })
    );
    expect(res.status).toBe(403);
  });
});

describe('helpers', () => {
  it('absolutizes only safe relative paths', () => {
    expect(absolutizeRedirectTarget('/app?x=1', FRONT)).toBe(
      `${FRONT}/app?x=1`
    );
    expect(absolutizeRedirectTarget('//evil.example', FRONT)).toBe(
      '//evil.example'
    );
    expect(absolutizeRedirectTarget('/\\evil.example', FRONT)).toBe(
      '/\\evil.example'
    );
    expect(absolutizeRedirectTarget(`${FRONT}/app`, FRONT)).toBe(
      `${FRONT}/app`
    );
  });

  it('takes the request origin only when it is a front origin', () => {
    expect(resolveRequestFrontendOrigin(new Headers({ origin: FRONT }))).toBe(
      FRONT
    );
    expect(
      resolveRequestFrontendOrigin(
        new Headers({ origin: 'https://evil.example' })
      )
    ).toBe(FRONT);
    expect(resolveRequestFrontendOrigin(undefined)).toBe(FRONT);
  });
});
