import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
const state = vi.hoisted(() => ({
  userId: 'user-1',
  sessionId: 'user-1',
  isError: false,
  url: 'https://invoice.stripe.com/i/owned/in_1',
  expiresAt: null as string | null,
  open: vi.fn(),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../../application/auth/better-auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: state.sessionId } } }),
  },
}));
vi.mock('../../../application/platform/browser', () => ({
  openExternalUrl: state.open,
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    isError: state.isError,
    data: {
      id: state.userId,
      stylist_account: {
        billing: {
          pendingPayment: { url: state.url, expiresAt: state.expiresAt },
        },
      },
    },
  }),
}));
vi.mock('../../../domain/account/accountIO.possibilities.api', () => ({
  createPortalSession_IO: vi.fn(),
}));
vi.mock('../../hooks/useCurrentLang', () => ({ useCurrentLang: () => 'pl' }));
import { ExistingSubscriptionRecoveryMolecule } from './ExistingSubscriptionRecovery.molecule';
beforeEach(() => {
  state.userId = 'user-1';
  state.sessionId = 'user-1';
  state.isError = false;
  state.url = 'https://invoice.stripe.com/i/owned/in_1';
  state.expiresAt = null;
  state.open.mockClear();
});
describe('existing subscription recovery', () => {
  it('opens the owned invoice without exposing its capability in a link', () => {
    const view = render(<ExistingSubscriptionRecoveryMolecule />);
    fireEvent.click(view.getByRole('button', { name: 'resume' }));
    expect(state.open).toHaveBeenCalledWith(state.url);
    expect(view.container.querySelector('a')).toBeNull();
  });
  it.each(['different user', 'untrusted URL', 'expired', 'query failed'])(
    'does not offer an unsafe invoice for %s',
    reason => {
      if (reason === 'different user') {
        state.sessionId = 'user-2';
      }
      if (reason === 'untrusted URL') {
        state.url = 'https://example.com/invoice';
      }
      if (reason === 'expired') {
        state.expiresAt = '2020-01-01T00:00:00.000Z';
      }
      if (reason === 'query failed') {
        state.isError = true;
      }
      const view = render(<ExistingSubscriptionRecoveryMolecule />);
      expect(view.queryByRole('button', { name: 'resume' })).toBeNull();
      expect(
        view.getByRole('button', { name: 'manageExistingPlan' })
      ).toBeDefined();
    }
  );
});
