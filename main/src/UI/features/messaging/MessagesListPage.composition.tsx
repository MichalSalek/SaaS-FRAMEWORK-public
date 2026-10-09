// UI/features/messaging/MessagesListPage.composition.tsx
// Inbox: who, when and what, unread first. Hide/restore is mute for this
// viewer only (D2). Filter is local, not persisted. The main action of the
// screen is opening a conversation: every row is a link.

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChatCircleDotsIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { useConversations } from './hooks/useConversations';
import {
  useHideConversation,
  useUnhideConversation,
} from './hooks/useHideConversation';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import {
  ConversationListSkeletonMolecule,
  ConversationRowMolecule,
  InboxFilterMolecule,
} from './MessagesListPage.parts.molecule';
import { sortUnreadFirst } from './messaging.helpers';
import styles from './MessagesListPage.module.css';

export function MessagesListPageComposition() {
  const t = useTranslations('pages.messaging');
  const tButtons = useTranslations('buttons');
  const [showHidden, setShowHidden] = useState(false);
  const {
    conversations: loaded,
    isLoading,
    isError,
    isFetching,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    dropLocal,
    hasData,
    refetch,
  } = useConversations(showHidden);
  const hide = useHideConversation();
  const unhide = useUnhideConversation();

  // What waits for the reader comes first (DECISION in messaging.helpers).
  const conversations = useMemo(() => sortUnreadFirst(loaded), [loaded]);
  // Unread THREADS, not messages: the number matches the dots in the list.
  const unreadTotal = conversations.filter(c => c.unread_count > 0).length;
  // With older pages behind the cursor the loaded length is a lower bound,
  // not „how many conversations you have”: the count waits for a full list.
  const showCount = !hasOlder;
  const showMeta =
    hasData && conversations.length > 0 && (showCount || unreadTotal > 0);
  // ONE meta piece with a comma: two pieces make the hero draw a middle dot
  // between them, which the owner banned as punctuation (2026-10-08).
  const heroMeta = showMeta ? (
    <span>
      {showCount && (
        <>
          <strong>{conversations.length}</strong>{' '}
          {t('heroMetaConversations', { count: conversations.length })}
        </>
      )}
      {showCount && unreadTotal > 0 && ', '}
      {unreadTotal > 0 && (
        <>
          <strong>{unreadTotal}</strong>{' '}
          {t('heroMetaUnread', { count: unreadTotal })}
        </>
      )}
    </span>
  ) : undefined;

  return (
    <AppLayoutComposition title={t('title')}>
      <div className={styles.page}>
        <AppHeroOrganism title={t('title')} meta={heroMeta} />
        <PageColumnsMolecule
          main={
            <>
              <InboxFilterMolecule
                showHidden={showHidden}
                onShowHiddenChange={setShowHidden}
              />

              {isLoading ? (
                // Skeleton in the geometry of the list, so nothing moves when
                // the conversations arrive (owner 2026-10-08).
                <ConversationListSkeletonMolecule label={t('loading')} />
              ) : isError && (!hasData || conversations.length === 0) ? (
                // Full error only with nothing on screen: the inbox polls every
                // 30 s and one failed poll must not replace conversations
                // already shown. An EMPTY cached inbox under a failed poll is
                // not a confirmed empty inbox, so it gets the error and retry,
                // not the "pair a client" CTA.
                <ErrorStateMolecule
                  message={t('loadError')}
                  retryLabel={tButtons('retry')}
                  onRetry={() => void refetch()}
                  isRetrying={isFetching}
                />
              ) : conversations.length === 0 ? (
                <EmptyStateAtom
                  className={styles.empty}
                  size='page'
                  titleAs='h2'
                  icon={<ChatCircleDotsIcon size={36} weight='duotone' />}
                  title={showHidden ? t('emptyHiddenTitle') : t('emptyTitle')}
                  description={
                    showHidden ? t('emptyHiddenText') : t('emptyText')
                  }
                  action={
                    showHidden ? (
                      <ButtonAtom
                        variant='outlined'
                        size='md'
                        onClick={() => setShowHidden(false)}>
                        {t('emptyHiddenCta')}
                      </ButtonAtom>
                    ) : (
                      <LinkButtonAtom
                        direction='forward'
                        variant='primary'
                        size='md'
                        href={ROUTES_FRONT.PAIRING}>
                        {t('emptyCta')}
                      </LinkButtonAtom>
                    )
                  }
                />
              ) : (
                <ul className={styles.list}>
                  {conversations.map(c => (
                    <li key={c.pair_id}>
                      <ConversationRowMolecule
                        conversation={c}
                        showHidden={showHidden}
                        onHide={pairId =>
                          hide.mutate(pairId, {
                            onSuccess: () => dropLocal(pairId),
                          })
                        }
                        onRestore={pairId =>
                          unhide.mutate(pairId, {
                            onSuccess: () => dropLocal(pairId),
                          })
                        }
                        actionPending={
                          showHidden
                            ? unhide.isPending && unhide.variables === c.pair_id
                            : hide.isPending && hide.variables === c.pair_id
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
              {hasOlder && (
                <div className={styles.loadOlderRow}>
                  {/* The label stays while the page loads: a swapped label
                      changed the button's width under the finger. */}
                  <ButtonAtom
                    variant='outlined'
                    size='sm'
                    loading={isLoadingOlder}
                    onClick={() => void loadOlder()}>
                    {t('loadOlderConversations')}
                  </ButtonAtom>
                </div>
              )}
            </>
          }
        />
      </div>
    </AppLayoutComposition>
  );
}
