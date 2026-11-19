// UI/features/gallery/PhotoDetailActions.molecule.tsx
// What a person can DO with one photo: ONE filled main action, then one
// compact row of quiet (outlined) actions.
//
// DECISION: one main action per viewer. Her own photo: "Udostępnij" is the filled action; pin and
// edit share one row without icons (labels and icons do not fit narrow content in Polish, let
// alone German). Deleting is NOT here: it stands in words at the end of the screen
// (`OwnerDeleteActionMolecule`); behind a lone "more" trigger first-time readers answered "there
// is no delete anywhere". Someone else's photo: "Polub" is filled; once liked it turns quiet
// (outlined, filled heart), because the accent belongs to an action still to be taken. A client
// viewing a connected stylist's photo: "Dodaj do sesji inspiracji" is filled, "Polub" quiet under
// it. The line below the button says what the tap will do or has done; it is always there, so
// adding a photo does not move the buttons under it. (owner)

import { useTranslations } from 'next-intl';
import {
  CheckIcon,
  FlagIcon,
  HeartIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import type { PhotoSessionAction } from '../shared/sessions/hooks/usePhotoSessionAction';
import { ShareButtonAtom } from '../../components/ShareButton/ShareButton.atom';
import styles from './PhotoDetailPage.module.css';

interface OwnerActionsProps {
  isPinned: boolean;
  isPinPending: boolean;
  shareUrl: string;
  shareTitle: string;
  onShared: (outcome: 'native' | 'web' | 'clipboard' | false) => void;
  onTogglePin: () => void;
  onEdit: () => void;
}

export function OwnerActionsMolecule({
  isPinned,
  isPinPending,
  shareUrl,
  shareTitle,
  onShared,
  onTogglePin,
  onEdit,
}: OwnerActionsProps) {
  const t = useTranslations('pages.gallery');
  const tShare = useTranslations('share');
  return (
    <div className={styles.actions}>
      <div className={styles.actionRow}>
        <ButtonAtom
          variant='outlined'
          size='md'
          className={`${styles.actionCell} press-feedback`}
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
      </div>
      {/* Sharing a link is not the reason the owner opened this photo; it
          stays in words under the pair. (owner) */}
      <ShareButtonAtom
        quiet
        url={shareUrl}
        title={shareTitle}
        label={tShare('defaultLabel')}
        onShared={onShared}
        className={styles.tertiaryAction}
      />
    </div>
  );
}

/** The owner's destructive action, in words, after everything about the photo. */
export function OwnerDeleteActionMolecule({
  onDelete,
}: {
  onDelete: () => void;
}) {
  const t = useTranslations('pages.gallery');
  return (
    <ButtonAtom
      variant='danger'
      size='md'
      className={styles.deleteAction}
      onClick={onDelete}>
      {t('deletePhoto')}
    </ButtonAtom>
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
  /** A client's session with this photo's stylist; absent for everyone else. */
  sessionAction?: PhotoSessionAction;
}

function sessionLineKey(
  action: Extract<PhotoSessionAction, { kind: 'ready' }>
) {
  if (action.isPicked) {
    return action.isShared ? 'photoSessionInShared' : 'photoSessionInDraft';
  }
  if (action.sessionId === null) {
    return 'photoSessionHintNew';
  }
  return action.isShared ? 'photoSessionHintShared' : 'photoSessionHintDraft';
}

function PhotoSessionBlock({ action }: { action: PhotoSessionAction }) {
  const t = useTranslations('pages.gallery');
  if (action.kind === 'hidden') {
    return null;
  }
  if (action.kind === 'limit') {
    return (
      <>
        <ButtonAtom
          variant='primary'
          size='lg'
          className={styles.mainAction}
          icon={<PlusIcon size={18} />}
          disabled>
          {t('photoSessionAdd')}
        </ButtonAtom>
        <p className={styles.sessionLine}>
          <span>{t('photoSessionLimit')}</span>
          <AppParagraphLinkAtom href={ROUTES_FRONT.CLIENT_SESSIONS}>
            {t('photoSessionLimitLink')}
          </AppParagraphLinkAtom>
        </p>
      </>
    );
  }
  return (
    <>
      <ButtonAtom
        variant={action.isPicked ? 'outlined' : 'primary'}
        size='lg'
        className={`${styles.mainAction} press-feedback`}
        icon={
          action.isPicked ? (
            <CheckIcon size={18} weight='bold' />
          ) : (
            <PlusIcon size={18} />
          )
        }
        onClick={action.toggle}
        loading={action.isPending}
        aria-pressed={action.isPicked}>
        {action.isPicked ? t('photoSessionIn') : t('photoSessionAdd')}
      </ButtonAtom>
      <p className={styles.sessionLine} role='status'>
        <span>{t(sessionLineKey(action))}</span>
        {action.isPicked && action.sessionId !== null && (
          <>
            <AppParagraphLinkAtom
              href={buildRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, {
                sessionId: action.sessionId,
              })}>
              {t('photoSessionOpen')}
            </AppParagraphLinkAtom>
          </>
        )}
      </p>
    </>
  );
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
  sessionAction,
}: ViewerActionsProps) {
  const t = useTranslations('pages.gallery');
  // One filled action: with the session offered, liking is the quiet one.
  const sessionLeads =
    sessionAction !== undefined && sessionAction.kind !== 'hidden';
  return (
    <div className={styles.actions}>
      {sessionAction !== undefined && (
        <PhotoSessionBlock action={sessionAction} />
      )}
      <ButtonAtom
        variant={isFavorited || sessionLeads ? 'outlined' : 'primary'}
        size={sessionLeads ? 'md' : 'lg'}
        className={`${styles.mainAction} press-feedback`}
        icon={<HeartIcon size={18} weight={isFavorited ? 'fill' : 'regular'} />}
        onClick={onToggleLike}
        disabled={isLikePending}
        aria-pressed={isFavorited}>
        {isFavorited ? t('liked') : t('like')}
      </ButtonAtom>
      <div className={styles.quietRow}>
        <ShareButtonAtom
          quiet
          url={shareUrl}
          title={shareTitle}
          className={styles.tertiaryAction}
        />
        {showReport && (
          <ButtonAtom
            variant='text'
            size='md'
            className={styles.tertiaryAction}
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
