// UI/features/messaging/MessageThreadPage.composition.tsx
// 1:1 thread. Hide is mute for this viewer (D2); sending while hidden is
// allowed and does not unhide. Composer clamps by Unicode code points (D5).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ChatCircleDotsIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { countCodePoints } from '@kernel/policies/validation/validation.utils';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { useMessageThread } from './hooks/useMessageThread';
import { useTrackSessionConversation } from './hooks/useTrackSessionConversation';
import { useSendMessage } from './hooks/useSendMessage';
import { useMarkRead } from './hooks/useMarkRead';
import { useContactComposerFocus } from './hooks/useContactComposerFocus';
import {
  composerDraftKey,
  useComposerDraft,
} from '../shared/messaging/hooks/useComposerDraft';
import {
  useHideConversation,
  useUnhideConversation,
} from './hooks/useHideConversation';
import {
  CONTENT_MAX,
  HiddenThreadBannerMolecule,
  ThreadComposerMolecule,
  ThreadHeaderMolecule,
  ThreadSkeletonMolecule,
} from './MessageThreadPage.parts.molecule';
import { ThreadMessagesMolecule } from './MessageThreadPage.stream.molecule';
import { EndContactDialogMolecule } from './EndContactDialog.molecule';
import { counterpartNavigation } from './messaging-counterpart-navigation';
import styles from './MessageThreadPage.module.css';

