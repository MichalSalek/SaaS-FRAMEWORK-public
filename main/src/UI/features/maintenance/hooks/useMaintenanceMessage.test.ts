// useMaintenanceMode / useMaintenanceMessage: a failed refetch must not drop
// the last known config (TanStack v5 keeps `data` next to `isError`), while a
// config that was never read still fails soft to "open, no banner" (mode
// `null` = unknown, which the gate treats as open).

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  useMaintenanceMessage,
  useMaintenanceMode,
} from './useMaintenanceMessage';
import {
  createQueryWrapper,
  makeTestQueryClient,
} from '../../../../test-utils/renderWithProviders';
import { mswServer } from '../../../../test-utils/msw/server';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const failRuntimeConfig = () =>
  mswServer.use(
    http.get('*/api/v1/runtime-config', () =>
      HttpResponse.json({ event: 'GENERAL_ERROR', data: null }, { status: 500 })
    )
  );

describe('maintenance config hooks', () => {
  it('keeps maintenance mode ON when a poll fails after a successful read', async () => {
    failRuntimeConfig();
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.public.maintenanceMessage, {
      message: 'Przerwa techniczna',
      mode: true,
    });

    const { result } = renderHook(
      () => ({
        mode: useMaintenanceMode({ pollMs: 60_000 }),
        message: useMaintenanceMessage(),
      }),
      { wrapper: createQueryWrapper(client) }
    );

    await waitFor(() =>
      expect(
        client.getQueryState(queryKeys.public.maintenanceMessage)?.status
      ).toBe('error')
    );
    expect(result.current.mode).toBe(true);
    expect(result.current.message).toBe('Przerwa techniczna');
  });

  it('fails soft to open and no banner when the config was never read', async () => {
    failRuntimeConfig();
    const client = makeTestQueryClient();

    const { result } = renderHook(
      () => ({
        mode: useMaintenanceMode(),
        message: useMaintenanceMessage(),
      }),
      { wrapper: createQueryWrapper(client) }
    );

    await waitFor(() =>
      expect(
        client.getQueryState(queryKeys.public.maintenanceMessage)?.status
      ).toBe('error')
    );
    // Unknown, not "lifted": the gate keeps the product open on `null` but
    // only a confirmed `false` takes a visitor off /maintenance.
    expect(result.current.mode).toBeNull();
    expect(result.current.message).toBe('');
  });
});
