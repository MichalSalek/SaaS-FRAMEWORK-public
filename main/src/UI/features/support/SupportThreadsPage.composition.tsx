// UI/features/support/SupportThreadsPage.composition.tsx
// Route SUPPORT_THREADS: the user's support requests on their own screen
// (owner 2026-10-08: at the bottom of the help hub nobody found them).

import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { InfiniteScrollTriggerComposition } from '../../components/InfiniteScrollTrigger.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import {
  useSupportThreads,
  flattenThreadPages,
} from './hooks/useSupportThreads';
import {
  ThreadRowOrganism,
  ThreadListSkeletonMolecule,
  ThreadsEmptyStateOrganism,
} from './SupportThreadsPage.parts.organism';
import styles from './SupportThreadsPage.module.css';

function SupportThreadsPageInner() {
  const t = useTranslations('pages.support');
  useAppBarTitle(t('listThreadsTitle'));

  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
  } = useSupportThreads();
  const threads = flattenThreadPages(data);

  const threadCount = threads.length;
  const hasThreads = threadCount > 0;
  // A number is printed only for a COMPLETE list: with more pages behind the
  // cursor the loaded length is a lower bound, not „how many requests you have”.
  const countKnown = hasThreads && hasNextPage !== true;

  // Full error block only when NOTHING is cached. TQ v5 keeps `data` on a
  // failed background refetch (refocus) and on a failed next page, and both
  // also raise `isError`; replacing the list then hid threads the user had.
  // An EMPTY cached list under an error is unconfirmed, so it gets the error
  // with retry too, not the "no requests yet" empty state.
  const threadsBlock = isLoading ? (
    <ThreadListSkeletonMolecule />
  ) : isError && !hasThreads ? (
    <section
      className={`${styles.errorState} ${styles.staggerIn}`}
      style={{ '--stagger-index': 1 } as CSSProperties}>
      <WarningCircleIcon
        size={36}
        weight='duotone'
        className={styles.errorIcon}
      />
      <p className={styles.errorText}>{t('errorLoadThreads')}</p>
      <ButtonAtom variant='primary' size='sm' onClick={() => void refetch()}>
        {t('retry')}
      </ButtonAtom>
    </section>
  ) : hasThreads ? (
    <>
      <ul className={styles.threadList}>
        {threads.map((thread, idx) => (
          <ThreadRowOrganism
            key={thread.id}
            thread={thread}
            staggerIndex={1 + idx}
            t={t}
          />
        ))}
      </ul>
      {/* The sentinel fires only on an intersection CHANGE, so after a failed
          page it would sit still until the user scrolls away and back: an
          explicit retry instead of a silently truncated list. */}
      {isFetchNextPageError ? (
        <ErrorStateMolecule
          message={t('errorLoadThreads')}
          retryLabel={t('retry')}
          onRetry={() => void fetchNextPage()}
          isRetrying={isFetchingNextPage}
        />
      ) : (
        <InfiniteScrollTriggerComposition
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onFetchNextPage={fetchNextPage}
        />
      )}
    </>
  ) : (
    <ThreadsEmptyStateOrganism
      title={t('listEmptyTitle')}
      body={t('listEmptyBody')}
      ctaLabel={t('emptyStateCta')}
    />
  );

  return (
    <div className={styles.page}>
      {/* Title + the live count in meta (number in <strong>). Empty, loading
          or an incomplete list: no meta. */}
      <AppHeroOrganism
        title={t('listThreadsTitle')}
        meta={
          countKnown ? (
            <span>
              <strong>{threadCount}</strong>{' '}
              {t('listHeroMetaActive', { count: threadCount })}
            </span>
          ) : undefined
        }
      />
      {threadsBlock}
    </div>
  );
}

export function SupportThreadsPageComposition() {
  const t = useTranslations('pages.support');
  return (
    <AppLayoutComposition title={t('listThreadsTitle')}>
      <SupportThreadsPageInner />
    </AppLayoutComposition>
  );
}
