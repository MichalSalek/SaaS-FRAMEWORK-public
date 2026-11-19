import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import baseMessages from '../../../locales/pl/common.json';
import { StylistActionPanelOrganism } from './StylistGalleryPage.parts.organism';

const messages = {
  ...baseMessages,
  pages: {
    ...baseMessages.pages,
    gallery: {
      ...baseMessages.pages.gallery,
      stylistActionProfileCta: 'Przejdź do profilu',
    },
  },
  stylist: {
    ...baseMessages.stylist,
    pairingExplainer: {
      ...baseMessages.stylist.pairingExplainer,
      howClientOnboarding: 'Uzupełnij konto',
      howOtherStylistWithClient: 'Zmień tryb',
      howOtherStylistNoClient: 'Potrzebne konto klientki',
    },
  },
};

describe('stylist gallery connection entry', () => {
  it.each(['guest', 'clientPublic', 'clientOnboarding'] as const)(
    'routes %s to the selected profile with explicit request intent',
    audience => {
      renderWithProviders(
        <StylistActionPanelOrganism
          audience={audience}
          stylistId='stylist-123'
        />,
        { messages }
      );
      const link = screen.getByRole('link', {
        name: messages.pages.gallery.stylistActionUnpairedCta,
      });
      expect(link).toHaveAttribute('href', '/stylist/stylist-123?pair=1');
    }
  );
  it.each(['stylistWithClient', 'stylistNoClient'] as const)(
    'routes %s to the profile without promising an immediate request',
    audience => {
      renderWithProviders(
        <StylistActionPanelOrganism
          audience={audience}
          stylistId='stylist-123'
        />,
        { messages }
      );
      const link = screen.getByRole('link', { name: 'Przejdź do profilu' });
      expect(link).toHaveAttribute('href', '/stylist/stylist-123');
      expect(
        screen.getByText(
          messages.stylist.pairingExplainer.afterItems.fullGallery
        )
      ).toBeInTheDocument();
      expect(
        screen.queryByText(messages.pages.gallery.stylistActionUnpairedTitle)
      ).not.toBeInTheDocument();
    }
  );
  it.each(['owner', 'checking', 'accessFailed'] as const)(
    'does not invite %s to send a new request',
    audience => {
      renderWithProviders(
        <StylistActionPanelOrganism
          audience={audience}
          stylistId='stylist-123'
        />,
        { messages }
      );
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    }
  );
  it('lets a connected client return to the stylist profile without a new request', () => {
    renderWithProviders(
      <StylistActionPanelOrganism
        audience='clientPaired'
        stylistId='stylist-123'
      />,
      { messages }
    );
    expect(
      screen.getByRole('link', { name: 'Przejdź do profilu' })
    ).toHaveAttribute('href', '/stylist/stylist-123');
    expect(
      screen.queryByRole('link', {
        name: messages.pages.gallery.stylistActionUnpairedCta,
      })
    ).not.toBeInTheDocument();
  });
  it('shows pending status and opens the specific profile without a new request intent', () => {
    renderWithProviders(
      <StylistActionPanelOrganism
        audience='clientPending'
        stylistId='stylist-123'
      />,
      { messages }
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.stylist.actions.requestPending
    );
    expect(
      screen.getByText(messages.stylist.pairingExplainer.howPending)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Przejdź do profilu' })
    ).toHaveAttribute('href', '/stylist/stylist-123');
    expect(
      screen.queryByRole('link', {
        name: messages.pages.gallery.stylistActionUnpairedCta,
      })
    ).not.toBeInTheDocument();
  });
});
