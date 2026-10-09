// Contract test: useUsageStats (W0.3 — data-layer characterisation)
// Characterises the PRESENT behaviour of the query: happy-path fetch, correct
// queryKey shape, and that the hook returns data once the server responds.
// Does NOT test retry policy (disabled in makeTestQueryClient) or error UI.
//
// API response envelope: { event: string, data: T }
// The HTTP interceptor reads `response.data.event` and resolves `r.data` (T).
// MSW handlers must return this envelope — not the raw data — so the interceptor
// can extract the event and the toPromise adapter resolves with the inner data.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useUsageStats, usageStatsQueryOptions } from './useUsageStats';
import {
  createQueryWrapper,
  makeTestQueryClient,
} from '../../../../../test-utils/renderWithProviders';
import { mswServer } from '../../../../../test-utils/msw/server';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';

// Inner data payload — minimal shape satisfying the RESPONSE type.
const MOCK_USAGE_STATS_DATA = {
  gallery_records: 3,
  paired_clients: 5,
  hourly_shares: 12,
  favorite_records_count: 2,
  pinned_records: 1,
  favorite_stylists: 0,
  limits: { max_gallery_records: 10, max_paired_clients: 20 },
};

// Full API envelope: { event, data: T } — required by http.interceptor.ts.
const MOCK_USAGE_STATS_RESPONSE = {
  event: 'APPLICATION_SUCCESS',
  data: MOCK_USAGE_STATS_DATA,
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('useUsageStats — contract', () => {
  it('returns inner data after a successful GET /api/v1/user/usage-stats', async () => {
    mswServer.use(
      http.get('*/api/v1/user/usage-stats', () =>
        HttpResponse.json(MOCK_USAGE_STATS_RESPONSE)
      )
    );

    const { result } = renderHook(() => useUsageStats(), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // toPromise resolves with r.data (inner data), not the whole envelope.
    expect(result.current.data).toEqual(MOCK_USAGE_STATS_DATA);
  });

  it('exposes the correct queryKey (SSOT contract)', () => {
    expect(usageStatsQueryOptions.queryKey).toEqual(
      queryKeys.account.usageStats
    );
    // Concrete shape — regression guard for accidental key mutation.
    expect(usageStatsQueryOptions.queryKey).toEqual(['account', 'usageStats']);
  });

  it('surfaces a server error as an error state (no retry)', async () => {
    mswServer.use(
      http.get('*/api/v1/user/usage-stats', () =>
        HttpResponse.json(
          { event: 'USER_NOT_AUTHENTICATED', data: null },
          { status: 401 }
        )
      )
    );

    const qc = makeTestQueryClient();
    const { result } = renderHook(() => useUsageStats(), {
      wrapper: createQueryWrapper(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
