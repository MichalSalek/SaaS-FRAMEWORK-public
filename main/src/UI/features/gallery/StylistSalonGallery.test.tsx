import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { StylistGalleryPageComposition } from './StylistGalleryPage.composition';

const state = vi.hoisted(() => ({ hasSalonAccess: false, usePaired: false }));
vi.mock('next/router', () => ({ useRouter: () => ({ query: {} }) }));
vi.mock('./hooks/useStylistSalonScope', () => ({
  useStylistSalonScope: () => ({
    salon: { account_id: 'salon' },
    showSalon: true,
    scopeControl: null,
    hasSalonAccess: state.hasSalonAccess,
  }),
}));
vi.mock('./hooks/useStylistGalleryPage', () => ({
  useStylistGalleryPage: () => ({
    allRecords: [],
    filteredRecords: [],
    displayedRecords: [],
    stylistInfo: null,
    isLoading: false,
    isError: false,
    usePaired: state.usePaired,
    audience: state.usePaired ? 'clientPaired' : 'clientPublic',
    filters: {},
    availableColors: [],
    availableTraits: [],
    availableNailLengths: [],
    allNailLengths: [],
    totalActiveFilters: 0,
    favoritedIds: new Set(),
    uniqueColors: 0,
    uniqueStyles: 0,
  }),
}));
vi.mock('./hooks/useGalleryFiltersUrl', () => ({
  useGalleryFiltersUrl: () => true,
}));
vi.mock('./hooks/useSessionPickFavorites', () => ({
  useSessionPickFavorites: () => ({ favoritedRecordIdsForStylist: new Set() }),
}));
vi.mock('../shared/sessions/hooks/useSessionPhotoPicker', () => ({
  useSessionPhotoPicker: () => ({}),
}));
vi.mock('../../shared/hooks/useGalleryLayout', () => ({
  useGalleryLayout: () => ({}),
}));
vi.mock('../../layouts/useViewTransitionRouter', () => ({
  useViewTransitionRouter: () => vi.fn(),
}));
vi.mock('../../layouts/useAppBarTitle.composition', () => ({
  useAppBarTitle: vi.fn(),
}));
vi.mock('../../layouts/AppLayout.composition', () => ({
  AppLayoutComposition: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock('../salon-profile/SalonGallery.organism', () => ({
  SalonGalleryOrganism: ({ publicOnly }: { publicOnly: boolean }) => (
    <div data-testid='gallery'>{publicOnly ? 'public' : 'authenticated'}</div>
  ),
}));

describe('salon scope in a stylist gallery', () => {
  it('uses the authenticated salon gallery for a connected salon even without a pair to this stylist', () => {
    state.hasSalonAccess = true;
    state.usePaired = false;
    renderWithProviders(
      <StylistGalleryPageComposition stylistId='colleague' />
    );
    expect(screen.getByTestId('gallery')).toHaveTextContent('authenticated');
  });
  it('keeps public-only gallery for an unconnected salon', () => {
    state.hasSalonAccess = false;
    state.usePaired = false;
    renderWithProviders(
      <StylistGalleryPageComposition stylistId='colleague' />
    );
    expect(screen.getByTestId('gallery')).toHaveTextContent('public');
  });
  it('offers a connected client the stylist profile in salon scope', () => {
    state.hasSalonAccess = true;
    state.usePaired = true;
    renderWithProviders(
      <StylistGalleryPageComposition stylistId='colleague' />
    );
    expect(
      screen.getByRole('link', { name: 'stylistActionProfileCta' })
    ).toHaveAttribute('href', '/stylist/colleague');
  });
});
