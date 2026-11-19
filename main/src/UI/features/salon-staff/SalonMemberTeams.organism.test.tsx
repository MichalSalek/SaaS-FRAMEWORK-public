import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { SalonMemberTeamsOrganism } from './SalonMemberTeams.organism';

const api = vi.hoisted(() => ({ getTeam: vi.fn(), leave: vi.fn() }));
vi.mock('../../../domain/salon-staff/salonStaffIO.possibilities.api', () => ({
  getMySalonTeam_IO: api.getTeam,
  leaveSalonTeam_IO: api.leave,
}));
vi.mock('../salon-profile/SalonGallery.organism', () => ({
  SalonGalleryOrganism: ({ onUnavailable }: { onUnavailable: () => void }) => (
    <button onClick={onUnavailable}>simulate gallery 404</button>
  ),
}));

const team = {
  salon_account_id: 'salon',
  salon_name: 'Salon',
  owner: {
    user_id: 'owner',
    name: 'Owner',
    image: null,
    public_profile_id: null,
  },
  members: [],
};

type TeamResponse = {
  teams: (typeof team & { gallery_available?: boolean })[];
};
function Screen({ initial }: { initial: TeamResponse }) {
  const { data } = useQuery({
    queryKey: queryKeys.staff.myTeam,
    queryFn: async () => initial,
    initialData: initial,
    enabled: false,
  });
  return <SalonMemberTeamsOrganism teams={data.teams} currentUserId='member' />;
}

describe('team gallery availability', () => {
  beforeEach(() => api.getTeam.mockReset());
  it('shows unavailable and still allows leaving when the salon plan ended', () => {
    renderWithProviders(
      <Screen initial={{ teams: [{ ...team, gallery_available: false }] }} />
    );
    expect(screen.getByText('galleryUnavailable')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'showGallery' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'leave' })).toBeInTheDocument();
  });

  it('keeps the gallery available when an older backend omits the new field', () => {
    renderWithProviders(<Screen initial={{ teams: [team] }} />);
    expect(
      screen.getByRole('button', { name: 'showGallery' })
    ).toBeInTheDocument();
  });

  it('refreshes stale team data after gallery refusal and shows a confirmed unavailable state', async () => {
    api.getTeam.mockResolvedValueOnce({
      teams: [{ ...team, gallery_available: false }],
    });
    renderWithProviders(
      <Screen initial={{ teams: [{ ...team, gallery_available: true }] }} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'showGallery' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'simulate gallery 404' })
    );
    await waitFor(() =>
      expect(screen.getByText('galleryUnavailable')).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('button', { name: 'showGallery' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'leave' })).toBeInTheDocument();
  });

  it('does not claim unavailability when the team refresh fails', async () => {
    api.getTeam.mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(
      <Screen initial={{ teams: [{ ...team, gallery_available: true }] }} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'showGallery' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'simulate gallery 404' })
    );
    await waitFor(() => expect(api.getTeam).toHaveBeenCalled());
    expect(screen.queryByText('galleryUnavailable')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'hideGallery' })
    ).toBeInTheDocument();
  });
});
