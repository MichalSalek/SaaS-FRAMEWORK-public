// UI/features/shared/SharedPage.composition.tsx
// The stylist's list of inspiration sessions shared by her clients.
// - AppHero: title + live counts (open, archived)
// - open sessions in the main column, the archive by month in the second
//   column from 720px of the page's own width (PageColumns)
// - nothing open: the empty state with the one action (connect with a client)
// Client accounts are redirected to /app/client/sessions.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  isActiveSession,
  isTerminalSession,
} from '@kernel/domain/session-container/session-container.types';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { useAppRole } from '../../layouts/useAppRole';
import {
  UI_SECTION,
  useUiSectionAllowed,
} from '../../shared/hooks/useSessionRole';
import { useSharedSessions } from './hooks/useSharedSessions';
import { InfiniteScrollTriggerComposition } from '../../components/InfiniteScrollTrigger.composition';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import {
  SharedActiveSectionOrganism,
  SharedEmptyStateOrganism,
  SharedListSkeletonOrganism,
} from './SharedPage.parts.organism';
import { SharedArchiveSectionOrganism } from './SharedPage.archive.organism';
import styles from './SharedPage.module.css';

/* ─────────────────────────────────────────────
   Loading — the hero title and three cards keep their final boxes
   ───────────────────────────────────────────── */

function SharedPageLoading() {
  const t = useTranslations('pages.shared');
  return (
    <div className={styles.page} aria-busy='true' aria-live='polite'>
      <AppHeroOrganism title={t('title')} />
      <SharedListSkeletonOrganism />
    </div>
  );
}

/* ─────────────────────────────────────────────
   Stylist view
   ───────────────────────────────────────────── */

function StylistClipboardView() {
  const {
    sessions,
    isLoading,
    isError,
    isFetching,
    data,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
  } = useSharedSessions();
  const t = useTranslations('pages.shared');
  const [, setTick] = useState(0);

  // 30s interval to force time-remaining re-render
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(prev => prev + 1);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const { activeSessions, archivedSessions } = useMemo(() => {
    const active = sessions.filter(s => isActiveSession(s.lifecycleState));
    const archived = sessions
      .filter(s => isTerminalSession(s.lifecycleState))
      .sort(
        (a, b) =>
          new Date(b.sharedAt ?? b.createdAt).getTime() -
          new Date(a.sharedAt ?? a.createdAt).getTime()
      );
    return {
      activeSessions: active,
      archivedSessions: archived,
    };
  }, [sessions]);

  if (isLoading) {
    return <SharedPageLoading />;
  }

  // Full-page error only when nothing ever loaded. A failed refresh or next
  // page keeps the sessions on screen with a retry below them. An EMPTY
  // cached list under an error is unconfirmed, so it gets this error too
  // instead of the "no active sessions" empty state.
  if (isError && (data === undefined || sessions.length === 0)) {
    return (
      <div className={styles.page}>
        <AppHeroOrganism title={t('title')} />
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  const hasActive = activeSessions.length > 0;
  const hasArchive = archivedSessions.length > 0;

  // Live counts of the page, the only place they are stated. ONE meta member
  // on purpose: the two counts read as one sentence joined by a comma. With
  // more pages to load the number is a floor, hence the plus.
  const more = hasNextPage ? '+' : '';
  const heroMeta = (
    <span>
      {hasActive && (
        <>
          <strong>
            {activeSessions.length}
            {more}
          </strong>{' '}
        </>
      )}
      {t('heroMetaActiveSessions', { count: activeSessions.length })}
      {hasArchive && (
        <>
          {', '}
          <strong>
            {archivedSessions.length}
            {more}
          </strong>{' '}
          {t('heroMetaArchive')}
        </>
      )}
    </span>
  );

  // What she works on leads: open sessions, or the way to the first one.
  const mainBlock = hasActive ? (
    <SharedActiveSectionOrganism sessions={activeSessions} />
  ) : (
    <SharedEmptyStateOrganism size={hasArchive ? 'panel' : 'page'} />
  );

  return (
    <div className={styles.page}>
      <AppHeroOrganism title={t('title')} meta={heroMeta} />

      {hasArchive ? (
        <PageColumnsMolecule
          main={mainBlock}
          aside={<SharedArchiveSectionOrganism sessions={archivedSessions} />}
        />
      ) : (
        <PageColumnsMolecule main={mainBlock} />
      )}

      {/* Stale list + failed refresh or next page: non-blocking retry. A
          failed next page is retried by itself (refetch would reload every
          page); the sentinel is paused so it cannot loop. */}
      {isError && (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retry')}
          onRetry={() =>
            void (isFetchNextPageError ? fetchNextPage() : refetch())
          }
          isRetrying={isFetchingNextPage || isFetching}
        />
      )}

      {!isFetchNextPageError && (
        <InfiniteScrollTriggerComposition
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onFetchNextPage={fetchNextPage}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Inner Page — owns role switch + redirect
   ───────────────────────────────────────────── */

function SharedPageInner() {
  const t = useTranslations('pages.shared');
  useAppBarTitle(t('title'));
  const router = useRouter();
  // SSOT gate — UI_SECTION.SHARED_STYLIST_VIEW = ACCOUNT_HOLDER_AND_ADMIN_SET.
  // Anyone outside the stylist clipboard view (clients, not-logged) is bounced
  // to the client sessions list instead of seeing the stylist clipboard.
  const canSeeStylistView = useUiSectionAllowed(UI_SECTION.SHARED_STYLIST_VIEW);
  // Gate na ROZSTRZYGNIĘCIE roli — useUiSectionAllowed zwraca false także
  // wtedy, gdy rola jeszcze nie jest znana, więc bez tego stylistka jest
  // race'owo bounce'owana na widok klientki (S25). Od 2026-10-09 czekamy na
  // rolę, nie na samą sesję: sesja potrafi się rozstrzygnąć BEZ roli (nie
  // doszła przy starcie strony) i wtedy rolę daje zapytanie o konto
  // (DECISION w layouts/useAppRole.ts).
  const { isRoleUnknown } = useAppRole();

  useEffect(() => {
    if (!isRoleUnknown && !canSeeStylistView) {
      void router.replace(ROUTES_FRONT.CLIENT_SESSIONS);
    }
  }, [isRoleUnknown, canSeeStylistView, router]);

  if (!canSeeStylistView) {
    return isRoleUnknown ? <SharedPageLoading /> : null;
  }

  return <StylistClipboardView />;
}

/* ─────────────────────────────────────────────
   Shell with AppLayout
   ───────────────────────────────────────────── */

export function SharedPageComposition() {
  const t = useTranslations('pages.shared');
  return (
    <AppLayoutComposition title={t('title')}>
      <SharedPageInner />
    </AppLayoutComposition>
  );
}
