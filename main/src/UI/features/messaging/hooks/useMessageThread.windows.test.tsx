import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { getMessageThread_IO } from '../../../../domain/messaging/messagingIO.possibilities.api';
import { useMessageThread } from './useMessageThread';

vi.mock('../../../../domain/messaging/messagingIO.possibilities.api', () => ({
  getMessageThread_IO: vi.fn(),
}));

describe('loaded thread windows', () => {
  it('refreshes permission-masked media on an older page without dropping history or requiring a new revision', async () => {
    const meta = {
      pair_id: 'pair',
      status: 'ACTIVE' as const,
      counterpart_name: 'Client',
      counterpart_avatar_url: null,
      viewer_side: 'STYLIST' as const,
      can_send: true,
      hidden_at: null,
    };
    const current = {
      id: 'text',
      sender_type: 'CLIENT' as const,
      content: 'Hello',
      created_at: '2026-01-02T00:00:00Z',
      kind: 'TEXT' as const,
      revision: 1,
    };
    const oldCard = {
      id: 'card',
      sender_type: 'CLIENT' as const,
      content: 'Shared session',
      created_at: '2026-01-01T00:00:00Z',
      kind: 'SESSION_SUBMITTED' as const,
      revision: 1,
      session_id: 'session',
      session_preview: {
        thumbnails: ['https://example.test/photo'],
        remaining_count: 0,
      },
    };
    const latest = {
      meta,
      messages: [current],
      next_cursor: 'older-window',
      read_through: current.created_at,
    };
    const read = vi.mocked(getMessageThread_IO);
    read
      .mockResolvedValueOnce(latest)
      .mockResolvedValueOnce({ meta, messages: [oldCard], next_cursor: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useMessageThread('pair'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => {
      await result.current.loadOlder();
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    read.mockResolvedValueOnce(latest).mockResolvedValueOnce({
      meta,
      messages: [{ ...oldCard, session_id: null, session_preview: null }],
      next_cursor: null,
    });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(
        result.current.messages.find(item => item.id === 'card')
          ?.session_preview
      ).toBeNull()
    );
    expect(result.current.messages.map(item => item.id)).toEqual([
      'card',
      'text',
    ]);
    expect(result.current.readThrough).toBe(current.created_at);
    expect(read).toHaveBeenCalledTimes(4);
    unmount();
    client.clear();
  });
});
