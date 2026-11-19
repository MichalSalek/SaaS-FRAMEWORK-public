import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { StylistPairingExplainerMolecule } from './StylistPairingExplainer.molecule';
import type { PairingAudience } from '../shared/pairing/pairingAudience';

const messages = {
  stylist: {
    pairingExplainer: {
      howTitle: 'Jak się połączyć?',
      howOwnTitle: 'Jak klientka może się połączyć?',
      ownerOnly: 'Tę instrukcję widzisz tylko Ty',
      howGuest: 'Instrukcja gościa',
      howClientOnboarding: 'Uzupełnij konto klientki',
      howItWorks: 'Instrukcja klientki',
      howPending: 'Prośba czeka',
      howOwnProfile: 'Instrukcja właścicielki',
      howOtherStylistWithClient: 'Zmień tryb',
      howOtherStylistNoClient: 'Potrzebne konto klientki',
      title: 'Korzyści klientki',
      afterItems: {
        fullGallery: 'Pełna galeria',
        sessions: 'Sesje',
        messages: 'Wiadomości',
        history: 'Historia',
      },
    },
  },
};

describe('public profile connection instructions', () => {
  it.each([
    ['guest', 'Instrukcja gościa', true],
    ['clientOnboarding', 'Uzupełnij konto klientki', true],
    ['clientPublic', 'Instrukcja klientki', true],
    ['clientPending', 'Prośba czeka', true],
    ['owner', 'Instrukcja właścicielki', false],
    ['stylistWithClient', 'Zmień tryb', false],
    ['stylistNoClient', 'Potrzebne konto klientki', false],
  ] as [PairingAudience, string, boolean][])(
    'renders %s for its reader',
    (audience, text, benefits) => {
      renderWithProviders(
        <StylistPairingExplainerMolecule
          audience={audience}
          action={<button type='button'>Akcja</button>}
        />,
        { messages }
      );
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(Boolean(screen.queryByText('Korzyści klientki'))).toBe(benefits);
      expect(screen.getByRole('button', { name: 'Akcja' })).toBeInTheDocument();
      expect(
        Boolean(screen.queryByText('Tę instrukcję widzisz tylko Ty'))
      ).toBe(audience === 'owner');
      if (audience === 'owner') {
        expect(
          screen.getByRole('heading', {
            name: 'Jak klientka może się połączyć?',
          })
        ).toBeInTheDocument();
      }
    }
  );

  it.each(['checking', 'accessFailed', 'clientPaired'] as PairingAudience[])(
    'does not invent an instruction while %s',
    audience => {
      renderWithProviders(
        <StylistPairingExplainerMolecule audience={audience} action={null} />,
        { messages }
      );
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    }
  );
});
