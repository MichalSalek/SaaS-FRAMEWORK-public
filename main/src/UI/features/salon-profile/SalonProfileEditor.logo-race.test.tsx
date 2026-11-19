import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { SalonProfileEditorOrganism } from './SalonProfileEditor.organism';

const update = vi.hoisted(() => vi.fn());
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock(
  '../../../domain/salon-profile/salonProfileIO.possibilities.api',
  () => ({ updateSalonProfile_IO: update })
);
vi.mock('../../../domain/salon-staff/salonStaffIO.possibilities.api', () => ({
  getSalonStaff_IO: vi.fn().mockResolvedValue({ staff: [] }),
}));
vi.mock('../shared/location/useProfileCountry', () => ({
  useProfileCountry: () => ({
    country: '',
    chooseCountry: vi.fn(),
    adoptCountryIfCurrent: vi.fn(),
  }),
}));
vi.mock('../shared/account/hooks/useUsageStats', () => ({
  useUsageStats: () => ({ data: undefined }),
}));
vi.mock('./useSalonSlugField', () => ({
  useSalonSlugField: () => ({
    validSlug: true,
    state: 'available',
    preview: '',
    message: '',
    isError: false,
  }),
}));
vi.mock('../shared/profile/ProfileLinkCard.organism', () => ({
  ProfileLinkCardOrganism: () => null,
}));
vi.mock('../shared/profile/ProfileManageSection.molecule', () => ({
  ProfileManageSectionMolecule: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div>{children}</div>,
}));
vi.mock('../shared/profile/ProfileSaveLine.molecule', () => ({
  ProfileSaveLineMolecule: () => null,
}));
vi.mock('./SalonTapSaveLine.molecule', () => ({
  SalonTapSaveLineMolecule: () => null,
  salonTapSaveLine: () => null,
  salonEditorSaveLine: () => null,
}));
vi.mock('../shared/profile/photo/StylistAvatarField.organism', () => ({
  StylistAvatarFieldOrganism: () => null,
}));
vi.mock('./SalonGallery.organism', () => ({
  SalonGalleryOrganism: () => null,
}));
vi.mock('./SalonQr.organism', () => ({ SalonQrOrganism: () => null }));
vi.mock('../../components/PageColumns/PageColumns.molecule', () => ({
  PageColumnsMolecule: ({
    main,
    aside,
  }: {
    main: React.ReactNode;
    aside: React.ReactNode;
  }) => (
    <>
      {main}
      {aside}
    </>
  ),
}));
vi.mock('./SalonSetupFields.molecule', () => ({
  SalonIdentitySectionMolecule: ({
    name,
    setName,
    commit,
  }: {
    name: string;
    setName: (value: string) => void;
    commit: { name: { onBlur: () => void } };
  }) => (
    <input
      aria-label='name'
      value={name}
      onChange={e => setName(e.target.value)}
      onBlur={commit.name.onBlur}
    />
  ),
  SalonBrandSectionMolecule: () => null,
  SalonContactSectionMolecule: () => null,
  SalonLocationSectionMolecule: () => null,
  SalonTeamSectionMolecule: ({
    setShowTeam,
  }: {
    setShowTeam: (value: boolean) => void;
  }) => (
    <button type='button' onClick={() => setShowTeam(false)}>
      team
    </button>
  ),
}));
const profile: SalonProfileData = {
  account_id: 'owner',
  name: 'Old',
  name_configured: true,
  salon_vanity_url: 'salon',
  suggested_slug: null,
  brand_accent_color: null,
  show_team: true,
  logo_url: 'old-logo',
  owner: {
    account_id: 'owner',
    name: 'Anna',
    avatar_url: null,
    identifier: 'owner',
  },
  members: [],
  works: [],
  contact: { address_city: null, website: null, instagram_handle: null },
};
it('keeps the newer logo when an earlier salon field response arrives later', async () => {
  update.mockReset();
  let resolve!: (value: SalonProfileData) => void;
  update.mockReturnValueOnce(
    new Promise<SalonProfileData>(done => {
      resolve = done;
    })
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(queryKeys.salon.mine, profile);
  render(
    <QueryClientProvider client={client}>
      <SalonProfileEditorOrganism profile={profile} justPublished={false} />
    </QueryClientProvider>
  );
  const input = screen.getByLabelText('name');
  fireEvent.change(input, { target: { value: 'New name' } });
  fireEvent.blur(input);
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  await act(async () =>
    client.setQueryData(queryKeys.salon.mine, {
      ...profile,
      logo_url: 'new-logo',
      is_active: false,
      owner: { ...profile.owner, avatar_url: 'new-person-photo' },
    })
  );
  await act(async () => {
    resolve({ ...profile, name: 'New name' });
  });
  await waitFor(() =>
    expect(client.getQueryData(queryKeys.salon.mine)).toMatchObject({
      name: 'New name',
      logo_url: 'new-logo',
      is_active: false,
      owner: { avatar_url: 'new-person-photo' },
    })
  );
});

it.each([false, true])(
  'reconciles untouched name and preserves in-progress input (typing=%s)',
  async typing => {
    update.mockReset();
    let resolve!: (value: SalonProfileData) => void;
    update.mockReturnValueOnce(
      new Promise<SalonProfileData>(done => {
        resolve = done;
      })
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(queryKeys.salon.mine, profile);
    render(
      <QueryClientProvider client={client}>
        <SalonProfileEditorOrganism profile={profile} justPublished={false} />
      </QueryClientProvider>
    );
    const input = screen.getByLabelText('name');
    fireEvent.click(screen.getByRole('button', { name: 'team' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    if (typing) {
      fireEvent.change(input, { target: { value: 'My unblurred name' } });
    }
    await act(async () => {
      resolve({ ...profile, name: 'External name', show_team: false });
    });
    await waitFor(() =>
      expect(input).toHaveValue(typing ? 'My unblurred name' : 'External name')
    );
    if (!typing) {
      fireEvent.blur(input);
      await act(async () => {
        await Promise.resolve();
      });
      expect(update).toHaveBeenCalledOnce();
    }
  }
);
