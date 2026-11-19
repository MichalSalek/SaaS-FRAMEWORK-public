import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  makeTestQueryClient,
  renderWithProviders,
} from '../../../test-utils/renderWithProviders';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { NotificationOpenPageComposition } from './NotificationOpenPage.composition';

const state = vi.hoisted(() => ({
  role: 'CLIENT',
  replace: vi.fn(async () => true),
  get: vi.fn(),
  mark: vi.fn(async () => ({ marked: 1 })),
  switchRole: vi.fn(async () => ({})),
}));
vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: { id: 'n1' },
    replace: state.replace,
  }),
}));
vi.mock('../../layouts/AppLayout.composition', () => ({
  AppLayoutComposition: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../contexts/AuthContext.composition', () => ({
  useAuth: () => ({ isLoggedIn: true, accountType: state.role }),
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    isLoading: false,
    data: { client_account: {}, stylist_account: {} },
  }),
}));
vi.mock('../shared/hooks/useSwitchRole', () => ({
  useSwitchRole: () => ({ mutateAsync: state.switchRole }),
}));
vi.mock('../../../application/routing/leave-guard', () => ({
  requestLeave: () => true,
}));
vi.mock(
  '../../../domain/notifications/notificationsIO.possibilities.api',
  () => ({
    getNotification_IO: state.get,
    markNotificationsRead_IO: state.mark,
  })
);

beforeEach(() => {
  state.role = 'CLIENT';
  state.replace.mockClear();
  state.get.mockReset();
  state.mark.mockClear();
  state.switchRole.mockClear();
});

describe('notification opener', () => {
  it('switches to the recipient role and honors the conversation activity target', async () => {
    state.get.mockResolvedValue({
      notification: {
        id: 'n1',
        type: 'MESSAGE_RECEIVED',
        actor_name: null,
        target_path: '/app/messages/pair-1',
        recipient_role: 'STYLIST',
        activity_kind: 'SESSION_SUBMITTED',
        session_id: 'session-1',
        created_at: '2026-11-01T00:00:00Z',
        read_at: null,
      },
    });
    renderWithProviders(<NotificationOpenPageComposition />);
    await waitFor(() =>
      expect(state.replace).toHaveBeenCalledWith('/app/messages/pair-1')
    );
    expect(state.switchRole).toHaveBeenCalledWith({ account_type: 'STYLIST' });
    expect(state.mark).toHaveBeenCalledOnce();
  });
  it('switches to the recipient role and opens its own session, without accepting it', async () => {
    state.get.mockResolvedValue({
      notification: {
        id: 'n1',
        type: 'MESSAGE_RECEIVED',
        actor_name: null,
        target_path: '/app/notifications',
        recipient_role: 'STYLIST',
        activity_kind: 'SESSION_SUBMITTED',
        session_id: 'session-1',
        created_at: '2026-11-01T00:00:00Z',
        read_at: null,
      },
    });
    renderWithProviders(<NotificationOpenPageComposition />);
    await waitFor(() =>
      expect(state.replace).toHaveBeenCalledWith('/app/inbox/session/session-1')
    );
    expect(state.switchRole).toHaveBeenCalledWith({ account_type: 'STYLIST' });
    expect(state.mark).toHaveBeenCalledWith(
      { notification_id: 'n1', newest_seen_at: '2026-11-01T00:00:00Z' },
      { silentBusinessError: true }
    );
  });
  it('does not switch roles or navigate for a missing or foreign notification', async () => {
    state.get.mockResolvedValue({ notification: null });
    const { findByText } = renderWithProviders(
      <NotificationOpenPageComposition />
    );
    await findByText('loadError');
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.switchRole).not.toHaveBeenCalled();
    expect(state.mark).not.toHaveBeenCalled();
  });

  it('continues when the active role rerenders while the switch is resolving', async () => {
    let finishSwitch: (() => void) | undefined;
    state.switchRole.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishSwitch = () => resolve({});
        })
    );
    state.get.mockResolvedValue({
      notification: {
        id: 'n1',
        type: 'MESSAGE_RECEIVED',
        actor_name: null,
        target_path: '/app/notifications',
        recipient_role: 'STYLIST',
        activity_kind: 'SESSION_SUBMITTED',
        session_id: 'session-1',
        created_at: '2026-11-01T00:00:00Z',
        read_at: null,
      },
    });
    const view = renderWithProviders(<NotificationOpenPageComposition />);
    await waitFor(() => expect(state.switchRole).toHaveBeenCalledOnce());
    state.role = 'STYLIST';
    view.rerender(<NotificationOpenPageComposition />);
    finishSwitch?.();
    await waitFor(() =>
      expect(state.replace).toHaveBeenCalledWith('/app/inbox/session/session-1')
    );
    expect(state.switchRole).toHaveBeenCalledOnce();
  });

  it('does not act on cached ownership while a fresh lookup is pending', async () => {
    let resolveLookup: ((value: { notification: null }) => void) | undefined;
    state.get.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveLookup = resolve;
        })
    );
    const queryClient = makeTestQueryClient();
    queryClient.setQueryData([...queryKeys.notifications.all, 'one', 'n1'], {
      notification: {
        id: 'n1',
        type: 'MESSAGE_RECEIVED',
        actor_name: null,
        target_path: '/app/notifications',
        recipient_role: 'STYLIST',
        activity_kind: 'SESSION_SUBMITTED',
        session_id: 'session-1',
        created_at: '2026-11-01T00:00:00Z',
        read_at: null,
      },
    });
    const view = renderWithProviders(<NotificationOpenPageComposition />, {
      queryClient,
    });
    await waitFor(() => expect(state.get).toHaveBeenCalledOnce());
    expect(state.switchRole).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
    resolveLookup?.({ notification: null });
    await view.findByText('loadError');
    expect(state.replace).not.toHaveBeenCalled();
  });
});
