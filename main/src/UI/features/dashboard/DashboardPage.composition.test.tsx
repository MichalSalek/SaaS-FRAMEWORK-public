import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'stylist' as 'stylist' | 'client',
  stylist: null as null | { account_status: string },
  client: null as null | object,
  active: true,
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ query: {}, replace: vi.fn() }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/dynamic', () => ({
  default:
    () =>
    ({ roleZone }: { roleZone: ReactNode }) => <>{roleZone}</>,
}));
vi.mock('../../../application/auth/better-auth-client', () => ({
  authClient: { useSession: () => ({ isPending: false }) },
}));
vi.mock('../../layouts/AppLayout.composition', () => ({
  AppLayoutComposition: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('../../layouts/useAppRole', () => ({
  useAppRole: () => ({
    role: state.role,
    isRoleResolved: true,
    isAdmin: false,
    isBecomeUser: false,
  }),
}));
vi.mock('../../contexts/AuthContext.composition', () => ({
  useCurrentUser: () => ({ user: { name: 'Anna' }, isLoading: false }),
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: {
      stylist_account: state.stylist,
      client_account: state.client,
      is_active: state.active,
      deleted_at: null,
    },
    isLoading: false,
    isFetching: false,
  }),
}));
vi.mock('./components/RoleSwitcher.molecule', () => ({
  RoleSwitcherMolecule: () => <div>role switcher</div>,
}));
import { DashboardPageComposition } from './DashboardPage.composition';

afterEach(cleanup);

describe('dashboard role zone', () => {
  it.each([
    ['stylist', { account_status: 'ACTIVE' }, null],
    ['client', null, {}],
    ['client', { account_status: 'NOT_ACTIVE' }, {}],
    ['client', { account_status: 'EXPIRED' }, {}],
  ] as const)(
    'hides controls for %s with only one operational mode',
    (role, stylist, client) => {
      state.active = true;
      state.role = role;
      state.stylist = stylist;
      state.client = client;
      render(<DashboardPageComposition />);
      expect(screen.queryByText('role switcher')).toBeNull();
      expect(screen.queryByText('activate another role')).toBeNull();
    }
  );

  it.each(['ACTIVE', 'EXPIRING'])(
    'shows the switcher in both modes when stylist status is %s',
    status => {
      state.active = true;
      state.stylist = { account_status: status };
      state.client = {};
      state.role = 'stylist';
      const view = render(<DashboardPageComposition />);
      expect(screen.getByText('role switcher')).toBeInTheDocument();
      state.role = 'client';
      view.rerender(<DashboardPageComposition />);
      expect(screen.getByText('role switcher')).toBeInTheDocument();
    }
  );

  it('hides the switcher for a disabled user even when both records remain', () => {
    state.active = false;
    state.role = 'client';
    state.stylist = { account_status: 'ACTIVE' };
    state.client = {};
    render(<DashboardPageComposition />);
    expect(screen.queryByText('role switcher')).toBeNull();
  });
});
