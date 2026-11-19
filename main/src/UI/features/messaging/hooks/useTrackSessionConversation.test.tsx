import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessagingThreadMeta } from '@kernel/models/messaging/messaging.dto';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { useTrackSessionConversation } from './useTrackSessionConversation';
const state = vi.hoisted(() => ({ query: {} as Record<string, string> }));
vi.mock('next/router', () => ({ useRouter: () => ({ query: state.query }) }));
vi.mock('../../../../application/analytics/flow-events', () => ({
  trackFlowStep: vi.fn(),
}));

describe('conversation arrival from inspirations', () => {
  it('counts only a loaded matching thread once and sends no resource identifiers', () => {
    const meta: MessagingThreadMeta = {
      pair_id: 'pair-a',
      status: 'ACTIVE',
      counterpart_name: 'Private name',
      counterpart_avatar_url: null,
      viewer_side: 'CLIENT',
      can_send: true,
      hidden_at: null,
    };
    const { rerender } = renderHook<
      void,
      { pairId: string; loaded: MessagingThreadMeta | null }
    >(({ pairId, loaded }) => useTrackSessionConversation(pairId, loaded), {
      initialProps: { pairId: 'pair-a', loaded: null },
    });
    expect(trackFlowStep).not.toHaveBeenCalled();
    state.query = { fromSession: '1' };
    rerender({ pairId: 'pair-a', loaded: null });
    rerender({ pairId: 'pair-b', loaded: meta });
    expect(trackFlowStep).not.toHaveBeenCalled();
    rerender({ pairId: 'pair-a', loaded: meta });
    rerender({ pairId: 'pair-a', loaded: { ...meta } });
    expect(trackFlowStep).toHaveBeenCalledExactlyOnceWith(
      'session',
      'conversation_opened',
      {
        role: 'CLIENT',
        measurement_version: 1,
      }
    );
  });
});
