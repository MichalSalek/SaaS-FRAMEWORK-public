// s34 login-CSRF gate: AuthProvider + LoginConfirmGate around the ?authCode
// exchange. The exchange runs through the REAL IO + http interceptor (MSW
// answers exchange-code with an `authorization` header), so these tests prove
// the storage contract end to end: an unconfirmed token never reaches
// localStorage (which a reload or another tab would pick up) and nothing of the
// app mounts until the user confirms the account.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import plCommon from '../../locales/pl/common.json';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import { mswServer } from '../../test-utils/msw/server';

const harness = vi.hoisted(() => ({
  signOut: vi.fn((_opts?: unknown) => Promise.resolve()),
  getSession: vi.fn((_opts?: unknown) =>
    Promise.resolve({ data: { user: { email: 'attacker@example.com' } } })
  ),
  refetch: vi.fn(() => Promise.resolve()),
  replace: vi.fn(),
}));

vi.mock('../../application/auth/better-auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: null,
      isPending: false,
      refetch: harness.refetch,
    }),
    getSession: harness.getSession,
  },
  signOut: harness.signOut,
}));

vi.mock(
  '../../application/error-debugger/errorHandler.possibilities.api',
  async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    reportIssueFrontend: vi.fn(),
  })
);

import { AuthProviderComposition } from './AuthContext.composition';
import { LoginConfirmGateComposition } from '../features/auth/LoginConfirmGate.composition';
import { markLoginStarted } from '../../application/auth/login-confirmation';
import { STORAGE_KEYS } from '../../application/client-device-storage/storage-keys.config';

const TOKEN_KEY = 'authorization';
const NEW_TOKEN = 'attacker-token';
const EXPLICIT_NEW_BEARER = {
  fetchOptions: { auth: { type: 'Bearer', token: NEW_TOKEN } },
};
const CONFIRM = plCommon.components.loginConfirm;
const originalLocation = window.location;
let exchangeHits = 0;

function stubLocation(pathAndQuery: string): void {
  const url = new URL(pathAndQuery, 'https://nailfolio.app');
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      href: url.href,
      origin: url.origin,
      host: url.host,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      replace: harness.replace,
      assign: vi.fn(),
    },
  });
}

function renderApp() {
  return renderWithProviders(
    <AuthProviderComposition>
      <LoginConfirmGateComposition>
        <p>APP CONTENT</p>
      </LoginConfirmGateComposition>
    </AuthProviderComposition>,
    { messages: { components: plCommon.components } }
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  harness.signOut.mockClear();
  harness.getSession.mockClear();
  harness.refetch.mockClear();
  harness.replace.mockClear();
  exchangeHits = 0;
  mswServer.use(
    http.post('*/api/auth/exchange-code', () => {
      exchangeHits += 1;
      return HttpResponse.json(
        { event: 'LOGIN_TOKEN_EXCHANGED', data: null },
        { headers: { authorization: NEW_TOKEN } }
      );
    })
  );
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

describe('AuthProvider login-CSRF gate', () => {
  it('holds a handed-over login (no marker): app not mounted, token NOT in storage until "Tak"', async () => {
    stubLocation('/app?authCode=abc');
    renderApp();

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(CONFIRM.title);
    expect(heading).toHaveTextContent('attacker@example.com');
    expect(harness.getSession).toHaveBeenCalledWith(EXPLICIT_NEW_BEARER);
    expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument();
    // The whole point of the closing-review fix: a reload or another tab
    // reads storage, and storage must not carry the unconfirmed account.
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(harness.refetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: CONFIRM.confirm }));

    expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe(NEW_TOKEN);
    expect(harness.refetch).toHaveBeenCalled();
  });

  it('lets a login started in this browser straight through, exactly as before the gate', async () => {
    stubLocation('/app?authCode=abc');
    markLoginStarted();
    renderApp();

    expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe(NEW_TOKEN);
    expect(localStorage.getItem(STORAGE_KEYS.LOGIN_STARTED_AT)).toBeNull();
    expect(harness.refetch).toHaveBeenCalled();
    expect(harness.getSession).not.toHaveBeenCalled();
  });

  it('asks when a login would replace an existing session, keeping that session in storage', async () => {
    stubLocation('/app?authCode=abc');
    localStorage.setItem(TOKEN_KEY, 'victim-token');
    markLoginStarted();
    renderApp();

    expect(
      await screen.findByRole('button', { name: CONFIRM.reject })
    ).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('victim-token');
  });

  it('"Nie, to nie ja" revokes the new session by explicit Bearer, never touches the previous token, reloads into the app', async () => {
    stubLocation('/en/app/onboarding?authCode=abc');
    localStorage.setItem(TOKEN_KEY, 'victim-token');
    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: CONFIRM.reject })
    );

    await waitFor(() =>
      expect(harness.replace).toHaveBeenCalledWith('/en/app')
    );
    expect(harness.signOut).toHaveBeenCalledWith(EXPLICIT_NEW_BEARER);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('victim-token');
    expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument();
  });

  it('"Nie, to nie ja" without a previous session reloads to login with storage still empty', async () => {
    stubLocation('/app?authCode=abc');
    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: CONFIRM.reject })
    );

    await waitFor(() =>
      expect(harness.replace).toHaveBeenCalledWith('/user/login')
    );
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('reload without an answer: the unconfirmed token is gone, the browser stays in its previous state', async () => {
    stubLocation('/app?authCode=abc');
    localStorage.setItem(TOKEN_KEY, 'victim-token');
    const first = renderApp();
    expect(
      await screen.findByRole('button', { name: CONFIRM.confirm })
    ).toBeInTheDocument();

    // Reload / WebView kill: the document dies, the code was already scrubbed.
    first.unmount();
    stubLocation('/app');
    renderApp();

    expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('victim-token');
    expect(exchangeHits).toBe(1);
  });

  it('renders the app untouched when there is no authCode', async () => {
    stubLocation('/app');
    renderApp();

    expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
    expect(exchangeHits).toBe(0);
  });
});
