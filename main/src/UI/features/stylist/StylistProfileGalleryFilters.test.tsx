import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import baseMessages from '../../../locales/pl/common.json';
import { publicGetGalleryRecordsByAccount_IO } from '../../../domain/gallery/galleryIO.possibilities.api';
import { StylistProfileGalleryOrganism } from './StylistProfileGallery.organism';

const viewer = vi.hoisted(() => ({ owner: false, stylistMode: false }));
const messages = {
  ...baseMessages,
  stylist: {
    ...baseMessages.stylist,
    gallery: {
      ...baseMessages.stylist.gallery,
      ownerUnpinnedDesc: 'Przypnij istniejącą pracę',
      ownerUnpinnedCta: 'Przejdź do galerii',
    },
  },
};

vi.mock('next/router', () => ({
  useRouter: () => ({
    query: {},
    pathname: '/stylist/[identifier]',
    replace: vi.fn(),
  }),
}));

vi.mock('../../../domain/gallery/galleryIO.possibilities.api', () => ({
  publicGetGalleryRecordsByAccount_IO: vi.fn(),
}));
vi.mock('../../shared/hooks/useSessionRole', () => ({
  useIsStylist: () => viewer.stylistMode,
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: viewer.owner ? { stylist_account: { account_id: 'stylist' } } : null,
  }),
}));
vi.mock('../../shared/hooks/usePlaygroundVariant', () => ({
  usePlaygroundVariant: () => null,
}));
// jsdom has no Web Animations API; keep the real color control and selection logic.
vi.mock('../../components/ColorSwatch/ColorSwatch.motion', () => ({
  useSwatchMotion: () => undefined,
}));
vi.mock('../../components/GalleryPhotoCard/GalleryPhotoCard.organism', () => ({
  GalleryPhotoCardOrganism: ({
    record,
  }: {
    record: { gallery_record_id: string };
  }) => <p>{record.gallery_record_id}</p>,
}));

const red = { id: 'red', name: 'Czerwony', hex_code: '#ff0000' };
const blue = { id: 'blue', name: 'Niebieski', hex_code: '#0000ff' };
const response = {
  records: [
    {
      gallery_record_id: 'public-red',
      colors: [red],
      traits: [],
      nail_length: 'SHORT',
    },
    {
      gallery_record_id: 'public-blue',
      colors: [blue],
      traits: [],
      nail_length: 'LONG',
    },
  ],
  total_count: 2,
  show_watermark: false,
  stylist_info: null,
};

function renderGallery(galleryRecordsCount = 8) {
  return renderWithProviders(
    <StylistProfileGalleryOrganism
      accountId='stylist'
      galleryRecordsCount={galleryRecordsCount}
    />,
    { messages }
  );
}

