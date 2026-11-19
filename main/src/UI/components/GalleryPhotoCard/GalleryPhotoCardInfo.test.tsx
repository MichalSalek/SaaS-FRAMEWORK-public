import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import messages from '../../../locales/pl/common.json';
import {
  GalleryPhotoCardOrganism,
  type GalleryRecordView,
} from './GalleryPhotoCard.organism';

const record = {
  gallery_record_id: 'public-photo',
  asset_url: 'https://example.org/public-photo.jpg',
  is_pinned: false,
  created_at: '2026-11-05',
  colors: [{ id: 'red', name: 'Czerwone', hex_code: '#ff0000' }],
  traits: [
    { id: 'french', name: 'French', category: 'technique' },
    { id: 'marble', name: 'Marble', category: 'technique' },
  ],
} as GalleryRecordView;

describe('gallery card metadata', () => {
  it('preserves all traits, share action and footer on the regular card', () => {
    const onShare = vi.fn();
    renderWithProviders(
      <GalleryPhotoCardOrganism
        record={record}
        showShare
        onShare={onShare}
        likeCount={4}
        footer={<span>Autor</span>}
      />,
      { messages }
    );
    expect(screen.getByText('French')).toBeInTheDocument();
    expect(screen.getByText('Marble')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Autor')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Udostępnij zdjęcie stylizacji' })
    );
    expect(onShare).toHaveBeenCalledOnce();
  });

  it('renders a photo-only compact tile that opens the selected photo', () => {
    const open = vi.fn();
    renderWithProviders(
      <GalleryPhotoCardOrganism
        record={record}
        compact
        showShare
        onCardClick={open}
      />,
      { messages }
    );
    expect(screen.getByRole('img', { name: /czerwone/i })).toBeInTheDocument();
    expect(screen.queryByText('French')).not.toBeInTheDocument();
    expect(screen.queryByText('Marble')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Udostępnij zdjęcie stylizacji' })
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Otwórz zdjęcie stylizacji' })
    );
    expect(open).toHaveBeenCalledOnce();
  });
});
