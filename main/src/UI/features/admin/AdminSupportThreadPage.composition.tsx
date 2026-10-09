// UI/features/admin/AdminSupportThreadPage.composition.tsx
// Admin support thread: the conversation and the reply box in the doing
// column, the person, the status and the admin's notes in the reading column
// (two columns from 720px of the page's own width, one below).

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/router';
import { CaretLeftIcon, ChatCircleDotsIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useAdminSupportThreadMessages } from './hooks/useAdminSupportThreadMessages';
import { useAdminReplyToThread } from './hooks/useAdminReplyToThread';
import { useAdminChangeThreadStatus } from './hooks/useAdminChangeThreadStatus';
import type { SupportThreadStatus } from '@kernel/models/support/support.dto';
import {
  MessagesSkeletonMolecule,
  ThreadConversationOrganism,
} from './AdminSupportThreadPage.parts.organism';
import {
  InternalNotesOrganism,
  ThreadPersonOrganism,
} from './AdminSupportThreadPage.aside.organism';
import { ThreadComposeOrganism } from './AdminSupportThreadPage.compose.organism';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { HeroCountPillAtom } from '../../components/HeroCountPill/HeroCountPill.atom';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { resolveThreadIdentity } from './supportIdentity.helpers';
import { SupportStatusBadgeMolecule } from './components/SupportStatusBadge.molecule';
import styles from './AdminSupportThreadPage.module.css';

// Snackbar niósł surowy enum po angielsku (`closed`) w zdaniu PL/DE — etykiety
// statusów istnieją w tym namespace, więc mapujemy po unii kernela.
const STATUS_LABEL_KEY = {
  OPEN: 'statusOpen',
  RESOLVED: 'statusResolved',
  CLOSED: 'statusClosed',
} as const satisfies Record<SupportThreadStatus, string>;

export function AdminSupportThreadPageComposition() {
  const t = useTranslations('admin.support');
  const tButtons = useTranslations('buttons');
  const router = useRouter();
  const threadId =
    typeof router.query.threadId === 'string'
      ? router.query.threadId
      : undefined;
  const [replyContent, setReplyContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, thread, hasData, isLoading, isFetching, isError, refetch } =
    useAdminSupportThreadMessages(threadId ?? '');
  const replyMutation = useAdminReplyToThread();
  const changeStatusMutation = useAdminChangeThreadStatus();

  // Bring the newest message (and the reply box under it) into view when
  // messages arrive; `nearest` moves nothing when it is already on screen.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [messages.length]);

  const identity = resolveThreadIdentity(thread, {
    name: t('userFallbackName'),
    email: t('userEmailHidden'),
  });

  const handleSendReply = () => {
    const trimmed = replyContent.trim();
    // Enter-to-send bypasses the disabled button: a second Enter while the
    // first reply was in flight sent the same answer twice.
    if (
      trimmed.length === 0 ||
      threadId === undefined ||
      replyMutation.isPending
    ) {
      return;
    }
    // A failure is reported under the field (`hasFailed`), where the typed
    // answer still stands; success is the message appearing in the thread.
    replyMutation.mutate(
      { thread_id: threadId, content: trimmed },
      {
        onSuccess: () => {
          // Clear only what was sent: text typed while the reply was in
          // flight is a new draft, not part of the delivered message.
          setReplyContent(current =>
            current.trim() === trimmed ? '' : current
          );
          pushNewSnackbar(t('replySent'), 'success');
        },
      }
    );
  };

  const handleChangeStatus = (status: SupportThreadStatus) => {
    if (
      threadId === undefined ||
      thread === undefined ||
      thread === null ||
      changeStatusMutation.isPending
    ) {
      return;
    }
    changeStatusMutation.mutate(
      // expected_updated_at = token optimistic-concurrency (finding support-1):
      // swieza odpowiedz usera po zaladowaniu widoku => backend odrzuca stale
      // close jako 409 STALE. Snackbary bledow (statusStale / statusChangeError)
      // i refetch po STALE robi hook useAdminChangeThreadStatus w onError.
      { thread_id: threadId, status, expected_updated_at: thread.updated_at },
      {
        onSuccess: () => {
          pushNewSnackbar(
            t('statusChanged', { status: t(STATUS_LABEL_KEY[status]) }),
            'success'
          );
        },
      }
    );
  };

  if (threadId === undefined) {
    return null;
  }

  const hasThread = thread !== undefined && thread !== null;
  const loadError = (
    <ErrorStateMolecule
      message={t('messagesLoadErrorText')}
      retryLabel={tButtons('retry')}
      onRetry={() => void refetch()}
      isRetrying={isFetching}
    />
  );

  return (
    <AdminPageLayoutComposition
      documentTitle={t('threadPageTitle')}
      eyebrow={t('threadHeroEyebrow')}
      title={
        thread?.subject ??
        (isError ? t('threadPageTitle') : t('threadLoadingTitle'))
      }
      subtitle={
        hasThread
          ? t('threadHeroSubtitle', { id: threadId.slice(0, 8) })
          : undefined
      }
      meta={
        hasThread ? (
          <div className={styles.heroMeta}>
            <SupportStatusBadgeMolecule status={thread.status} t={t} />
            <HeroCountPillAtom>
              {t('heroPillMessages', { count: messages.length })}
            </HeroCountPillAtom>
          </div>
        ) : undefined
      }
      actions={
        <LinkButtonAtom
          size='sm'
          variant='outlined'
          href={ROUTES_FRONT_APP.ADMIN_SUPPORT}
          icon={<CaretLeftIcon size={14} weight='bold' />}>
          {t('backToInbox')}
        </LinkButtonAtom>
      }>
      <PageColumnsMolecule
        main={
          <section
            className={styles.conversation}
            aria-label={t('mainPaneLabel')}>
            {isLoading ? (
              <MessagesSkeletonMolecule />
            ) : isError && (!hasData || messages.length === 0) ? (
              // An empty last read under a failed refresh is unconfirmed:
              // error with retry, not "no messages".
              loadError
            ) : messages.length === 0 ? (
              <EmptyStateAtom
                icon={<ChatCircleDotsIcon size={24} weight='regular' />}
                title={t('noMessages')}
                titleAs='h2'
                description={t('noMessagesText')}
              />
            ) : (
              <div className={styles.bursts}>
                {/* A refresh failed (e.g. right after a reply): the thread
                    below is the last good read, not the current one. */}
                {isError && loadError}
                <ThreadConversationOrganism
                  messages={messages}
                  userIdentity={identity}
                  t={t}
                />
              </div>
            )}
            {hasThread && (
              <ThreadComposeOrganism
                value={replyContent}
                onChange={setReplyContent}
                onSend={handleSendReply}
                isSending={replyMutation.isPending}
                hasFailed={replyMutation.isError}
                isClosed={thread.status === 'CLOSED'}
                t={t}
              />
            )}
            <div ref={messagesEndRef} />
          </section>
        }
        aside={
          hasThread ? (
            <>
              <ThreadPersonOrganism
                identity={identity}
                status={thread.status}
                pendingStatus={
                  changeStatusMutation.isPending
                    ? (changeStatusMutation.variables?.status ?? null)
                    : null
                }
                onStatusChange={handleChangeStatus}
                t={t}
              />
              <InternalNotesOrganism threadId={threadId} t={t} />
            </>
          ) : null
        }
      />
    </AdminPageLayoutComposition>
  );
}
