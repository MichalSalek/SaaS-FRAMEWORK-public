import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { SquaresFourIcon, RowsIcon } from '@phosphor-icons/react';
import styles from './GalleryLayoutToggle.module.css';

/* ─── Types ─── */

export type GalleryLayout = 'tiles' | 'full-width';

export interface GalleryLayoutToggleProps {
  layout: GalleryLayout;
  onToggle: () => void;
  className?: string;
}

/* ─── Component ─── */

export function GalleryLayoutToggleAtom({
  layout,
  onToggle,
  className,
}: GalleryLayoutToggleProps) {
  const t = useTranslations('galleryUI');

  return (
    <div className={clsx(styles.toggle, className)}>
      <button
        type='button'
        className={clsx(
          styles.option,
          layout === 'full-width' && styles.active
        )}
        onClick={layout !== 'full-width' ? onToggle : undefined}
        aria-label={t('layoutFullWidth')}
        aria-pressed={layout === 'full-width'}>
        <RowsIcon size={18} />
      </button>
      <button
        type='button'
        className={clsx(styles.option, layout === 'tiles' && styles.active)}
        onClick={layout !== 'tiles' ? onToggle : undefined}
        aria-label={t('layoutTiles')}
        aria-pressed={layout === 'tiles'}>
        <SquaresFourIcon size={18} />
      </button>
    </div>
  );
}
