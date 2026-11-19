import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import type { PairedStylistView } from '../../shared/pairing/hooks/usePairedStylists';
import { useSessionStylistName } from './useSessionStylistName';

const state = vi.hoisted(() => ({ pairs: [] as PairedStylistView[] }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('../../stylist/StylistProfilePage.query', () => ({
  profileQueryOptions: () => ({
    queryKey: ['test-profile'],
    queryFn: () => undefined,
    enabled: false,
  }),
}));
vi.mock('../../shared/pairing/hooks/usePairedStylists', () => ({
  usePairedStylists: () => ({ ...state, isError: false, hasData: true }),
}));
vi.mock(
  '../../../../application/app-snackbar/appSnackbar.possibilities.api',
  () => ({
    pushNewSnackbar: vi.fn(),
  })
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const session = { stylistAccountId: 'stylist-2' } as SessionContainerDetailDTO;
const person: PairedStylistView = {
  stylistAccountId: 'stylist-2',
  stylistDisplayName: 'Anna',
  pairedAt: '',
  isInactive: false,
  viaSalon: false,
  pairId: 'pair-2',
};

describe('session stylist resolution', () => {
  it('uses the session counterpart, then removes the action after unpairing', () => {
    state.pairs = [
      { ...person, stylistAccountId: 'stylist-1', pairId: 'pair-1' },
      person,
    ];
    const { result, rerender } = renderHook(
      () => useSessionStylistName(session),
      { wrapper }
    );
    expect(result.current.stylistMessagePairId).toBe('pair-2');
    expect(result.current.stylistDisplayName).toBe('Anna');
    state.pairs = [
      { ...person, stylistAccountId: 'stylist-1', pairId: 'pair-1' },
    ];
    rerender();
    expect(result.current.stylistMessagePairId).toBeUndefined();
    expect(result.current.stylistDisplayName).toBeNull();
  });

  it('hides the action for an inactive or synthetic salon member', () => {
    state.pairs = [{ ...person, isInactive: true }];
    const { result, rerender } = renderHook(
      () => useSessionStylistName(session),
      { wrapper }
    );
    expect(result.current.stylistMessagePairId).toBeUndefined();
    expect(result.current.stylistDisplayName).toBe('inactiveAccount');
    state.pairs = [
      {
        stylistAccountId: 'stylist-2',
        stylistDisplayName: 'Anna',
        pairedAt: '',
        isInactive: false,
        viaSalon: true,
      },
    ];
    rerender();
    expect(result.current.stylistMessagePairId).toBeUndefined();
    expect(result.current.stylistDisplayName).toBe('Anna');
  });
});
