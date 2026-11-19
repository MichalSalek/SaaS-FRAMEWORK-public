import { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { ThemeProviderComposition } from '../UI/styles/ThemeContext.composition';

/**
 * Build a FRESH QueryClient per render/test.
 *
 * CRITICAL (W0.1): never reuse the production `queryClient` singleton — its
 * cache would leak across tests (false pos/neg). `retry: false` keeps tests
 * from waiting through the real retry policy on a mocked error.
 */
export function makeTestQueryClient(
  overrides?: QueryClientConfig
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
    ...overrides,
  });
}

export interface RenderWithProvidersOptions extends Omit<
  RenderOptions,
  'wrapper'
> {
  /** i18n messages for this test. Missing keys fall back to the key (no throw). */
  messages?: AbstractIntlMessages;
  /** Locale for NextIntlClientProvider. Default 'pl'. */
  locale?: string;
  /** Provide a specific QueryClient (e.g. to inspect its cache). Default: fresh. */
  queryClient?: QueryClient;
}

interface AllProvidersProps {
  children: ReactNode;
  messages: AbstractIntlMessages;
  locale: string;
  queryClient: QueryClient;
}

function AllProviders({
  children,
  messages,
  locale,
  queryClient,
}: AllProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProviderComposition>
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
          timeZone='Europe/Warsaw'
          // Tests assert behavior, not copy — missing keys must not throw.
          onError={() => {}}
          getMessageFallback={({ key }) => key}>
          {children}
        </NextIntlClientProvider>
      </ThemeProviderComposition>
    </QueryClientProvider>
  );
}

/**
 * Render a component wrapped in the minimal app provider tree.
 * Auth/Snackbar are deliberately omitted — add per-test when the unit under
 * test needs them (keeps the default tree fast and side-effect free).
 *
 * Returns the RTL result plus the `queryClient` used (for cache assertions).
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {}
) {
  const {
    messages = {},
    locale = 'pl',
    queryClient = makeTestQueryClient(),
    ...renderOptions
  } = options;

  const result = render(ui, {
    wrapper: ({ children }) => (
      <AllProviders
        messages={messages}
        locale={locale}
        queryClient={queryClient}>
        {children}
      </AllProviders>
    ),
    ...renderOptions,
  });

  return { ...result, queryClient };
}

/**
 * Wrapper factory for `renderHook` (data-layer/hook tests, W0.3).
 * Usage:
 *   const { result } = renderHook(() => useUsageStats(), {
 *     wrapper: createQueryWrapper(),
 *   });
 */
export function createQueryWrapper(
  queryClient: QueryClient = makeTestQueryClient()
) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}
