import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { useShareSession } from './useShareSession';

vi.mock(
  '../../../../domain/session-container/sessionContainerIO.possibilities.api',
  () => ({ shareSessionContainer_IO: vi.fn(async () => ({})) })
);
vi.mock('../../../../application/analytics/flow-events', () => ({
  trackFlowStep: vi.fn(),
}));

describe('salon session first-contact cache', () => {
  it('refreshes the existing pair and conversations after an explicit successful share', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const pairKey = queryKeys.pairing.pairs;
    const messagesKey = queryKeys.messaging.conversations(false);
    client.setQueryData(pairKey, {
      pages: [{ pairs: [], salons: [] }],
      pageParams: [undefined],
    });
    client.setQueryData(messagesKey, { conversations: [] });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(
      () => useShareSession('explicitly-shared-session'),
      { wrapper }
    );
    expect(client.getQueryState(pairKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(messagesKey)?.isInvalidated).toBe(false);
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(pairKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(messagesKey)?.isInvalidated).toBe(true);
    client.clear();
  });
});
