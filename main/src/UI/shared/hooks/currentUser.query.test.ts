// Contract test: currentUser enabled-gate (W0.3 — data-layer characterisation)
//
// CRITICAL regression guard (D1-F5): `useCurrentUserAccount` must NEVER fire
// the GET /session/get-current request when no session token is present in
// client storage. Without the enabled-gate every component mount causes a 401
// round-trip that floods the server and leaks auth intent.
//
// MSW is configured with `onUnhandledRequest: 'error'` (vitest.setup.ts).
// If the query fires without a registered handler the server throws — giving us
// an automatic "query fired when it should not" detector for Test A.
//
// API response envelope: { event: string, data: T }
// Must be returned by MSW handlers (see http.interceptor.ts).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useCurrentUserAccount } from './useCurrentUserAccount';
import { hasSessionToken } from './currentUser.query';
import { createQueryWrapper } from '../../../test-utils/renderWithProviders';
import { mswServer } from '../../../test-utils/msw/server';
import { queryKeys } from '../../../application/http/queryKeys.factory';

// Inner data matching SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE'] (minimal shape).
const MOCK_CURRENT_USER_DATA = {
  id: 'user-123',
  email: 'test@example.com',
  account_type: 'STYLIST',
};

// Full API envelope.
const MOCK_CURRENT_USER_RESPONSE = {
  event: 'APPLICATION_SUCCESS',
  data: MOCK_CURRENT_USER_DATA,
};

// Authorization header key (mirrors CUSTOM_HEADERS.authorization from @kernel).
const AUTH_KEY = 'authorization';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('useCurrentUserAccount — enabled-gate (D1-F5)', () => {
  it('Test A: does NOT fire the request when no token in storage', async () => {
    // No localStorage/sessionStorage token — hasSessionToken() should be false.
    // No MSW handler registered for this endpoint on purpose:
    // if the query fires, MSW throws (onUnhandledRequest: 'error') and the test
    // fails loudly, surfacing the regression.

    expect(hasSessionToken()).toBe(false);

    const { result } = renderHook(() => useCurrentUserAccount(), {
      wrapper: createQueryWrapper(),
    });

    // Give TQ a tick to potentially schedule the fetch.
    await new Promise(resolve => setTimeout(resolve, 50));

    // Query must stay idle — no request, no pending fetch.
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(result.current.isSuccess).toBe(false);
  });

  it('Test B: fires and resolves when token is set in localStorage', async () => {
    // Set the token BEFORE rendering — hasSessionToken() returns true at first
    // render so enabled=true from the start.
    localStorage.setItem(AUTH_KEY, 'test-bearer-token');
    expect(hasSessionToken()).toBe(true);

    mswServer.use(
      http.get('*/api/v1/session/get-current', () =>
        HttpResponse.json(MOCK_CURRENT_USER_RESPONSE)
      )
    );

    const { result } = renderHook(() => useCurrentUserAccount(), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // toPromise resolves with r.data (inner data), not the whole envelope.
    expect(result.current.data).toEqual(MOCK_CURRENT_USER_DATA);
  });

  it('queryKey matches SSOT (regression guard)', () => {
    // currentUserQueryOptions lives in currentUser.query.ts and is spread into
    // useCurrentUserAccount with the enabled override. Verify the key is stable.
    expect(queryKeys.account.current).toEqual(['account', 'current']);
  });
});
