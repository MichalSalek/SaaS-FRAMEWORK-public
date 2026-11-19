import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { StylistClientsOrganism } from './StylistClients.organism';

const state = vi.hoisted(() => ({
  requests: [] as { pair_id: string }[],
  pairs: [] as {
    id: string;
    user_id: string;
    name: string;
    email: string;
    paired_at: string;
    counterpart_inactive: boolean;
  }[],
  isLoading: false,
  isError: false,
  moreFailed: false,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('../shared/pairing/hooks/usePairedList', () => ({
  usePairedList: () => ({
    pairs: state.pairs,
    data: {},
    isLoading: state.isLoading,
    isError: state.isError,
    isFetching: false,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: state.moreFailed,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock('../shared/pairing/hooks/usePairRequests', () => ({
  usePendingRequests: () => ({ data: { requests: state.requests } }),
}));
vi.mock('../shared/pairing/hooks/useClientAttention', () => ({
  useClientAttention: () => ({
    unreadByPair: new Map(),
    pendingSessionClients: new Set(),
    pendingSessionIdByClient: new Map(),
  }),
}));
vi.mock('../../components/AppHero/AppHero.organism', () => ({
  AppHeroOrganism: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('../../components/PageColumns/PageColumns.molecule', () => ({
  PageColumnsMolecule: ({ main }: { main: ReactNode }) => <main>{main}</main>,
}));
vi.mock('../../components/Button/LinkButton.atom', () => ({
  LinkButtonAtom: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock('../../components/NavRow/NavRow.molecule', () => ({
  NavRowListMolecule: ({ children }: { children: ReactNode }) => (
    <ul>{children}</ul>
  ),
  NavRowListSkeletonMolecule: () => <div data-testid='loading-clients' />,
}));
vi.mock('./StylistPairRequests.organism', () => ({
  StylistPairRequestsOrganism: () =>
    state.requests.length > 0 ? <button>Accept request</button> : null,
}));
vi.mock('./StylistPairedClients.parts.molecule', () => ({
  StylistClientRowMolecule: ({ client }: { client: { name: string } }) => (
    <li>{client.name}</li>
  ),
}));
vi.mock('../shared/push/PushSoftAsk.organism', () => ({
  PushSoftAskOrganism: () => null,
}));

beforeEach(() => {
  state.requests = [];
  state.pairs = [];
  state.isLoading = false;
  state.isError = false;
  state.moreFailed = false;
});

describe('stylist clients with connection requests', () => {
  it('shows the request without the first-client onboarding card', () => {
    state.requests = [{ pair_id: 'request-1' }];
    render(<StylistClientsOrganism />);

    expect(
      screen.getByRole('button', { name: 'Accept request' })
    ).toBeVisible();
    expect(
      screen.queryByText('stylistClientsEmptyTitle')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('stylistClientsEmptyHint')
    ).not.toBeInTheDocument();
  });

  it('keeps the first-client card and QR action when there are no requests', () => {
    render(<StylistClientsOrganism />);

    expect(screen.getByText('stylistClientsEmptyTitle')).toBeVisible();
    expect(screen.getByRole('link', { name: 'showQrBtn' })).toHaveAttribute(
      'href',
      '/app/pairing'
    );
  });

  it('retains the list error and retry while a request is waiting', () => {
    state.requests = [{ pair_id: 'request-1' }];
    state.isError = true;
    render(<StylistClientsOrganism />);

    expect(screen.getByRole('alert')).toHaveTextContent('listLoadError');
    expect(screen.getByRole('button', { name: 'retry' })).toBeVisible();
    expect(
      screen.queryByText('stylistClientsEmptyTitle')
    ).not.toBeInTheDocument();
  });

  it('retains the list loading state while a request is waiting', () => {
    state.requests = [{ pair_id: 'request-1' }];
    state.isLoading = true;
    render(<StylistClientsOrganism />);

    expect(screen.getByTestId('loading-clients')).toBeVisible();
    expect(
      screen.queryByText('stylistClientsEmptyTitle')
    ).not.toBeInTheDocument();
  });

  it('keeps connected clients and the quiet QR action with a pending request', () => {
    state.requests = [{ pair_id: 'request-1' }];
    state.pairs = [
      {
        id: 'pair-1',
        user_id: 'client-1',
        name: 'Ania',
        email: 'client@example.com',
        paired_at: '2026-11-04T00:00:00.000Z',
        counterpart_inactive: false,
      },
    ];
    render(<StylistClientsOrganism />);

    expect(
      screen.getByRole('button', { name: 'Accept request' })
    ).toBeVisible();
    expect(screen.getByText('Ania')).toBeVisible();
    expect(screen.getByRole('link', { name: 'showQrBtn' })).toBeVisible();
  });
});
