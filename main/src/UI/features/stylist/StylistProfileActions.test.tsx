import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import baseMessages from '../../../locales/pl/common.json';
import { StylistProfileActionsOrganism } from './StylistProfileActions.organism';

vi.mock('../../../application/feature-flags/client-feature-flags', () => ({
  usePublicFeatureFlag: () => true,
}));

const roleSwitch = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
}));
vi.mock('../shared/hooks/useSwitchRole', () => ({
  useSwitchRole: () => roleSwitch,
}));
const messages = {
  ...baseMessages,
  stylist: {
    ...baseMessages.stylist,
    actions: {
      ...baseMessages.stylist.actions,
      switchToClient: 'Przełącz na klientkę',
      createClientAccount: 'Utwórz konto klientki',
      completeClientAccount: 'Uzupełnij konto',
      switchToClientError: 'Nie udało się przełączyć',
    },
    pairingExplainer: {
      ...baseMessages.stylist.pairingExplainer,
      howOwnTitle: 'Profil właścicielki',
      howOwnProfile: 'Twój profil',
      howOtherStylistWithClient: 'Przełącz tryb',
      howOtherStylistNoClient: 'Utwórz konto klientki',
      howClientOnboarding: 'Uzupełnij konto klientki',
    },
  },
};

vi.mock('../../components/ShareButton/ShareButton.atom', () => ({
  ShareButtonAtom: () => <button type='button'>Udostępnij</button>,
}));

const account = {
  account_id: 'stylist',
  display_name: 'Anna',
  business_name: null,
} as Parameters<typeof StylistProfileActionsOrganism>[0]['account'];

function renderActions(
  overrides: Partial<Parameters<typeof StylistProfileActionsOrganism>[0]> = {}
) {
  const onRequestPair = vi.fn();
  renderWithProviders(
    <StylistProfileActionsOrganism
      account={account}
      isPaired={false}
      isPendingRequest={false}
      audience='guest'
      canRequestPair
      isRequestingPair={false}
      isBookmarked={false}
      isBookmarkPending={false}
      canBookmark={false}
      unpairDialogOpen={false}
      unpairConfirmText=''
      onToggleBookmark={vi.fn()}
      onRequestPair={onRequestPair}
      onContact={vi.fn()}
      contactPending={false}
      onUnpairDialogOpenChange={vi.fn()}
      onUnpairConfirmTextChange={vi.fn()}
      onConfirmUnpair={vi.fn()}
      {...overrides}
    />,
    { messages }
  );
  return { onRequestPair };
}

describe('public profile connection actions', () => {
  afterEach(() => {
    roleSwitch.isError = false;
    roleSwitch.error = null;
    roleSwitch.mutate.mockReset();
  });
  it('keeps the request callback in the guest instructions', () => {
    const { onRequestPair } = renderActions();
    fireEvent.click(
      screen.getByRole('button', { name: /poproś o połączenie/i })
    );
    expect(onRequestPair).toHaveBeenCalledOnce();
  });

  it('shows the pending state and cancel action without another request button', () => {
    renderActions({ audience: 'clientPending', isPendingRequest: true });
    expect(
      screen.getByRole('button', { name: /anuluj prośbę/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /poproś o połączenie/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(messages.stylist.pairingExplainer.howPending)
    ).toBeInTheDocument();
  });

  it('gives paired clients the gallery link without another connection prompt', () => {
    renderActions({ audience: 'clientPaired', isPaired: true });
    expect(screen.getByRole('link', { name: /pełn.*galeri/i })).toHaveAttribute(
      'href',
      expect.stringContaining('stylist')
    );
    expect(
      screen.queryByRole('heading', { name: 'Jak się połączyć?' })
    ).not.toBeInTheDocument();
  });

  it('does not offer a request action on a stylist account without permission', () => {
    renderActions({ audience: 'stylistNoClient', canRequestPair: false });
    expect(
      screen.queryByRole('button', { name: /poproś o połączenie/i })
    ).not.toBeInTheDocument();
  });
  it('does not infer stylist copy from a temporarily disabled client request', () => {
    renderActions({ audience: 'clientPublic', canRequestPair: false });
    expect(
      screen.getByText(messages.stylist.pairingExplainer.howItWorks)
    ).toBeInTheDocument();
    expect(screen.queryByText('Przełącz tryb')).not.toBeInTheDocument();
  });

  it('switches an existing client account without sending a request', () => {
    const { onRequestPair } = renderActions({
      audience: 'stylistWithClient',
      canRequestPair: false,
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Przełącz na klientkę' })
    );
    expect(roleSwitch.mutate).toHaveBeenCalledWith({ account_type: 'CLIENT' });
    expect(onRequestPair).not.toHaveBeenCalled();
  });

  it('offers client setup to another stylist without a client account', () => {
    const { onRequestPair } = renderActions({
      audience: 'stylistNoClient',
      canRequestPair: false,
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Utwórz konto klientki' })
    );
    expect(onRequestPair).toHaveBeenCalledOnce();
  });

  it('does not show client actions or benefits on an owner profile, including client mode', () => {
    renderActions({ audience: 'owner', canRequestPair: false });
    expect(
      screen.queryByRole('button', { name: /poproś o połączenie/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Profil właścicielki' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(messages.stylist.pairingExplainer.title)
    ).not.toBeInTheDocument();
  });
  it('renders inline feedback for a local switch error not handled by the transport', () => {
    roleSwitch.isError = true;
    roleSwitch.error = new Error('local');
    renderActions({ audience: 'stylistWithClient', canRequestPair: false });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nie udało się przełączyć'
    );
  });

  it('does not duplicate switch errors already handled by the HTTP interceptor', () => {
    roleSwitch.isError = true;
    roleSwitch.error = Object.assign(new Error('transport'), {
      httpError: { event: 'failure' },
    });
    renderActions({ audience: 'stylistWithClient', canRequestPair: false });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
