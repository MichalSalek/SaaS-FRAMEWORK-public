import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

const state = vi.hoisted(() => ({ role: 'STYLIST' as 'STYLIST' | 'CLIENT' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../layouts/useAppBarTitle.composition', () => ({
  useAppBarTitle: vi.fn(),
}));
vi.mock('./useAccountPageData', async () => {
  const { resolveAccountSurface } =
    await import('../../../application/policies/account-surface.policy');
  return {
    useAccountPageData: () => ({
      status: 'ready',
      user: { email: 'a@example.com', is_active: true },
      surface: resolveAccountSurface({
        activeRole: state.role,
        hasStylistAccount: state.role === 'STYLIST',
        hasClientAccount: state.role === 'CLIENT',
      }),
      pricingPlan: null,
      displayName: 'Anna',
      logout: vi.fn(),
    }),
  };
});
vi.mock('../../components/AppHero/AppHero.organism', () => ({
  AppHeroOrganism: () => null,
}));
vi.mock('../../components/NavRow/NavRow.molecule', () => ({
  NavRowListMolecule: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  NavRowMolecule: ({ label }: { label: string }) => <div>{label}</div>,
}));
vi.mock('./components/SalonInvitationsCard.organism', () => ({
  SalonInvitationsCardOrganism: () => <div>pending invitation</div>,
}));
vi.mock('../shared/hooks/useSwitchRole', () => ({
  useSwitchRole: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('../../components/Button/LinkButton.atom', () => ({
  LinkButtonAtom: ({
    href,
    children,
  }: {
    href: string;
    children: ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import { AccountSectionListViewComposition } from './AccountSectionListPage.composition';

afterEach(cleanup);

describe('account section list', () => {
  it.each([
    [
      AccountTypeValue.STYLIST,
      'dualClientCta',
      ROUTES_FRONT.USER_ACTIVATE_CLIENT,
    ],
    [
      AccountTypeValue.CLIENT,
      'dualStylistCta',
      ROUTES_FRONT.USER_ACTIVATE_STYLIST,
    ],
  ] as const)(
    'places %s activation after sign out and the pending invitation',
    (role, cta, target) => {
      state.role = role;
      render(<AccountSectionListViewComposition />);
      const invitation = screen.getByText('pending invitation');
      const logout = screen.getByText('logoutRowLabel');
      const activation = screen.getByRole('link', { name: cta });
      expect(activation).toHaveAttribute('href', target);
      expect(
        invitation.compareDocumentPosition(logout) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        logout.compareDocumentPosition(activation) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  );
});
