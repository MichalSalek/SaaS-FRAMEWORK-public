import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import messages from '../../../locales/pl/common.json';
import { publicGetGalleryRecordsByAccount_IO } from '../../../domain/gallery/galleryIO.possibilities.api';
import { shareContent } from '../../../application/platform/share';
import { StylistProfileGalleryOrganism } from './StylistProfileGallery.organism';

const state = vi.hoisted(() => ({
  router: {
    pathname: '/stylist/[identifier]',
    asPath: '',
    query: {} as Record<string, string>,
    replace: vi.fn(),
  },
}));
vi.mock('next/router', () => ({ useRouter: () => state.router }));
vi.mock('../../../domain/gallery/galleryIO.possibilities.api', () => ({
  publicGetGalleryRecordsByAccount_IO: vi.fn(),
}));
vi.mock('../../../application/platform/share', () => ({
  shareContent: vi.fn(),
}));
vi.mock('../../shared/hooks/useSessionRole', () => ({
  useIsStylist: () => false,
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({ data: null }),
}));
vi.mock('../../shared/hooks/usePlaygroundVariant', () => ({
  usePlaygroundVariant: () => null,
}));

const response = {
  records: [
    {
      gallery_record_id: 'public-photo',
      asset_url: 'https://example.org/public.jpg',
      colors: [{ id: 'red', name: 'Czerwone', hex_code: '#ff0000' }],
      traits: [
        { id: 'french', name: 'French', category: 'technique' },
        { id: 'marble', name: 'Marble', category: 'technique' },
      ],
      nail_length: 'SHORT',
      created_at: '2026-11-05',
    },
  ],
  total_count: 1,
  show_watermark: true,
  stylist_info: null,
};
const view = () => (
  <StylistProfileGalleryOrganism accountId='stylist' galleryRecordsCount={8} />
);

describe('public pinned photo preview', () => {
  beforeEach(() => {
    state.router.query = {
      identifier: 'anna',
      from: 'qr',
      pairIntent: 'pending',
      locale: 'pl',
    };
    state.router.asPath =
      '/stylist/anna/?from=qr&pairIntent=pending&locale=pl#kontakt';
    state.router.replace.mockReset();
    vi.mocked(publicGetGalleryRecordsByAccount_IO).mockResolvedValue(
      response as never
    );
    vi.mocked(shareContent).mockResolvedValue('clipboard');
    window.history.replaceState({}, '', state.router.asPath);
  });
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('opens only the chosen public photo, keeps context when opening and closing, and shares its link', async () => {
    const { rerender } = renderWithProviders(view(), { messages });
    const trigger = await screen.findByRole('button', {
      name: 'Otwórz zdjęcie stylizacji',
    });
    trigger.focus();
    fireEvent.click(trigger);
    expect(state.router.replace).toHaveBeenLastCalledWith(
      {
        pathname: '/stylist/[identifier]',
        query: { ...state.router.query, photo: 'public-photo' },
      },
      '/stylist/anna/?from=qr&pairIntent=pending&locale=pl&photo=public-photo#kontakt',
      { shallow: true, scroll: false }
    );
    const openedAs = state.router.replace.mock.lastCall?.[1] as string;
    const openedUrl = new URL(openedAs, window.location.origin);
    expect(openedUrl.pathname).toBe('/stylist/anna/');
    expect(openedUrl.hash).toBe('#kontakt');
    expect(Object.fromEntries(openedUrl.searchParams)).toEqual({
      from: 'qr',
      pairIntent: 'pending',
      locale: 'pl',
      photo: 'public-photo',
    });
    state.router.asPath = openedAs;
    // Shallow navigation can move focus before the dialog mounts.
    trigger.blur();
    expect(trigger).not.toHaveFocus();
    state.router.query = { ...state.router.query, photo: 'public-photo' };
    rerender(view());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('French')).toBeInTheDocument();
    expect(within(dialog).getByText('Marble')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Długość paznokci: Krótkie/)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('img', { name: /krótkie paznokcie/i })
    ).toHaveAttribute('src', expect.stringContaining('public.jpg'));
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Udostępnij zdjęcie stylizacji',
      })
    );
    await waitFor(() =>
      expect(shareContent).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:3000/stylist/anna/?photo=public-photo',
        })
      )
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(state.router.replace).toHaveBeenLastCalledWith(
      {
        pathname: '/stylist/[identifier]',
        query: {
          identifier: 'anna',
          from: 'qr',
          pairIntent: 'pending',
          locale: 'pl',
        },
      },
      '/stylist/anna/?from=qr&pairIntent=pending&locale=pl#kontakt',
      { shallow: true, scroll: false }
    );
    const closedAs = state.router.replace.mock.lastCall?.[1] as string;
    const closedUrl = new URL(closedAs, window.location.origin);
    expect(closedUrl.pathname).toBe('/stylist/anna/');
    expect(closedUrl.hash).toBe('#kontakt');
    expect(Object.fromEntries(closedUrl.searchParams)).toEqual({
      from: 'qr',
      pairIntent: 'pending',
      locale: 'pl',
    });
    state.router.asPath = closedAs;
    state.router.query = {
      identifier: 'anna',
      from: 'qr',
      pairIntent: 'pending',
      locale: 'pl',
    };
    rerender(view());
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(publicGetGalleryRecordsByAccount_IO).toHaveBeenCalledTimes(1);
  });

  it('keeps a profile URL without a trailing slash without adding one', async () => {
    state.router.asPath =
      '/stylist/anna?from=qr&pairIntent=pending&locale=pl#kontakt';
    const { rerender } = renderWithProviders(view(), { messages });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Otwórz zdjęcie stylizacji' })
    );
    const displayed = state.router.replace.mock.lastCall?.[1] as string;
    const url = new URL(displayed, window.location.origin);
    expect(url.pathname).toBe('/stylist/anna');
    expect(url.hash).toBe('#kontakt');
    expect(url.searchParams.get('photo')).toBe('public-photo');
    expect(url.searchParams.get('from')).toBe('qr');
    expect(url.searchParams.get('pairIntent')).toBe('pending');
    expect(url.searchParams.get('locale')).toBe('pl');
    state.router.asPath = displayed;
    state.router.query = { ...state.router.query, photo: 'public-photo' };
    rerender(view());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    const closed = new URL(
      state.router.replace.mock.lastCall?.[1] as string,
      window.location.origin
    );
    expect(closed.pathname).toBe('/stylist/anna');
    expect(closed.hash).toBe('#kontakt');
    expect(Object.fromEntries(closed.searchParams)).toEqual({
      from: 'qr',
      pairIntent: 'pending',
      locale: 'pl',
    });
  });

  it('does not open or fetch a photo outside the public pins', async () => {
    state.router.query.photo = 'unpublished-photo';
    state.router.asPath = '/stylist/anna/?photo=unpublished-photo';
    renderWithProviders(view(), { messages });
    await screen.findByRole('button', { name: 'Otwórz zdjęcie stylizacji' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(publicGetGalleryRecordsByAccount_IO).toHaveBeenCalledTimes(1);
    expect(publicGetGalleryRecordsByAccount_IO).toHaveBeenCalledWith(
      { account_id: 'stylist' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