export function MessageThreadPageComposition() {
  const t = useTranslations('pages.messaging');
  const tButtons = useTranslations('buttons');
  const router = useRouter();
  const [endContactOpen, setEndContactOpen] = useState(false);
  const pairId =
    typeof router.query.pairId === 'string' ? router.query.pairId : '';

  const {
    meta,
    messages,
    readThrough,
    isLoading,
    isError,
    isFetching,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    refetch,
  } = useMessageThread(pairId);
  useTrackSessionConversation(pairId, meta);

  const handleLoadOlder = async () => {
    const el = streamRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    await loadOlder();
    requestAnimationFrame(() => {
      const el2 = streamRef.current;
      if (el2 != null) {
        el2.scrollTop = prevTop + (el2.scrollHeight - prevHeight);
      }
      if (document.activeElement === document.body) {
        el2?.focus();
      }
    });
  };
  const sendMutation = useSendMessage(pairId);
  const markRead = useMarkRead();
  const hide = useHideConversation();
  const unhide = useUnhideConversation();

  const draftKey = composerDraftKey('messaging', pairId);
  const {
    value: content,
    setValue: setContent,
    restoreInto: restoreDraft,
  } = useComposerDraft(draftKey);
  const [shake, setShake] = useState(false);
  const [confirmedMessage, setConfirmedMessage] = useState<{
    pairId: string;
    id: string;
  } | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useContactComposerFocus(pairId, meta?.can_send === true, composerRef);
  const atBottomRef = useRef(true);
  const lastMarkedRef = useRef<string | null>(null);
  const markReadAttemptsRef = useRef(new Map<string, number>());
  const { mutate: markReadMutate } = markRead;

  const latestId =
    messages.length > 0 ? messages[messages.length - 1]?.id : null;

  const handleStreamScroll = () => {
    const el = streamRef.current;
    if (el == null) {
      return;
    }
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // DECISION: the newest message is on screen in the FIRST painted frame. These are layout effects
  // (the passive version painted the top of the history, then jumped), and they move the stream's
  // own scrollTop instead of `scrollIntoView`, which also scrolled every ancestor. The page stays
  // mounted across thread -> thread navigation, so "was at the bottom" is reset per conversation:
  // otherwise a thread opened after scrolling up in the previous one started in the middle of its
  // history.
  const messagesRef = useRef(messages);
  const metaRef = useRef(meta);
  useLayoutEffect(() => {
    messagesRef.current = messages;
    metaRef.current = meta;
  }, [messages, meta]);
  useLayoutEffect(() => {
    atBottomRef.current = true;
  }, [pairId]);
  useLayoutEffect(() => {
    const msgs = messagesRef.current;
    const viewerMeta = metaRef.current;
    const last = msgs[msgs.length - 1];
    const mineLast =
      viewerMeta != null &&
      last != null &&
      last.sender_type === viewerMeta.viewer_side;
    const el = streamRef.current;
    if (el != null && (atBottomRef.current || mineLast)) {
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
    }
  }, [latestId]);

  useEffect(() => {
    if (pairId.length === 0 || meta == null || readThrough == null) {
      return;
    }
    const marker = `${pairId}:${String(readThrough)}`;
    if (lastMarkedRef.current === marker) {
      return;
    }
    lastMarkedRef.current = marker;
    markReadMutate(
      { pairId, readThrough },
      {
        onError: () => {
          const attempts = (markReadAttemptsRef.current.get(marker) ?? 0) + 1;
          markReadAttemptsRef.current.set(marker, attempts);
          if (attempts < 2 && lastMarkedRef.current === marker) {
            lastMarkedRef.current = null;
          }
        },
      }
    );
  }, [pairId, meta, readThrough, markReadMutate]);

  useEffect(() => {
    setConfirmedMessage(null);
  }, [pairId]);

  const handleSend = () => {
    const trimmed = content.trim();
    if (trimmed.length === 0 || countCodePoints(trimmed) > CONTENT_MAX) {
      setShake(true);
      return;
    }
    if (sendMutation.isPending || draftKey === null) {
      return;
    }
    // Restore into the draft of the thread the message was SENT to: the page
    // stays mounted across thread → thread navigation, so "current" may be
    // another conversation by the time the request fails.
    const sentKey = draftKey;
    setContent('');
    sendMutation.mutate(trimmed, {
      onSuccess: response =>
        setConfirmedMessage({ pairId, id: response.message.id }),
      onError: () => {
        restoreDraft(sentKey, trimmed);
        setShake(true);
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isDesktop =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ===
        true;
    // `isComposing`: Enter that confirms an IME candidate must not send.
    if (
      isDesktop &&
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      handleSend();
    }
  };

  const isHidden = meta?.hidden_at != null;
  const { profileHref, requestHref, isPendingRequest } =
    counterpartNavigation(meta);
  // Restore lives in the banner; the header offers only „hide”, and only for
  // a conversation that has something to hide.
  const canHide = !isHidden && (messages.length > 0 || hasOlder);

  const handleHide = () => {
    if (pairId.length === 0) {
      return;
    }
    hide.mutate(pairId, {
      onSuccess: () => {
        void router.replace(ROUTES_FRONT.MESSAGES);
      },
    });
  };

  const handleRestore = () => {
    if (pairId.length === 0) {
      return;
    }
    unhide.mutate(pairId);
  };

  return (
    // The app bar owns „Wróć” (history-aware: a thread opened from a client
    // card or a session returns there). A second back arrow in the thread
    // header always went to the inbox and sat under an empty bar slot.
    <AppLayoutComposition title={t('conversation')} contentMode='fill'>
      <div className={styles.page}>
        <ThreadHeaderMolecule
          name={meta?.counterpart_name ?? ''}
          avatarUrl={meta?.counterpart_avatar_url ?? null}
          viewerSide={meta?.viewer_side ?? null}
          profileHref={profileHref}
          requestHref={requestHref}
          isPendingRequest={isPendingRequest}
          onNavigate={href => void router.push(href)}
          isReady={meta != null}
          canHide={canHide}
          hidePending={hide.isPending}
          onHide={handleHide}
          canEndContact={meta?.relationship_state === 'CONTACT'}
          onEndContact={() => setEndContactOpen(true)}
        />

        {isHidden && (
          <HiddenThreadBannerMolecule
            restorePending={unhide.isPending}
            onRestore={handleRestore}
          />
        )}
        <EndContactDialogMolecule
          pairId={pairId}
          open={endContactOpen}
          onOpenChange={setEndContactOpen}
        />

        <div
          className={styles.stream}
          ref={streamRef}
          tabIndex={-1}
          onScroll={handleStreamScroll}>
          {isLoading ? (
            <ThreadSkeletonMolecule label={t('loading')} />
          ) : isError && (meta == null || messages.length === 0) ? (
            // Only when nothing is on screen. The thread polls every 15 s; one
            // failed poll must not blank a conversation already on screen
            // (TQ v5 keeps the last data, the accumulator keeps the messages).
            // An EMPTY thread under a failed poll is unconfirmed: retry, not
            // "no messages yet".
            <ErrorStateMolecule
              message={t('loadError')}
              retryLabel={tButtons('retry')}
              onRetry={() => void refetch()}
              isRetrying={isFetching}
            />
          ) : messages.length === 0 ? (
            <EmptyStateAtom
              className={styles.emptyStream}
              size='panel'
              titleAs='p'
              icon={<ChatCircleDotsIcon size={28} weight='duotone' />}
              title={t('emptyThreadTitle')}
              {...(meta?.can_send === true
                ? { description: t('emptyThreadText') }
                : {})}
            />
          ) : (
            <ThreadMessagesMolecule
              messages={messages}
              confirmedMessageId={
                confirmedMessage?.pairId === pairId
                  ? confirmedMessage.id
                  : undefined
              }
              viewerSide={meta?.viewer_side ?? null}
              hasOlder={hasOlder}
              isLoadingOlder={isLoadingOlder}
              onLoadOlder={() => void handleLoadOlder()}
            />
          )}
        </div>

        {meta == null ? null : !meta.can_send ? (
          <div className={styles.closedBanner}>{t('conversationClosed')}</div>
        ) : (
          <ThreadComposerMolecule
            inputRef={composerRef}
            content={content}
            onContentChange={setContent}
            onSend={handleSend}
            onKeyDown={handleKeyDown}
            sendPending={sendMutation.isPending}
            shake={shake}
            onShakeEnd={() => setShake(false)}
          />
        )}
      </div>
    </AppLayoutComposition>
  );
}
