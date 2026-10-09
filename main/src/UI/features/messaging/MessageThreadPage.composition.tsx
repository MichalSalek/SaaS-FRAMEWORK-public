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
import { useSendMessage } from './hooks/useSendMessage';
import { useMarkRead } from './hooks/useMarkRead';
import { composerDraftKey, useComposerDraft } from './hooks/useComposerDraft';
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
import styles from './MessageThreadPage.module.css';

export function MessageThreadPageComposition() {
  const t = useTranslations('pages.messaging');
  const tButtons = useTranslations('buttons');
  const router = useRouter();
  const pairId =
    typeof router.query.pairId === 'string' ? router.query.pairId : '';

  const {
    meta,
    messages,
    isLoading,
    isError,
    isFetching,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    refetch,
  } = useMessageThread(pairId);

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
  const streamRef = useRef<HTMLDivElement>(null);
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

  // DECISION (nie usuwaj tego komentarza) — S126, 2026-10-08: the newest
  // message is on screen in the FIRST painted frame. These are layout effects
  // (the passive version painted the top of the history, then jumped), and
  // they move the stream's own scrollTop instead of `scrollIntoView`, which
  // also scrolled every ancestor. The page stays mounted across thread →
  // thread navigation, so „was at the bottom” is reset per conversation:
  // otherwise a thread opened after scrolling up in the previous one started
  // in the middle of its history.
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
    if (pairId.length === 0 || meta == null || latestId == null) {
      return;
    }
    const last = messages[messages.length - 1];
    if (last == null || last.sender_type === meta.viewer_side) {
      return;
    }
    if (lastMarkedRef.current === latestId) {
      return;
    }
    lastMarkedRef.current = latestId;
    markReadMutate(pairId, {
      onError: () => {
        const attempts = (markReadAttemptsRef.current.get(latestId) ?? 0) + 1;
        markReadAttemptsRef.current.set(latestId, attempts);
        if (attempts < 2 && lastMarkedRef.current === latestId) {
          lastMarkedRef.current = null;
        }
      },
    });
  }, [pairId, meta, latestId, messages, markReadMutate]);

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
    <AppLayoutComposition
      title={t('conversation')}
      contentMode='fill'
      hideBackButton>
      <div className={styles.page}>
        <ThreadHeaderMolecule
          name={meta?.counterpart_name ?? ''}
          avatarUrl={meta?.counterpart_avatar_url ?? null}
          isReady={meta != null}
          canHide={canHide}
          hidePending={hide.isPending}
          onHide={handleHide}
        />

        {isHidden && (
          <HiddenThreadBannerMolecule
            restorePending={unhide.isPending}
            onRestore={handleRestore}
          />
        )}

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
