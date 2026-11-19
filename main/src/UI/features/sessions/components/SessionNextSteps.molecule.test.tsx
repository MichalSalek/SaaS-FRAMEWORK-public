import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../test-utils/renderWithProviders';
import { SessionNextStepsMolecule } from './SessionNextSteps.molecule';

vi.mock('next/router', () => ({
  useRouter: () => ({
    locale: 'pl',
    pathname: '/app/sessions/session-1',
    query: {},
    asPath: '/app/sessions/session-1',
  }),
}));

const messages = {
  pages: {
    sessions: {
      afterShareTitle: 'Teraz umów się na wizytę u swojej stylistki',
      afterShareBody: 'Napisz do niej albo zadzwoń, żeby ustalić termin.',
      afterShareBodyMessageOnly: 'Napisz do niej, żeby ustalić termin.',
      afterShareDraft:
        'Hej, właśnie udostępniłam Ci moją sesję inspiracji. Na kiedy możemy się umówić?',
      afterShareMessage: 'Wyślij wiadomość',
      afterShareCall: 'Zadzwoń',
    },
  },
};

describe('session next steps after sharing', () => {
  it('offers only the message when the stylist has no public phone', () => {
    renderWithProviders(
      <SessionNextStepsMolecule pairId='pair-1' phone={null} />,
      { messages }
    );

    expect(
      screen.getByText('Napisz do niej, żeby ustalić termin.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/albo zadzwoń/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Zadzwoń' })
    ).not.toBeInTheDocument();
  });

  it('offers the call action and matching copy when a phone exists', () => {
    renderWithProviders(
      <SessionNextStepsMolecule pairId='pair-1' phone='+48 511 222 333' />,
      { messages }
    );

    expect(
      screen.getByText('Napisz do niej albo zadzwoń, żeby ustalić termin.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zadzwoń' })).toBeInTheDocument();
  });
});
