// Thread chrome + composer. Extracted so the thread composition stays under
// the 300-line ceiling (hide/restore, hidden banner, D5 code-point clamp).

import type { KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowLeftIcon,
  EyeSlashIcon,
  PaperPlaneRightIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { MESSAGING_LENGTHS } from '@kernel/policies/validation.config';
import { countCodePoints } from '@kernel/policies/validation/validation.utils';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import styles from './MessageThreadPage.module.css';

export const CONTENT_MAX = MESSAGING_LENGTHS.CONTENT_MAX;
const COUNTER_REVEAL_AT = CONTENT_MAX - 200;

export function clampComposerContent(value: string, max = CONTENT_MAX): string {
  return Array.from(value).slice(0, max).join('');
}

/**
 * Who the thread is with + the way back + „hide”.
 *
 * A hidden thread shows NO header action: the banner right below carries
 * „restore” with its explanation, and the same action twice on one screen was
 * the duplicate the owner called sprawling (2026-10-08).
 */
export function ThreadHeaderMolecule({
  name,
  avatarUrl,
  isReady,
  canHide,
  hidePending,
  onHide,
}: {
  /** Empty string = the API withheld the name (see `unnamedPerson`). */
  name: string;
  avatarUrl: string | null;
  /** Thread meta loaded: until then no avatar and no action are drawn. */
  isReady: boolean;
  canHide: boolean;
  hidePending: boolean;
  onHide: () => void;
}) {
  const t = useTranslations('pages.messaging');
  const shownName = name.trim() || t('unnamedPerson');
  return (
    <header className={styles.header}>
      <LinkButtonAtom
        href={ROUTES_FRONT.MESSAGES}
        variant='ghost'
        size='sm'
        icon={<ArrowLeftIcon size={16} />}
        aria-label={t('back')}
      />
      {isReady && (
        <AvatarAtom
          src={avatarUrl ?? undefined}
          name={shownName}
          size='sm'
          decorative
        />
      )}
      <span className={styles.headerName}>{isReady ? shownName : ''}</span>
      {isReady && canHide && (
        <ButtonAtom
          variant='ghost'
          size='sm'
          className={styles.headerAction}
          ariaLabel={t('hideConversation')}
          title={t('hideConversation')}
          disabled={hidePending}
          onClick={onHide}
          icon={<EyeSlashIcon size={18} />}
        />
      )}
    </header>
  );
}

export function HiddenThreadBannerMolecule({
  restorePending,
  onRestore,
}: {
  restorePending: boolean;
  onRestore: () => void;
}) {
  const t = useTranslations('pages.messaging');
  return (
    <div className={styles.hiddenBanner}>
      <p className={styles.hiddenBannerText}>{t('hiddenHint')}</p>
      <ButtonAtom
        variant='outlined'
        size='sm'
        disabled={restorePending}
        onClick={onRestore}>
        {t('restoreConversation')}
      </ButtonAtom>
    </div>
  );
}

export function ThreadComposerMolecule({
  content,
  onContentChange,
  onSend,
  onKeyDown,
  sendPending,
  shake,
  onShakeEnd,
}: {
  content: string;
  onContentChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  sendPending: boolean;
  shake: boolean;
  onShakeEnd: () => void;
}) {
  const t = useTranslations('pages.messaging');
  const pointCount = countCodePoints(content);
  const showCounter = pointCount >= COUNTER_REVEAL_AT;
  const overLimit = pointCount > CONTENT_MAX;

  return (
    <div className={styles.composer}>
      {/* The counter hangs in the composer's top padding (absolute), so its
          arrival 200 characters before the limit moves nothing. */}
      {showCounter && (
        <span className={styles.counter}>
          {pointCount} / {CONTENT_MAX}
        </span>
      )}
      <textarea
        className={styles.input}
        value={content}
        onChange={e =>
          onContentChange(clampComposerContent(e.target.value, CONTENT_MAX))
        }
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={t('inputPlaceholder')}
        aria-label={t('inputPlaceholder')}
      />
      {/* While sending, the plane becomes a spinner INSIDE the same 44px
          button: the composer keeps its geometry. */}
      <ButtonAtom
        variant='primary'
        size='md'
        className={styles.sendButton}
        onClick={onSend}
        disabled={!sendPending && (content.trim().length === 0 || overLimit)}
        loading={sendPending}
        ariaLabel={t('send')}
        icon={<PaperPlaneRightIcon size={18} weight='fill' />}
        shake={shake}
        onShakeEnd={onShakeEnd}
      />
    </div>
  );
}

/** Loading state of the thread: bubbles on both sides, own ones to the right. */
export function ThreadSkeletonMolecule({ label }: { label: string }) {
  return (
    <div className={styles.skeletonStream} aria-busy='true' aria-label={label}>
      <SkeletonAtom width='62%' height={44} />
      <SkeletonAtom width='48%' height={44} className={styles.skeletonOwn} />
      <SkeletonAtom width='70%' height={64} />
      <SkeletonAtom width='40%' height={44} className={styles.skeletonOwn} />
    </div>
  );
}
