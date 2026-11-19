import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import plMessages from '../../../locales/pl/common.json';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { ThreadHeaderMolecule } from './MessageThreadPage.parts.molecule';

const messages = {
  ...plMessages,
  pages: {
    ...plMessages.pages,
    messaging: {
      ...plMessages.pages.messaging,
      unnamedPerson: 'Rozmowa',
      unnamedClient: 'Klientka',
      unnamedStylist: 'Stylistka',
      viewProfile: 'Zobacz profil',
      requestConnection: 'Poproś o połączenie',
    },
  },
} as unknown as AbstractIntlMessages;

describe('ThreadHeaderMolecule counterpart', () => {
  const renderHeader = (
    name: string,
    viewerSide: 'CLIENT' | 'STYLIST' | null,
    isReady = true
  ) =>
    renderWithProviders(
      <ThreadHeaderMolecule
        name={name}
        avatarUrl='/private.png'
        viewerSide={viewerSide}
        profileHref={null}
        requestHref={null}
        isPendingRequest={false}
        onNavigate={vi.fn()}
        isReady={isReady}
        canHide={false}
        hidePending={false}
        onHide={vi.fn()}
        canEndContact={false}
        onEndContact={vi.fn()}
      />,
      { messages }
    );

  it.each([
    ['STYLIST', 'Klientka'],
    ['CLIENT', 'Stylistka'],
    [null, 'Rozmowa'],
  ] as const)(
    'uses %s viewer metadata for a nameless counterpart without showing the photo',
    (side, expected) => {
      const { container } = renderHeader('  ', side);
      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(container.querySelector('svg')).not.toBeNull();
      expect(container.querySelector('img')).toBeNull();
    }
  );

  it('keeps a supplied name and photo', () => {
    const { container } = renderHeader('  Anna Nowak  ', 'STYLIST');
    expect(screen.getByText('Anna Nowak')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('does not render a label or avatar before metadata is ready', () => {
    const { container } = renderHeader('', null, false);
    expect(screen.queryByText('Rozmowa')).not.toBeInTheDocument();
    expect(container.querySelector('svg, img')).toBeNull();
  });

  it('opens the profile from the header and offers profile and request actions', async () => {
    const navigate = vi.fn();
    renderWithProviders(
      <ThreadHeaderMolecule
        name='Anna'
        avatarUrl={null}
        viewerSide='CLIENT'
        profileHref='/stylist/anna'
        requestHref='/stylist/anna?pair=1'
        isPendingRequest={false}
        onNavigate={navigate}
        isReady
        canHide
        hidePending={false}
        onHide={vi.fn()}
        canEndContact
        onEndContact={vi.fn()}
      />,
      { messages }
    );
    expect(
      screen.getByRole('link', { name: 'Zobacz profil: Anna' })
    ).toHaveAttribute('href', '/stylist/anna');
    fireEvent.click(screen.getByRole('button', { name: 'Więcej' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Poproś o połączenie' })
    );
    expect(navigate).toHaveBeenCalledWith('/stylist/anna?pair=1');
  });

  it('shows a pending request without offering another request action', async () => {
    renderWithProviders(
      <ThreadHeaderMolecule
        name='Anna'
        avatarUrl={null}
        viewerSide='CLIENT'
        profileHref='/stylist/anna'
        requestHref={null}
        isPendingRequest
        onNavigate={vi.fn()}
        isReady
        canHide={false}
        hidePending={false}
        onHide={vi.fn()}
        canEndContact={false}
        onEndContact={vi.fn()}
      />,
      { messages }
    );
    expect(
      screen.getByText(plMessages.stylist.actions.requestPending)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zobacz profil: Anna' })
    ).toHaveAccessibleDescription(plMessages.stylist.actions.requestPending);
    fireEvent.click(screen.getByRole('button', { name: 'Więcej' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Zobacz profil' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Poproś o połączenie' })
    ).not.toBeInTheDocument();
  });
});
