import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const state = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('../../../../domain/account/accountIO.possibilities.api', () => ({
  saveVatInvoiceDetails_IO: async () => {
    // Stripe may create the ID before a later Customer update fails.
    state.ids = ['PL1234567890'];
    throw new Error('Customer update failed');
  },
}));
import { useSaveVatInvoiceDetails } from './useSaveVatInvoiceDetails';

describe('partial company save', () => {
  it('refreshes the billing profile after a failed save that may have created a tax ID', async () => {
    state.ids = [];
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => ({
        profile: useQuery({
          queryKey: [...queryKeys.account.billingProfile, 'user'],
          queryFn: async () => [...state.ids],
        }),
        save: useSaveVatInvoiceDetails(),
      }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.profile.data).toEqual([]));
    await act(async () => {
      await expect(
        result.current.save.mutateAsync({
          companyName: 'Salon',
          country: 'PL',
          addressLine1: 'Street',
          addressCity: 'Kraków',
          addressPostalCode: '30-001',
          taxId: { type: 'eu_vat', value: 'PL1234567890' },
        })
      ).rejects.toThrow('Customer update failed');
    });
    await waitFor(() =>
      expect(result.current.profile.data).toEqual(['PL1234567890'])
    );
  });
});
