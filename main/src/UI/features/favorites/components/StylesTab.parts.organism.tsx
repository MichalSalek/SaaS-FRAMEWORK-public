// UI/features/favorites/components/StylesTab.parts.tsx
// Sub-components for StylesTab: FavoriteCard + SummaryGroupCard.

import { memo, useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { NotePencilIcon } from '@phosphor-icons/react';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { GalleryPhotoCardOrganism } from '../../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import type { GalleryRecordView } from '../../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import { ImagePlaceholderAtom } from '../../../components/ImagePlaceholder/ImagePlaceholder.atom';
import type { FavoriteGroup } from '../hooks/useFavoriteGrouped';
import { getCloudinaryThumbUrl } from '../../../../application/cloudinary/cloudinary-url.utils';
import styles from '../FavoritesPage.module.css';

export type FavoriteRecord =
  FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE']['records'][number];

/** Saves a note; the card closes its editor only on success. */
export type NoteUpdateHandler = (
  galleryRecordId: string,
  note: string | null,
  callbacks: { onSuccess: () => void; onError: () => void }
) => void;

function toGalleryRecordView(record: FavoriteRecord): GalleryRecordView {
  return {
    gallery_record_id: record.gallery_record_id,
    asset_url: record.asset_url,
    // nail_length intentionally omitted — the favorite DTO carries none, and
    // fabricating one made the card's alt text announce a false length (a11y).
    is_pinned: false,
    colors: record.colors,
    traits: record.traits,
    created_at: '',
    created_by_account: {
      account_id: record.stylist_account_id,
      display_name: record.stylist_display_name,
      vanity_url: null,
      address_city: null,
    },
  };
}

export const FavoriteCardOrganism = memo(function FavoriteCard({
  record,
  onRemove,
  onUpdateNote,
  showFooter,
  onCardClick,
}: {
  record: FavoriteRecord;
  onRemove: (galleryRecordId: string) => void;
  onUpdateNote: NoteUpdateHandler;
  showFooter?: boolean;
  onCardClick?: (galleryRecordId: string) => void;
}) {
  const t = useTranslations('pages.favorites');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const view = toGalleryRecordView(record);
  const handleToggle = () => onRemove(record.gallery_record_id);

  const handleOpenEdit = () => {
    setDraft(record.note ?? '');
    setEditing(true);
    // Focus textarea on next tick after render
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // Edytor zamyka się dopiero po POTWIERDZENIU zapisu. Wcześniej zamykał się
  // od razu, a błąd cofał optymistyczną notatkę — wpisany tekst przepadał bez
  // śladu (toast interceptora mówił o błędzie, ale treści już nie było). Teraz
  // przy błędzie szkic zostaje w polu i można zapisać ponownie.
  const handleSave = () => {
    const trimmed = draft.trim();
    setSaving(true);
    onUpdateNote(
      record.gallery_record_id,
      trimmed.length > 0 ? trimmed : null,
      {
        onSuccess: () => {
          setSaving(false);
          setEditing(false);
        },
        onError: () => {
          setSaving(false);
        },
      }
    );
  };

  const handleCancel = () => {
    setEditing(false);
  };

  /* One slot, one look, one height: the note itself (up to two lines) or the
   * invitation to add one. Before S126 an empty slot was a raspberry link and
   * a filled one a grey line cut at ~16 characters next to a 12px icon. */
  const noteRow = editing ? (
    <div className={styles.noteEditArea}>
      <textarea
        ref={textareaRef}
        className={styles.noteTextarea}
        rows={2}
        value={draft}
        placeholder={t('notePlaceholder')}
        aria-label={t('notePlaceholder')}
        // Read-only (not disabled, so focus stays) while the note saves:
        // onSuccess closes the editor, so text typed after „Zapisz” was
        // silently dropped.
        readOnly={saving}
        onChange={e => setDraft(e.target.value)}
      />
      <div className={styles.noteActions}>
        <ButtonAtom
          variant='ghost'
          size='sm'
          onClick={handleCancel}
          disabled={saving}>
          {t('cancel')}
        </ButtonAtom>
        <ButtonAtom
          variant='primary'
          size='sm'
          onClick={handleSave}
          disabled={saving}
          aria-busy={saving || undefined}>
          {t('saveNote')}
        </ButtonAtom>
      </div>
    </div>
  ) : (
    <button
      type='button'
      className={styles.noteButton}
      {...(record.note
        ? { 'aria-label': t('editNoteWithText', { note: record.note }) }
        : {})}
      onClick={handleOpenEdit}>
      <span className={styles.noteButtonIcon} aria-hidden='true'>
        <NotePencilIcon size={16} />
      </span>
      <span
        className={
          record.note ? styles.noteButtonText : styles.noteButtonPlaceholder
        }
        // Her own note, clamped to two lines on purpose (qa:align reads this).
        data-truncate={record.note ? 'content' : undefined}>
        {record.note ? record.note : t('addNote')}
      </span>
    </button>
  );

  const stylistFooter =
    showFooter && record.stylist_display_name ? (
      <div className={styles.styleCardStylist}>
        <AvatarAtom name={record.stylist_display_name} size='sm' decorative />
        <span className={styles.styleCardStylistName}>
          {record.stylist_display_name}
        </span>
      </div>
    ) : undefined;

  const footer = (
    <>
      {stylistFooter}
      {noteRow}
    </>
  );

  return (
    <GalleryPhotoCardOrganism
      record={view}
      showHeart
      isFavorited
      onFavoriteToggle={handleToggle}
      footer={footer}
      {...(onCardClick
        ? { onCardClick: () => onCardClick(record.gallery_record_id) }
        : {})}
    />
  );
});

/* ─── Summary group card (server grouped view) ─── */

const MAX_THUMBS = 4;

function SummaryThumbImg({ src }: { src: string }) {
  // Fallback gdy obraz NIE załaduje się z CDN (404/timeout) — bez tego zniknięty obiekt Cloudinary daje złamaną ikonkę obrazka.
  const [imgError, setImgError] = useState(false);
  return imgError ? (
    <ImagePlaceholderAtom size='sm' className={styles.summaryThumb} />
  ) : (
    <Image
      src={src}
      alt=''
      width={56}
      height={56}
      sizes='56px'
      loading='lazy'
      className={styles.summaryThumb}
      onError={() => setImgError(true)}
    />
  );
}

export function SummaryGroupCardOrganism({ group }: { group: FavoriteGroup }) {
  const t = useTranslations('pages.favorites');
  const tLabels = useTranslations('labels');
  // Parity with StylesTab/StylistsTab: nameless stylist gets the shared
  // fallback, not an empty name and a blank avatar.
  const name = group.stylist_display_name ?? tLabels('stylistFallback');
  const shown = group.recent_favorites.slice(0, MAX_THUMBS);
  const extra = group.favorites_count - shown.length;

  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryCardHeader}>
        <AvatarAtom name={name} size='sm' decorative />
        <span className={styles.groupHeaderText}>
          <span className={styles.summaryCardName}>{name}</span>
          <span className={styles.summaryCardCount}>
            {t('groupedFavoritesCount', { count: group.favorites_count })}
          </span>
        </span>
      </div>
      {shown.length > 0 && (
        <div className={styles.summaryThumbnails}>
          {shown.map(fav => (
            <SummaryThumbImg
              key={fav.favorite_id}
              src={getCloudinaryThumbUrl(fav.image_url, 56)}
            />
          ))}
          {extra > 0 && <div className={styles.summaryThumbMore}>+{extra}</div>}
        </div>
      )}
    </div>
  );
}
