import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { SalonGalleryOrganism } from './SalonGallery.organism';

vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const galleryState = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock('./useSalonGallery', () => ({
  useSalonGallery: (_id: string, _public: boolean, stylist: string) => ({
    error: galleryState.error,
    data: {
      pages: [
        {
          contributors: [
            { account_id: 'owner', name: '' },
            { account_id: 'staff', name: 'Staff' },
          ],
          records:
            stylist === 'staff'
              ? []
              : [
                  {
                    gallery_record_id: 'photo',
                    author: { identifier: 'owner', name: '' },
                  },
                ],
        },
      ],
    },
    isLoading: false,
    isError: false,
    hasNextPage: false,
  }),
}));
afterEach(() => {
  galleryState.error = null;
});
vi.mock('../shared/gallery/hooks/useGalleryFiltersState', () => ({
  useGalleryFiltersState: (records: unknown[]) => ({
    availableColors: [],
    availableTraits: [],
    availableNailLengths: [],
    filters: {
      selectedColors: [],
      selectedTraits: [],
      selectedLength: null,
      exactMatch: false,
    },
    filteredRecords: records,
    totalActiveFilters: 0,
    toggleColor: vi.fn(),
    toggleTrait: vi.fn(),
    toggleLength: vi.fn(),
    setExactMatch: vi.fn(),
    clearAll: vi.fn(),
  }),
}));
vi.mock('../shared/gallery/nailLengthOptions.config', () => ({
  useNailLengthOptions: () => [],
}));
vi.mock(
  '../../components/GalleryFilterOverlay/GalleryFilterOverlay.organism',
  () => ({ GalleryFilterOverlayOrganism: () => null })
);
vi.mock('../../components/GalleryPhotoCard/GalleryPhotoCard.organism', () => ({
  GalleryPhotoCardOrganism: () => <div>PHOTO</div>,
}));

describe('salon contributor filter', () => {
  it('can return to all works after selecting a contributor with no photos', () => {
    renderWithProviders(
      <SalonGalleryOrganism
        salonAccountId='salon'
        selection={{ ids: [], onToggle: vi.fn(), notice: null }}
      />
    );
    const select = screen.getByRole('combobox');
    expect(select).toBeEnabled();
    expect(screen.getByText('PHOTO')).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'stylistFallback' })
    ).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'staff' } });
    expect(select).toBeEnabled();
    expect(screen.getByText('emptyFiltered')).toBeInTheDocument();
    expect(screen.queryByText('addFirstWork')).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: '' } });
    expect(screen.getByText('PHOTO')).toBeInTheDocument();
  });
  it.each([
    [APP_EVENTS.INFO.ACCOUNT.ACCOUNT_NOT_FOUND, true],
    [APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, false],
  ])(
    'refreshes team availability only for a not-found response (%s)',
    async (event, shouldRefresh) => {
      galleryState.error = Object.assign(new Error(event), {
        httpError: { event },
      });
      const onUnavailable = vi.fn();
      renderWithProviders(
        <SalonGalleryOrganism
          salonAccountId='salon'
          audience='team'
          onUnavailable={onUnavailable}
        />
      );
      await waitFor(() =>
        expect(onUnavailable).toHaveBeenCalledTimes(shouldRefresh ? 1 : 0)
      );
    }
  );
});
