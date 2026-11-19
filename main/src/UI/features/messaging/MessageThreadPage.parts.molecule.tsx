// Thread chrome + composer. Extracted so the thread composition stays under
// the 300-line ceiling (hide/restore, hidden banner, D5 code-point clamp).

import { useId, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { CaretRightIcon, PaperPlaneRightIcon } from '@phosphor-icons/react';
import { MESSAGING_LENGTHS } from '@kernel/policies/validation.config';
import { countCodePoints } from '@kernel/policies/validation/validation.utils';
import type { MessagingThreadMeta } from '@kernel/models/messaging/messaging.dto';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import { AppMenuAtom } from '../../primitives/AppMenu.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import {
  MessagingCounterpartAvatarMolecule,
  useCounterpartLabel,
} from './MessagingCounterpart.molecule';
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
  viewerSide,
  profileHref,
  requestHref,
  isPendingRequest,
  onNavigate,
  isReady,
  canHide,
  hidePending,
  onHide,
  canEndContact,
  onEndContact,
}: {
  /** The API may return an empty name for either side. */
  name: string;
  avatarUrl: string | null;
  viewerSide: MessagingThreadMeta['viewer_side'] | null;
  profileHref: string | null;
  requestHref: string | null;
  isPendingRequest: boolean;
  onNavigate: (href: string) => void;
  /** Thread meta loaded: until then no avatar and no action are drawn. */
  isReady: boolean;
  canHide: boolean;
  hidePending: boolean;
  onHide: () => void;
  canEndContact: boolean;
  onEndContact: () => void;
}) {
  const t = useTranslations('pages.messaging');
  const tActions = useTranslations('stylist.actions');
  const shownName = useCounterpartLabel(name, viewerSide);
  const statusId = useId();
  const identity = (
    <>
      <MessagingCounterpartAvatarMolecule
        avatarUrl={avatarUrl}
        name={name}
        size='sm'
      />
      <span className={styles.headerIdentityText}>
        <span className={styles.headerName}>{shownName}</span>
        {isPendingRequest && (
          <span id={statusId} className={styles.headerStatus}>
            {tActions('requestPending')}
          </span>
        )}
      </span>
    </>
  );
  return (
    <header className={styles.header}>
      {isReady &&
        (profileHref ? (
          <AppLinkAtom
            className={styles.headerIdentityLink}
            href={profileHref}
            aria-label={`${t('viewProfile')}: ${shownName}`}
            aria-describedby={isPendingRequest ? statusId : undefined}>
            {identity}
            <CaretRightIcon size={16} aria-hidden='true' />
          </AppLinkAtom>
        ) : (
          <span className={styles.headerIdentity}>{identity}</span>
        ))}
      {isReady && (profileHref || canHide || canEndContact) && (
        // The second action is the shared „more” menu in words, like the
        // inbox row: a bare crossed-eye pictogram did not say what it does.
        <AppMenuAtom>
          <AppMenuAtom.MoreTrigger
            className={styles.headerAction}
            disabled={hidePending}
            label={t('rowMenu')}
          />
          <AppMenuAtom.Content align='end'>
            {requestHref && (
              <AppMenuAtom.Item onClick={() => onNavigate(requestHref)}>
                {t('requestConnection')}
              </AppMenuAtom.Item>
            )}
            {profileHref && (
              <AppMenuAtom.Item onClick={() => onNavigate(profileHref)}>
                {t('viewProfile')}
              </AppMenuAtom.Item>
            )}
            {canHide && (
              <AppMenuAtom.Item disabled={hidePending} onClick={onHide}>
                {t('hideConversation')}
              </AppMenuAtom.Item>
            )}
            {canEndContact && (
              <AppMenuAtom.Item onClick={onEndContact}>
                {t('endContact')}
              </AppMenuAtom.Item>
            )}
          </AppMenuAtom.Content>
        </AppMenuAtom>
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
  inputRef,
}: {
  content: string;
  onContentChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  sendPending: boolean;
  shake: boolean;
  onShakeEnd: () => void;
  inputRef?: React.Ref<HTMLTextAreaElement>;
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
        ref={inputRef}
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
