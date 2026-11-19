// The app survives a page that arrives without its messages (incident
// 2026-10-21: a cached prefetch `{}` left `pageProps.messages` undefined; the
// toast controller threw and the error screen printed `errors.unexpectedError`).

import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlError, IntlErrorCode } from 'next-intl';
import type * as EnvironmentApi from '../../../application/environment/environment.possibilities.api';

const report = vi.hoisted(() => vi.fn());
vi.mock(
  '../../../application/error-debugger/errorHandler.possibilities.api',
  () => ({
    reportIssueFrontend: report,
  })
);

const env = vi.hoisted(() => ({ development: true, devRoutes: true }));
vi.mock(
  '../../../application/environment/environment.possibilities.api',
  async importOriginal => {
    const actual = await importOriginal<typeof EnvironmentApi>();
    return {
      ...actual,
      IS_DEVELOPMENT_ENV: () => env.development,
      ARE_DEV_ROUTES_ENABLED: () => env.devRoutes,
    };
  }
);

import { ContactMessagesProviderComposition } from './ContactMessagesProvider.composition';
import { AppSnackbarsController } from '../../../application/app-snackbar/sonner-adapter/AppSnackbars.controller';
import { ErrorBoundaryComposition } from '../../components/ErrorBoundary.composition';
import { useErrorBoundaryCopy } from '../../components/useErrorBoundaryCopy';
import { makeTestQueryClient } from '../../../test-utils/renderWithProviders';
import {
  MISSING_MESSAGES_RELOAD_TTL_MS,
  recoverFromMissingMessages,
} from '../../../application/i18n/missing-messages-recovery';
import {
  getIntlMessageFallback,
  handleIntlError,
  resetReportedIntlErrors,
} from '../../../application/i18n/intl-error-handling';

/** The same boundary shape `_app` and the layouts mount. */
function Boundary({ children }: { children: ReactNode }) {
  const copy = useErrorBoundaryCopy();
  return (
    <ErrorBoundaryComposition
      fallbackTitle={copy.title}
      fallbackAction={copy.action}
      fallbackHomeAction={copy.home}>
      {children}
    </ErrorBoundaryComposition>
  );
}

function Boom(): never {
  throw new Error('render failure');
}

const renderApp = (
  messages: Record<string, unknown> | undefined,
  locale: string,
  child: ReactNode
) =>
  render(
    <QueryClientProvider client={makeTestQueryClient()}>
      <ContactMessagesProviderComposition
        locale={locale}
        messages={messages as never}
        timeZone='Europe/Warsaw'>
        <Boundary>
          {child}
          <AppSnackbarsController />
        </Boundary>
      </ContactMessagesProviderComposition>
    </QueryClientProvider>
  );

describe('app tree without messages', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['undefined', undefined],
    ['empty', {}],
  ])('renders the page when messages are %s', (_label, messages) => {
    renderApp(messages, 'pl', <p>treść strony</p>);
    expect(screen.getByText('treść strony')).toBeTruthy();
    expect(screen.queryByText(/errors\./)).toBeNull();
  });

  it.each([
    ['pl', 'Coś poszło nie tak', 'Spróbuj ponownie'],
    ['en', 'Something went wrong', 'Try again'],
    ['de', 'Etwas ist schiefgelaufen', 'Erneut versuchen'],
  ])(
    'the error fallback speaks %s and never prints a key path',
    (locale, title, action) => {
      const { container } = renderApp(undefined, locale, <Boom />);
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.getByText(action)).toBeTruthy();
      expect(container.textContent).not.toMatch(/errors\./);
    }
  );

  it('the fallback uses the real messages when they are there', () => {
    renderApp(
      { errors: { unexpectedError: 'Z pliku', tryAgain: 'Jeszcze raz' } },
      'pl',
      <Boom />
    );
    expect(screen.getByText('Z pliku')).toBeTruthy();
    expect(screen.getByText('Jeszcze raz')).toBeTruthy();
    // backToHome is absent from these messages: the table fills it in.
    expect(screen.getByText('Wróć na stronę główną')).toBeTruthy();
  });
});

describe('recoverFromMissingMessages', () => {
  beforeEach(() => {
    sessionStorage.clear();
    report.mockClear();
  });

  it('reloads once per URL inside the TTL and reports both outcomes', () => {
    const reload = vi.fn();
    const url = 'https://nailfolio.app/app/photo/1/';
    expect(
      recoverFromMissingMessages({
        url,
        route: '/app/photo/[id]',
        now: 1000,
        reload,
      })
    ).toBe('reloaded');
    expect(
      recoverFromMissingMessages({
        url,
        route: '/app/photo/[id]',
        now: 2000,
        reload,
      })
    ).toBe('suppressed');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls.every(([call]) => call.namespace === 'I18N')).toBe(
      true
    );
  });

  it('reloads again for another URL or after the TTL', () => {
    const reload = vi.fn();
    recoverFromMissingMessages({ url: 'a', route: 'r', now: 0, reload });
    recoverFromMissingMessages({ url: 'b', route: 'r', now: 1, reload });
    recoverFromMissingMessages({
      url: 'b',
      route: 'r',
      now: 2 + MISSING_MESSAGES_RELOAD_TTL_MS,
      reload,
    });
    expect(reload).toHaveBeenCalledTimes(3);
  });
});

describe('next-intl error handling', () => {
  const missing = new IntlError(
    IntlErrorCode.MISSING_MESSAGE,
    'Could not resolve `pages.x.title`'
  );

  beforeEach(() => {
    report.mockClear();
    resetReportedIntlErrors();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    env.development = true;
    env.devRoutes = true;
    vi.restoreAllMocks();
  });

  it('development shows the key path', () => {
    expect(
      getIntlMessageFallback({
        namespace: 'pages.x',
        key: 'title',
        error: missing,
      })
    ).toBe('pages.x.title');
  });

  it('production renders a blank and reports each problem once per page load', () => {
    env.development = false;
    env.devRoutes = false;
    expect(
      getIntlMessageFallback({
        namespace: 'pages.x',
        key: 'title',
        error: missing,
      })
    ).toBe('');
    handleIntlError(missing);
    handleIntlError(missing);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({
      namespace: 'I18N',
      mode: 'error',
    });
  });
});
