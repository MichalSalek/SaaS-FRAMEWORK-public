// UI/features/sessions/ClientSessionsPage.composition.tsx
// The client's inspiration sessions.
// - AppHero: title + live counts (open, archived)
// - the one filled action „Utwórz sesję”, right under the hero
// - open sessions (drafts first) in the main column, history by month in the
//   second column from 720px of the page's own width (PageColumns)
// - empty state with the same single action when there is nothing yet
//
// Data: TanStack Query v5 useInfiniteQuery with cursor pagination.

import { useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useTranslations, useLocale } from 'next-intl';
import { PlusIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import {
  isActiveSession,
  isTerminalSession,
} from '@kernel/domain/session-container/session-container.types';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { CreateSessionModalOrganism } from '../../components/CreateSessionModal/CreateSessionModal.organism';
import { usePairedStylists } from '../shared/pairing/hooks/usePairedStylists';
import {
  useClientSessions,
  flattenClientSessionPages,
} from './hooks/useClientSessions';
import { InfiniteScrollTriggerComposition } from '../../components/InfiniteScrollTrigger.composition';
import { useCreateSession } from './hooks/useCreateSession';
import { useSessionCreateOptions } from './hooks/useSessionCreateOptions';
import {
  ActiveSessionsBlockOrganism,
  SessionsEmptyStateOrganism,
  SessionsListSkeletonOrganism,
  TimelineSectionOrganism,
} from './ClientSessionsPage.blocks.organism';
import {
  buildUnnamedDayCollisionTimes,
  groupSessionsByMonth,
} from './ClientSessionsPage.formatters';
import styles from './ClientSessionsPage.module.css';

/* ============================================================
 * Inner Page — owns the data layer
 * ============================================================ */

function ClientSessionsPageInner() {
  const t = useTranslations('pages.sessions');
  const locale = useLocale();
  useAppBarTitle(t('mySessionsTitle'));
  const router = useRouter();
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useClientSessions();
  const createSessionMutation = useCreateSession();
  const pairedStylists = usePairedStylists();
  const { pairs } = pairedStylists;
  // Each row names the stylist its session is for (connected ones only).
  const stylistNames = useMemo(
    () => new Map(pairs.map(p => [p.stylistAccountId, p.stylistDisplayName])),
    [pairs]
  );

  const sessions = useMemo(() => flattenClientSessionPages(data), [data]);

  // Open sessions, the ones that wait for HER first: a draft is not shared
  // yet, a shared one merely exists until the visit. The filter is stable, so
  // the API order (newest first) holds inside each group.
  const activeSessions = useMemo(() => {
    const open = sessions.filter(s => !isTerminalSession(s.lifecycleState));
    return [
      ...open.filter(s => !isActiveSession(s.lifecycleState)),
      ...open.filter(s => isActiveSession(s.lifecycleState)),
    ];
  }, [sessions]);

  const { stylistsStatus, stylistOptions, sharedLimitReached, onlyStylist } =
    useSessionCreateOptions(activeSessions, pairedStylists);

  const archiveSessions = useMemo(
    () => sessions.filter(s => isTerminalSession(s.lifecycleState)),
    [sessions]
  );

  const archiveByMonth = useMemo(
    () => groupSessionsByMonth(archiveSessions),
    [archiveSessions]
  );

  // Disambiguate UNNAMED sessions that share a calendar day with another
  // unnamed session. Computed once over the
  // FULL list (active + archive) so a same-day collision straddling the
  // active/archive split or a month boundary is still detected. id -> "HH:MM".
  const disambiguationTimes = useMemo(
    () => buildUnnamedDayCollisionTimes(sessions, locale),
    [sessions, locale]
  );

  /* ---------------- Loading / error ---------------- */

  if (isLoading) {
    // The skeleton keeps the final boxes (hero title, the create button, three
    // cards), so nothing shifts when the list arrives.
    return (
      <div className={styles.page} aria-busy='true' aria-live='polite'>
        <AppHeroOrganism title={t('mySessionsTitle')} />
        <SessionsListSkeletonOrganism />
      </div>
    );
  }

  // Full-page error ONLY when there is nothing to show. TanStack keeps `data`
  // on a failed background refetch or next page (isError stays true), and the
  // old unconditional branch threw the loaded sessions away for a retry slab.
  // An EMPTY cached list under an error is not a confirmed "no sessions yet"
  // either: it gets this error with retry, not the create-first empty state.
  if (
    isError &&
    (data === undefined ||
      (activeSessions.length === 0 && archiveSessions.length === 0))
  ) {
    return (
      <div className={styles.page}>
        <AppHeroOrganism title={t('mySessionsTitle')} />
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retryBtn')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  // A successful create opens the saved session immediately. No intermediate
  // celebration or timed close holds the user away from adding inspirations.
  const handleCreateSession = (stylistId: string): Promise<boolean> =>
    new Promise<boolean>(resolve => {
      createSessionMutation.mutate(
        { stylist_account_id: stylistId },
        {
          onSuccess: createdData => {
            // Navigating to the new session detail = success confirmation (unmounts the
            // modal after the short „done” step). buildRoute instead of a manual .replace:
            // consistent with the rest of the feature + encoding + compile-time param typing.
            void router.push(
              buildRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, {
                sessionId: createdData.session.id,
              })
            );
            resolve(true);
          },
          onError: () => resolve(false),
        }
      );
    });

  const isCompletelyEmpty =
    activeSessions.length === 0 && archiveSessions.length === 0;

  const openCreate = () => {
    if (onlyStylist !== null) {
      if (!createSessionMutation.isPending) {
        void handleCreateSession(onlyStylist.id);
      }
      return;
    }
    setCreateModalOpen(true);
  };

  // Live counts of the page. ONE meta member on purpose: AppHero draws a
  // separator between sibling members, and the two counts read as one
  // sentence joined by a comma.
  const more = hasNextPage ? '+' : '';
  const heroMeta = isCompletelyEmpty ? undefined : (
    <span>
      <span>
        {activeSessions.length > 0 && (
          <>
            <strong>
              {activeSessions.length}
              {more}
            </strong>{' '}
          </>
        )}
        {t('heroMetaActive', { count: activeSessions.length })}
        {archiveSessions.length > 0 && (
          <>
            {', '}
            <strong>
              {archiveSessions.length}
              {more}
            </strong>{' '}
            {t('heroMetaArchive')}
          </>
        )}
      </span>
    </span>
  );

  const activeBlock =
    activeSessions.length > 0 ? (
      <ActiveSessionsBlockOrganism
        sessions={activeSessions}
        locale={locale}
        t={t}
        disambiguationTimes={disambiguationTimes}
        stylistNames={stylistNames}
      />
    ) : null;
  const historyBlock =
    archiveByMonth.length > 0 ? (
      <TimelineSectionOrganism
        monthGroups={archiveByMonth}
        locale={locale}
        t={t}
        disambiguationTimes={disambiguationTimes}
        stylistNames={stylistNames}
      />
    ) : null;

  return (
    <div className={styles.page}>
      <AppHeroOrganism title={t('mySessionsTitle')} meta={heroMeta} />

      {isCompletelyEmpty ? (
        <SessionsEmptyStateOrganism
          onCreateClick={openCreate}
          isCreating={createSessionMutation.isPending}
        />
      ) : (
        <>
          <div className={styles.primaryAction}>
            <ButtonAtom
              variant='primary'
              size='lg'
              icon={<PlusIcon weight='bold' />}
              className='press-feedback'
              loading={createSessionMutation.isPending && onlyStylist !== null}
              onClick={openCreate}>
              {t('createNew')}
            </ButtonAtom>
          </div>

          {/* Open sessions lead; history is the second column on a wide
              page. With nothing open the history takes the main column. */}
          {activeBlock !== null && historyBlock !== null ? (
            <PageColumnsMolecule main={activeBlock} aside={historyBlock} />
          ) : (
            <PageColumnsMolecule main={activeBlock ?? historyBlock} />
          )}

          {/* Stale list + failed refresh/next page: non-blocking retry. A
              failed next page is retried by itself (refetch would reload
              every page); the sentinel is paused so it cannot loop. */}
          {isError && (
            <ErrorStateMolecule
              message={t('loadError')}
              retryLabel={t('retryBtn')}
              onRetry={() =>
                void (isFetchNextPageError ? fetchNextPage() : refetch())
              }
              isRetrying={isFetchingNextPage || isFetching}
            />
          )}

          {!isFetchNextPageError && (hasNextPage || isFetchingNextPage) && (
            <InfiniteScrollTriggerComposition
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onFetchNextPage={fetchNextPage}
            />
          )}
        </>
      )}

      <CreateSessionModalOrganism
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        stylists={stylistOptions}
        stylistsStatus={stylistsStatus}
        onRetryStylists={() => void pairedStylists.refetch()}
        isRetryingStylists={pairedStylists.isFetching}
        onOpenSession={sessionId =>
          void router.push(
            buildRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, { sessionId })
          )
        }
        onCreateSession={handleCreateSession}
        onNavigateToPairing={() => void router.push(ROUTES_FRONT.PAIRING)}
        sharedLimitReached={sharedLimitReached}
      />
    </div>
  );
}

/* ============================================================
 * Shell with AppLayout
 * ============================================================ */

export function ClientSessionsPageComposition() {
  const t = useTranslations('pages.sessions');
  return (
    <AppLayoutComposition title={t('mySessionsTitle')}>
      <ClientSessionsPageInner />
    </AppLayoutComposition>
  );
}
