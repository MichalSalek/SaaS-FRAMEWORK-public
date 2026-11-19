import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  getLeavePrompt,
  registerLeaveGuard,
  resetLeaveGuardForTests,
  resolveLeavePrompt,
} from '../../../application/routing/leave-guard';
import { ProfileManagePageComposition } from './ProfileManagePage.composition';

const state = vi.hoisted(() => ({
  pending: false,
  userId: 'u1',
  sessionId: 'u1',
  error: null as null | { status: number },
  missingUser: false,
  loggedIn: true,
  ownSalon: false,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/router', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('../../../application/auth/better-auth-client', () => ({
  authClient: {
    useSession: () => ({
      isPending: state.pending,
      data: state.sessionId ? { user: { id: state.sessionId } } : null,
      error: state.error,
    }),
  },
}));
vi.mock('../../contexts/AuthContext.composition', () => ({
  useAuth: () => ({ isLoggedIn: state.loggedIn }),
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: state.missingUser
      ? undefined
      : {
          id: state.userId,
          stylist_account: {
            account_id: `a-${state.userId}`,
            vanity_url: null,
            view_count: 0,
          },
        },
    isLoading: false,
  }),
}));
vi.mock('../../shared/hooks/useSessionRole', () => ({
  useIsStylist: () => true,
}));
vi.mock('../../layouts/AppLayout.composition', () => ({
  AppLayoutComposition: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('../../layouts/useAppBarTitle.composition', () => ({
  useAppBarTitle: () => {},
}));
vi.mock('../../components/PageColumns/PageColumns.molecule', () => ({
  PageColumnsMolecule: ({ aside }: { aside: React.ReactNode }) => <>{aside}</>,
}));
vi.mock('./components/StylistProfileSection.organism', () => ({
  StylistProfileSectionOrganism: () => (
    <textarea aria-label='bio' defaultValue='original' />
  ),
}));
vi.mock('./components/PinnedManager.organism', () => ({
  PinnedManagerOrganism: () => null,
}));
vi.mock('../shared/profile/ProfileLinkCard.organism', () => ({
  ProfileLinkCardOrganism: () => null,
}));
vi.mock('../salon-profile/SalonProfileManage.organism', () => ({
  SalonProfileManageOrganism: () => null,
}));
vi.mock('../salon-profile/SalonProfileVisibility.organism', () => ({
  SalonProfileVisibilityOrganism: () => null,
}));
vi.mock('../../shared/hooks/useUrlSyncedState', async () => {
  const React = await import('react');
  return {
    useUrlSyncedState: () => {
      const [target, setTarget] = React.useState('personal');
      return [target, setTarget, true];
    },
  };
});
vi.mock('../../components/SegmentedControl/SegmentedControl.molecule', () => ({
  SegmentedControlMolecule: ({
    onChange,
  }: {
    onChange: (next: string) => void;
  }) => <button onClick={() => onChange('salon')}>salon</button>,
}));
vi.mock('../../../application/policies/salon-ownership.policy', () => ({
  hasOwnSalon: () => state.ownSalon,
}));
vi.mock('../../components/AppHero/AppHero.organism', () => ({
  AppHeroOrganism: () => null,
}));

describe('profile session refresh', () => {
  it('keeps a draft mounted but unavailable while the same identity is being verified, then hides it for a different identity', () => {
    state.pending = false;
    state.userId = 'u1';
    state.sessionId = 'u1';
    state.loggedIn = true;
    state.error = null;
    state.missingUser = false;
    const view = render(<ProfileManagePageComposition />);
    const field = screen.getByLabelText('bio');
    fireEvent.change(field, { target: { value: 'draft' } });
    state.pending = true;
    view.rerender(<ProfileManagePageComposition />);
    expect(screen.getByLabelText('bio')).toBe(field);
    expect(field).toHaveValue('draft');
    expect(field.closest('[inert]')).not.toBeNull();
    state.pending = false;
    view.rerender(<ProfileManagePageComposition />);
    expect(screen.getByLabelText('bio')).toBe(field);
    expect(field).toHaveValue('draft');
    expect(field.closest('[inert]')).toBeNull();
    state.sessionId = 'u2';
    view.rerender(<ProfileManagePageComposition />);
    expect(screen.getByLabelText('bio')).not.toBeVisible();
    expect(field.closest('[inert]')).not.toBeNull();
    state.userId = 'u2';
    view.rerender(<ProfileManagePageComposition />);
    expect(screen.getByLabelText('bio')).toHaveValue('original');
    expect(screen.getByLabelText('bio')).not.toBe(field);
    state.sessionId = '';
    state.error = { status: 401 };
    view.rerender(<ProfileManagePageComposition />);
    expect(screen.getByLabelText('bio')).not.toBeVisible();
    state.loggedIn = false;
    view.rerender(<ProfileManagePageComposition />);
    expect(screen.queryByLabelText('bio')).toBeNull();
  });
  it('asks before switching away from a guarded personal profile', async () => {
    resetLeaveGuardForTests();
    state.pending = false;
    state.loggedIn = true;
    state.sessionId = state.userId = 'u1';
    state.error = null;
    state.missingUser = false;
    state.ownSalon = true;
    const release = registerLeaveGuard('bioUnsaved');
    const view = render(<ProfileManagePageComposition />);
    fireEvent.click(screen.getByText('salon'));
    expect(getLeavePrompt()?.message).toBe('bioUnsaved');
    resolveLeavePrompt('cancel');
    expect(screen.getByLabelText('bio')).toBeInTheDocument();
    fireEvent.click(screen.getByText('salon'));
    await act(async () => resolveLeavePrompt('confirm'));
    expect(screen.queryByLabelText('bio')).toBeNull();
    view.unmount();
    release();
    state.ownSalon = false;
  });
  it('keeps the current-user load failure visible after the session settles', () => {
    state.pending = false;
    state.loggedIn = true;
    state.sessionId = 'u1';
    state.error = null;
    state.missingUser = true;
    render(<ProfileManagePageComposition />);
    expect(screen.getByText('loadError')).toBeVisible();
  });
});
