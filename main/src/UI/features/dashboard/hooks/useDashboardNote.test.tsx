// Contract test: useDashboardNote — defer-gate (W0.3 — data-layer characterisation)
//
// CHARACTERISATION: the hook intentionally waits ~1 000ms (DEFER_MS) before
// enabling the query. This prevents a waterfall of dashboard requests on first
// paint while critical data is still loading. Protecting this behaviour ensures
// the defer is never accidentally removed by a "simplification" refactor.
//
// Test strategy:
//   - Fake timers (vi.useFakeTimers) so we don't wait a real second.
//   - Assert query stays idle immediately after mount.
//   - Advance time past DEFER_MS → await the query to resolve.
//
// useDashboardNote uses useTranslations (next-intl) so we need a wrapper that
// includes NextIntlClientProvider.
//
// API response envelope: { event: string, data: T } — required by interceptor.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { useDashboardNote } from './useDashboardNote';
import { makeTestQueryClient } from '../../../../test-utils/renderWithProviders';
import { mswServer } from '../../../../test-utils/msw/server';
import { AccountTypeValue } from '../../../../READONLY-shared-kernel/models/db_models.generated.dto';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

// DEFER_MS = 1_000 ms — must match hook constant (see comment at top of file)

// Inner data payload.
const MOCK_NOTE_DATA = {
  stylist_note: 'Pamiętaj o zamówieniu lakierów',
  client_note: null,
};

// Full API envelope.
const MOCK_NOTE_RESPONSE = {
  event: 'APPLICATION_SUCCESS',
  data: MOCK_NOTE_DATA,
};

// Minimal wrapper: QueryClient + NextIntl (needed by useTranslations).
// ThemeProvider deliberately omitted — hook does not render any UI.
function buildWrapper(qc: QueryClient) {
  return function DeferTestWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider
          locale='pl'
          messages={{}}
          timeZone='Europe/Warsaw'
          onError={() => {}}
          getMessageFallback={({ key }) => key}>
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  // Ensure real timers are always restored — tests that call vi.useFakeTimers()
  // restore via vi.useRealTimers() in the body, but afterEach is a safety net.
  vi.useRealTimers();
});

describe('useDashboardNote — defer-gate (DEFER_MS = 1 000 ms)', () => {
  it('query stays idle immediately after mount — defer not expired', async () => {
    // Use fake timers so the DEFER_MS setTimeout never fires during this test.
    // No MSW handler registered — if the query fires, MSW throws (onUnhandledRequest: 'error').
    vi.useFakeTimers();

    const qc = makeTestQueryClient();
    const { result } = renderHook(
      () => useDashboardNote(AccountTypeValue.STYLIST),
      { wrapper: buildWrapper(qc) }
    );

    // At t=0 the ready flag is false → enabled: false.
    // TQ may create a "disabled-pending" cache entry but fetchStatus must be 'idle'.
    const queryState = qc.getQueryState(queryKeys.account.dashboardNote);
    const fetchStatus = queryState?.fetchStatus;
    // Either no entry yet (undefined) or an idle-disabled entry.
    expect(fetchStatus === undefined || fetchStatus === 'idle').toBe(true);

    // The hook's own isLoading must be true (ready=false forces isLoading=true).
    expect(result.current.isLoading).toBe(true);
    expect(result.current.note).toBeNull();

    // Restore immediately so afterEach cleanup works correctly.
    vi.useRealTimers();
  });

  it('fires the query after DEFER_MS and resolves data for STYLIST account type', async () => {
    mswServer.use(
      http.get('*/api/v1/account/get-dashboard-note', () =>
        HttpResponse.json(MOCK_NOTE_RESPONSE)
      )
    );

    const qc = makeTestQueryClient();
    const { result } = renderHook(
      () => useDashboardNote(AccountTypeValue.STYLIST),
      { wrapper: buildWrapper(qc) }
    );

    // Before timer fires the query must remain disabled.
    expect(result.current.isLoading).toBe(true);

    // Restore real timers first so the MSW network path and TQ internals work.
    // Then manually wait for DEFER_MS using real setTimeout — this keeps React
    // state updates and async fetches in the normal event loop.
    vi.useRealTimers();

    // Advance real time past DEFER_MS by waiting longer than the defer.
    // Note: DEFER_MS = 1000ms. We use a shorter poll with waitFor instead.
    // The hook uses setTimeout(DEFER_MS) — we let that real timer fire by
    // waiting in waitFor until ready=true triggers the fetch to complete.
    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.note).toBe(MOCK_NOTE_DATA.stylist_note);
      },
      { timeout: 3_000 }
    );
  });

  it('returns client_note for CLIENT account type', async () => {
    mswServer.use(
      http.get('*/api/v1/account/get-dashboard-note', () =>
        HttpResponse.json(MOCK_NOTE_RESPONSE)
      )
    );

    const qc = makeTestQueryClient();
    const { result } = renderHook(
      () => useDashboardNote(AccountTypeValue.CLIENT),
      { wrapper: buildWrapper(qc) }
    );

    vi.useRealTimers();

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false);
        // client_note is null in MOCK — verifies correct field selection.
        expect(result.current.note).toBeNull();
      },
      { timeout: 3_000 }
    );
  });

  it('reports loadFailed (not an empty note) when the read fails with nothing cached', async () => {
    mswServer.use(
      http.get('*/api/v1/account/get-dashboard-note', () =>
        HttpResponse.json(
          { event: 'GENERAL_ERROR', data: null },
          { status: 500 }
        )
      )
    );

    const qc = makeTestQueryClient();
    const { result } = renderHook(
      () => useDashboardNote(AccountTypeValue.STYLIST),
      { wrapper: buildWrapper(qc) }
    );

    expect(result.current.loadFailed).toBe(false);

    await waitFor(
      () => {
        expect(result.current.loadFailed).toBe(true);
      },
      { timeout: 3_000 }
    );
    // `note` stays null, which the organism must treat as UNKNOWN.
    expect(result.current.note).toBeNull();
  });

  it('keeps loadFailed false when a note is cached even if a refetch fails', async () => {
    mswServer.use(
      http.get('*/api/v1/account/get-dashboard-note', () =>
        HttpResponse.json(
          { event: 'GENERAL_ERROR', data: null },
          { status: 500 }
        )
      )
    );

    const qc = makeTestQueryClient();
    // updatedAt 0 = stale, so the hook refetches once the defer expires.
    qc.setQueryData(queryKeys.account.dashboardNote, MOCK_NOTE_DATA, {
      updatedAt: 0,
    });
    const { result } = renderHook(
      () => useDashboardNote(AccountTypeValue.STYLIST),
      { wrapper: buildWrapper(qc) }
    );

    await waitFor(
      () => {
        expect(qc.getQueryState(queryKeys.account.dashboardNote)?.status).toBe(
          'error'
        );
      },
      { timeout: 3_000 }
    );
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.note).toBe(MOCK_NOTE_DATA.stylist_note);
  });

  it('queryKey matches SSOT (regression guard)', () => {
    expect(queryKeys.account.dashboardNote).toEqual([
      'account',
      'dashboardNote',
    ]);
  });
});