describe('public pinned gallery filtering', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('places the filter beside the heading and clears mobile selections on desktop resize', async () => {
    let listener: ((event: { matches: boolean }) => void) | undefined;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: (_: string, callback: typeof listener) => {
          listener = callback;
        },
        removeEventListener: vi.fn(),
      }))
    );
    renderGallery();
    await screen.findByText('public-red');
    const heading = screen.getByRole('heading', {
      name: 'Przypięte wzory (2)',
    });
    const button = screen.getByRole('button', { name: 'Filtry' });
    expect(heading.parentElement).toBe(button.parentElement);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: /czerwony/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż 1 pracę' }));
    expect(screen.queryByText('public-blue')).not.toBeInTheDocument();
    await import('@testing-library/react').then(({ act }) =>
      act(() => listener?.({ matches: true }))
    );
    expect(screen.getByText('public-blue')).toBeInTheDocument();
    expect(screen.getByText('public-red')).toBeInTheDocument();
  });

  beforeEach(() => {
    viewer.owner = false;
    viewer.stylistMode = false;
    vi.mocked(publicGetGalleryRecordsByAccount_IO).mockResolvedValue(
      response as never
    );
  });

  it('filters the public response without changing portfolio counts or requesting paired data', async () => {
    renderGallery();
    await screen.findByText('public-red');
    fireEvent.click(screen.getByRole('button', { name: 'Filtry' }));
    fireEvent.click(screen.getByRole('button', { name: /czerwony/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż 1 pracę' }));
    expect(screen.getByText('public-red')).toBeInTheDocument();
    expect(screen.queryByText('public-blue')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Przypięte wzory (2)' })
    ).toBeInTheDocument();
    expect(screen.getByText('+ 6 prac w pełnej galerii')).toBeInTheDocument();
    expect(screen.getByText('1 z 2', { exact: false })).toBeInTheDocument();
    expect(publicGetGalleryRecordsByAccount_IO).toHaveBeenCalledTimes(1);
    expect(publicGetGalleryRecordsByAccount_IO).toHaveBeenCalledWith(
      { account_id: 'stylist' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(screen.queryByText('private-work')).not.toBeInTheDocument();
  });

  it('distinguishes a filter with no match from an empty portfolio and restores pins on clear', async () => {
    const { container } = renderGallery();
    await screen.findByText('public-red');
    fireEvent.click(screen.getByRole('button', { name: 'Filtry' }));
    fireEvent.click(screen.getByRole('button', { name: /czerwony/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Długie' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż 0 prac' }));
    expect(
      screen.getByText('Nie ma prac pasujących do filtrów')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Nie ma tu jeszcze prac')
    ).not.toBeInTheDocument();
    // The real sheet animates out via CSS; jsdom keeps its portal queryable.
    fireEvent.click(
      within(container).getByRole('button', { name: 'Wyczyść filtry' })
    );
    expect(screen.getByText('public-red')).toBeInTheDocument();
    expect(screen.getByText('public-blue')).toBeInTheDocument();
  });

  it('keeps the three option groups, match mode and clear behavior together', async () => {
    const trait = { id: 'french', name: 'French', category: 'technique' };
    vi.mocked(publicGetGalleryRecordsByAccount_IO).mockResolvedValue({
      ...response,
      records: response.records.map(record => ({ ...record, traits: [trait] })),
    } as never);
    renderGallery();
    await screen.findByText('public-red');
    fireEvent.click(screen.getByRole('button', { name: 'Filtry' }));
    expect(
      screen.getByRole('group', { name: 'Cechy stylizacji' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Paleta kolorów' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Długość paznokci' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /czerwony/i }));
    fireEvent.click(screen.getByRole('button', { name: /niebieski/i }));
    expect(
      screen.getByRole('button', { name: 'Pokaż 2 prace' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /wszystkie/i }));
    expect(
      screen.getByRole('button', { name: 'Pokaż 0 prac' })
    ).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Wyczyść filtry',
      })
    );
    expect(
      screen.getByRole('button', { name: 'Pokaż 2 prace' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /czerwony/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('does not offer filters when the loaded public portfolio is empty', async () => {
    vi.mocked(publicGetGalleryRecordsByAccount_IO).mockResolvedValue({
      ...response,
      records: [],
    } as never);
    renderGallery();
    await screen.findByText(messages.stylist.gallery.empty);
    expect(
      screen.queryByRole('button', { name: 'Filtry' })
    ).not.toBeInTheDocument();
  });
  it.each([
    [0, '/app/gallery/upload-asset', 'ownerEmptyCta'],
    [8, '/app/gallery', 'ownerUnpinnedCta'],
  ] as const)(
    'offers the owner the right action with %i non-hidden works',
    async (count, href, label) => {
      viewer.owner = true;
      viewer.stylistMode = true;
      vi.mocked(publicGetGalleryRecordsByAccount_IO).mockResolvedValue({
        ...response,
        records: [],
      } as never);
      renderGallery(count);
      expect(
        await screen.findByRole('link', {
          name: messages.stylist.gallery[label],
        })
      ).toHaveAttribute('href', href);
    }
  );

  it('does not offer gallery management to the owner in client mode', async () => {
    viewer.owner = true;
    vi.mocked(publicGetGalleryRecordsByAccount_IO).mockResolvedValue({
      ...response,
      records: [],
    } as never);
    renderGallery(8);
    await screen.findByText(messages.stylist.gallery.empty);
    expect(
      screen.queryByRole('link', {
        name: messages.stylist.gallery.ownerUnpinnedCta,
      })
    ).not.toBeInTheDocument();
  });

  it('does not reveal a private-gallery explanation to visitors with no public pins', async () => {
    vi.mocked(publicGetGalleryRecordsByAccount_IO).mockResolvedValue({
      ...response,
      records: [],
    } as never);
    renderGallery(8);
    await screen.findByText(messages.stylist.gallery.empty);
    expect(
      screen.queryByText(
        'Stylistka nie pokazała jeszcze prac na profilu. Po połączeniu zobaczysz całą jej galerię.'
      )
    ).not.toBeInTheDocument();
  });
});
