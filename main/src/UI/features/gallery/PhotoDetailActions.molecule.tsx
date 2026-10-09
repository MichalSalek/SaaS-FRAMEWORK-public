// UI/features/gallery/PhotoDetailActions.molecule.tsx
// What a person can DO with one photo: ONE filled main action, then one
// compact row of quiet (outlined) actions.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08 (S126):
// the owner saw a 2×2 pile of four equal buttons and no main action. Now:
//  - her own photo: „Udostępnij” is the filled action (showing the work to a
//    client is why a photo is in the gallery); pin, edit and delete share one
//    row. The row has no icons on purpose: three labelled buttons with icons
//    do not fit 320px of content in Polish, let alone German, and a wrapped
//    third button is the pile again.
//  - someone else's photo: „Polub” is the filled action; once liked it turns
//    quiet (outlined, filled heart) and says so, because the accent belongs
//    to an action still to be taken, not to a state.

import { useTranslations } from 'next-intl';
import { FlagIcon, HeartIcon, ShareNetworkIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ShareButtonAtom } from '../../components/ShareButton/ShareButton.atom';
import styles from './PhotoDetailPage.module.css';

interface OwnerActionsProps {
  isPinned: boolean;
  isPinPending: boolean;
  onShare: () => void;
  onTogglePin: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function OwnerActionsMolecule({
  isPinned,
  isPinPending,
  onShare,
  onTogglePin,
  onEdit,
  onDelete,
}: OwnerActionsProps) {
  const t = useTranslations('pages.gallery');
  const tShare = useTranslations('share');
  return (
    <div className={styles.actions}>
      <ButtonAtom
        variant='primary'
        size='lg'
        className={styles.mainAction}
        icon={<ShareNetworkIcon size={18} />}
        onClick={onShare}>
        {tShare('defaultLabel')}
      </ButtonAtom>
      <div className={styles.actionRow}>
        <ButtonAtom
          variant='outlined'
          size='md'
          className={`${styles.actionCell} haptic-press`}
          onClick={onTogglePin}
          disabled={isPinPending}
          aria-busy={isPinPending || undefined}>
          {isPinned ? t('unpin') : t('pinSimple')}
        </ButtonAtom>
        <ButtonAtom
          variant='outlined'
          size='md'
          className={styles.actionCell}
          onClick={onEdit}>
          {t('editPhoto')}
        </ButtonAtom>
        <ButtonAtom
          variant='outlined'
          size='md'
          className={styles.actionCell}
          onClick={onDelete}>
          {t('deletePhoto')}
        </ButtonAtom>
      </div>
    </div>
  );
}

/* `showReport` is computed by the parent (hydration + auth gate), so this
 * component stays stateless and SSR-safe. */
interface ViewerActionsProps {
  isFavorited: boolean;
  isLikePending: boolean;
  onToggleLike: () => void;
  shareUrl: string;
  shareTitle: string;
  showReport: boolean;
  isReported: boolean;
  onReport: () => void;
}

export function ViewerActionsMolecule({
  isFavorited,
  isLikePending,
  onToggleLike,
  shareUrl,
  shareTitle,
  showReport,
  isReported,
  onReport,
}: ViewerActionsProps) {
  const t = useTranslations('pages.gallery');
  return (
    <div className={styles.actions}>
      <ButtonAtom
        variant={isFavorited ? 'outlined' : 'primary'}
        size='lg'
        className={`${styles.mainAction} haptic-press`}
        icon={<HeartIcon size={18} weight={isFavorited ? 'fill' : 'regular'} />}
        onClick={onToggleLike}
        disabled={isLikePending}
        aria-pressed={isFavorited}>
        {isFavorited ? t('liked') : t('like')}
      </ButtonAtom>
      <div className={styles.actionRow}>
        <ShareButtonAtom
          url={shareUrl}
          title={shareTitle}
          className={styles.actionCell}
        />
        {showReport && (
          <ButtonAtom
            variant='outlined'
            size='md'
            className={styles.actionCell}
            icon={
              <FlagIcon size={16} weight={isReported ? 'fill' : 'regular'} />
            }
            onClick={onReport}
            disabled={isReported}>
            {isReported ? t('reportedPhoto') : t('reportPhoto')}
          </ButtonAtom>
        )}
      </div>
    </div>
  );
}
