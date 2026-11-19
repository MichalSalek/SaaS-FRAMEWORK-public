import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { SessionAcceptanceActionsMolecule } from './SessionAcceptanceActions.molecule';
import { SessionAcceptanceStatusMolecule } from './SessionAcceptanceStatus.molecule';
import { acceptSessionContainer_IO } from '../../../domain/session-container/sessionContainerIO.possibilities.api';

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../application/feature-flags/client-feature-flags', () => ({
  usePublicFeatureFlag: () => flag.enabled,
}));

vi.mock(
  '../../../domain/session-container/sessionContainerIO.possibilities.api',
  () => ({ acceptSessionContainer_IO: vi.fn() })
);
beforeEach(() => {
  vi.clearAllMocks();
  flag.enabled = true;
});
describe('session acceptance', () => {
  it('hides the new acceptance entry when disabled but preserves saved acceptance', () => {
    flag.enabled = false;
    renderWithProviders(
      <SessionAcceptanceActionsMolecule
        sessionId='session-1'
        canAccept
        acceptedAt='2026-11-01T10:00:00Z'
      />
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('inspirationsAccepted')).toBeInTheDocument();
  });
  it('does not accept on render, and sends the session id only when clicked', async () => {
    vi.mocked(acceptSessionContainer_IO).mockResolvedValueOnce({
      session: {},
    } as never);
    renderWithProviders(
      <SessionAcceptanceActionsMolecule sessionId='session-1' canAccept />
    );
    expect(acceptSessionContainer_IO).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'acceptInspirations' }));
    await waitFor(() =>
      expect(acceptSessionContainer_IO).toHaveBeenCalledWith({
        session_id: 'session-1',
      })
    );
  });
  it('shows a changed-after-acceptance status without an accept button', () => {
    renderWithProviders(
      <SessionAcceptanceActionsMolecule
        sessionId='session-1'
        canAccept={false}
        acceptedAt='2026-11-01T10:00:00Z'
        changedAt='2026-11-01T10:01:00Z'
      />
    );
    expect(screen.getByText('changesAfterAcceptance')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the client only the acceptance status without a mutation control', () => {
    renderWithProviders(
      <SessionAcceptanceStatusMolecule acceptedAt='2026-11-01T10:00:00Z' />
    );
    expect(screen.getByText('inspirationsAccepted')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(acceptSessionContainer_IO).not.toHaveBeenCalled();
  });

  it('shows a separate viewed status before acceptance', () => {
    renderWithProviders(
      <SessionAcceptanceStatusMolecule viewedAt='2026-11-01T09:59:00Z' />
    );
    expect(screen.getByText('sessionViewed')).toBeInTheDocument();
    expect(screen.queryByText('inspirationsAccepted')).not.toBeInTheDocument();
  });

  it('does not repeat the read once the session is accepted', () => {
    renderWithProviders(
      <SessionAcceptanceStatusMolecule
        viewedAt='2026-11-01T09:59:00Z'
        acceptedAt='2026-11-01T10:00:00Z'
      />
    );
    expect(screen.queryByText('sessionViewed')).not.toBeInTheDocument();
    expect(screen.getByText('inspirationsAccepted')).toBeInTheDocument();
  });
});
