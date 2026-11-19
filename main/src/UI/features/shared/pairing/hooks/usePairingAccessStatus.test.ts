// usePairingAccessStatus.test.ts
// A failed check falls back to the PUBLIC answer (isChecked, so CTAs do not
// hang), and `checkFailed` is what tells callers that fallback is a guess.

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  makeTestQueryClient,
  createQueryWrapper,
} from '../../../../../test-utils/renderWithProviders';
import { mswServer } from '../../../../../test-utils/msw/server';
import { usePairingAccessStatus } from './usePairingAccessStatus';

const ACCESS_URL = '*/api/v1/pairing/get-access-status';

describe('usePairingAccessStatus', () => {
  it('marks a failed check with no earlier answer as checkFailed', async () => {
    mswServer.use(
      http.get(ACCESS_URL, () =>
        HttpResponse.json(
          { event: 'GENERAL_ERROR', data: null },
          { status: 500 }
        )
      )
    );

    const { result } = renderHook(
      () => usePairingAccessStatus('stylist-1', true),
      { wrapper: createQueryWrapper(makeTestQueryClient()) }
    );

    await waitFor(() => expect(result.current.checkFailed).toBe(true));
    expect(result.current.isChecked).toBe(true);
    expect(result.current.isPaired).toBe(false);
  });

  it('does not flag a successful check or a disabled one', async () => {
    mswServer.use(
      http.get(ACCESS_URL, () =>
        HttpResponse.json({
          event: 'APPLICATION_SUCCESS',
          data: { access: 'PAIRED', pair_id: 'pair-1' },
        })
      )
    );

    const { result } = renderHook(
      () => usePairingAccessStatus('stylist-1', true),
      { wrapper: createQueryWrapper(makeTestQueryClient()) }
    );
    await waitFor(() => expect(result.current.isPaired).toBe(true));
    expect(result.current.checkFailed).toBe(false);

    const disabled = renderHook(
      () => usePairingAccessStatus('stylist-1', false),
      { wrapper: createQueryWrapper(makeTestQueryClient()) }
    );
    expect(disabled.result.current.checkFailed).toBe(false);
  });
});
